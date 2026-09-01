import { describe, expect, it } from 'vitest';
import { forcedGivenSat, supports } from './backbone';
import { type Shape } from './enumerate';
import { makeGrid } from './grid';
import type { Hint, Trait, Unit } from './hint';
import { type Board, evaluate, makeBoard, unitMembers } from './predicates';
import { type Clues, forcedGiven } from './solve';

/**
 * `enumerate.ts` is the reference: it decides a card by looking at every
 * assignment, which is slow but obviously right. The SAT engine has to agree
 * with it exactly, on every card, for every position — a disagreement in either
 * direction is a bug that would silently corrupt hints and `paths`.
 *
 * Clues are generated true-of-a-random-truth rather than at random, because
 * `forcedGiven`'s precondition is that the truth satisfies its own clues.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROFESSIONS = ['cook', 'clerk', 'doctor', 'cop'];

function randomShape(rng: () => number, width: number, height: number): Shape {
  const grid = makeGrid(width, height);
  return {
    grid,
    professions: Array.from(
      { length: grid.size },
      () => PROFESSIONS[Math.floor(rng() * PROFESSIONS.length)],
    ),
  };
}

function randomUnit(rng: () => number, shape: Shape): Unit {
  const { width, height, size } = shape.grid;
  const pick = Math.floor(rng() * 7);
  if (pick === 0) return { kind: 'row', n: 1 + Math.floor(rng() * height) };
  if (pick === 1) return { kind: 'col', n: 1 + Math.floor(rng() * width) };
  if (pick === 2) return { kind: 'neighbor', i: Math.floor(rng() * size) };
  if (pick === 3)
    return { kind: 'between', a: Math.floor(rng() * size), b: Math.floor(rng() * size) };
  if (pick === 4)
    return { kind: 'profession', name: PROFESSIONS[Math.floor(rng() * PROFESSIONS.length)] };
  if (pick === 5) return { kind: 'edge' };
  return { kind: 'corner' };
}

const num = (n: number) => ({ t: 'num' as const, n });
const unit = (u: Unit) => ({ t: 'unit' as const, unit: u });
const trait = (t: Trait) => ({ t: 'trait' as const, trait: t });
const index = (i: number) => ({ t: 'index' as const, i });

/** A hint from the spike's supported set that is true of `truth`, or null. */
function trueClue(rng: () => number, board: Board, shape: Shape, truth: boolean[]): Hint | null {
  const t: Trait = rng() < 0.5 ? 'criminal' : 'innocent';
  const has = (i: number) => (t === 'criminal' ? truth[i] : !truth[i]);
  const u = randomUnit(rng, shape);
  const members = unitMembers(board, u);
  const count = members.filter(has).length;
  const pick = Math.floor(rng() * 9);

  if (pick === 0) return { pred: 'number_of_traits_in_unit', args: [unit(u), trait(t), num(count)] };
  if (pick === 1 && count > 0)
    return {
      pred: 'min_number_of_traits_in_unit',
      args: [unit(u), trait(t), num(1 + Math.floor(rng() * count))],
    };
  if (pick === 2 && count % 2 === 1)
    return { pred: 'odd_number_of_traits_in_unit', args: [unit(u), trait(t)] };
  if (pick === 3)
    return {
      pred: 'number_of_traits',
      args: [trait(t), num(truth.filter((_, i) => has(i)).length)],
    };
  if (pick === 4) {
    const i = Math.floor(rng() * shape.grid.size);
    return { pred: 'has_trait', args: [index(i), trait(has(i) ? t : t === 'criminal' ? 'innocent' : 'criminal')] };
  }
  if (pick === 5) {
    const own = members.filter(has);
    if (own.length === 0) return null;
    const i = own[Math.floor(rng() * own.length)];
    return { pred: 'is_one_of_n_traits_in_unit', args: [unit(u), index(i), trait(t), num(count)] };
  }
  if (pick === 6) {
    const own = members.filter(has);
    if (own.length < 2) return null;
    const i = own[Math.floor(rng() * own.length)];
    return { pred: 'is_not_only_trait_in_unit', args: [unit(u), index(i), trait(t)] };
  }
  if (pick === 7) {
    const other = randomUnit(rng, shape);
    const first = new Set(members);
    const sharedCount = unitMembers(board, other).filter((i) => first.has(i) && has(i)).length;
    if (rng() < 0.5)
      return {
        pred: 'units_share_n_traits',
        args: [unit(u), unit(other), trait(t), num(sharedCount)],
      };
    if (sharedCount % 2 === 1)
      return { pred: 'units_share_odd_n_traits', args: [unit(u), unit(other), trait(t)] };
    return null;
  }
  const dx = Math.floor(rng() * 3) - 1;
  const dy = Math.floor(rng() * 3) - 1;
  if (dx === 0 && dy === 0) return null;
  const shifted = members
    .map((i) => {
      const x = (i % shape.grid.width) + dx;
      const y = Math.floor(i / shape.grid.width) + dy;
      return x < 0 || x >= shape.grid.width || y < 0 || y >= shape.grid.height
        ? null
        : y * shape.grid.width + x;
    })
    .filter((j): j is number => j !== null);
  return {
    pred: 'n_in_unit_have_trait_in_dir',
    args: [unit(u), trait(t), num(dx), num(dy), num(shifted.filter(has).length)],
  };
}

interface Case {
  shape: Shape;
  clues: Clues;
  truth: boolean[];
}

function randomCase(rng: () => number, width: number, height: number): Case {
  const shape = randomShape(rng, width, height);
  const size = shape.grid.size;
  const truth = Array.from({ length: size }, () => rng() < 0.35);
  const board = makeBoard(shape.grid, shape.professions, truth);
  const clues: Clues = Array.from({ length: size }, () => null);
  for (let i = 0; i < size; i++) {
    if (rng() < 0.45) continue;
    const hint = trueClue(rng, board, shape, truth);
    // The generator aims to produce true clues; anything that slipped through is
    // dropped rather than trusted, since a false clue would break the
    // precondition both engines are entitled to assume.
    if (hint && supports(hint) && evaluate(board, hint)) clues[i] = hint;
  }
  return { shape, clues, truth };
}

describe('SAT engine against the enumerator', () => {
  it('deduces exactly the same cards on random boards', () => {
    const rng = mulberry32(20260901);
    let checked = 0;
    for (let trial = 0; trial < 60; trial++) {
      const { shape, clues, truth } = randomCase(rng, 4, 4);
      const size = shape.grid.size;
      for (let round = 0; round < 6; round++) {
        const flipped = [...Array(size).keys()].filter(() => rng() < 0.35);
        const expected = forcedGiven(shape, clues, truth, flipped);
        const actual = forcedGivenSat(shape, clues, truth, flipped);
        expect(actual, `trial ${trial} round ${round} flipped ${flipped}`).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBe(360);
  });

  it('agrees on the opening position of a 4x5 board, where the most is unknown', () => {
    const rng = mulberry32(77);
    for (let trial = 0; trial < 8; trial++) {
      const { shape, clues, truth } = randomCase(rng, 4, 5);
      for (const flipped of [[], [0], [0, 7], [3, 11, 19]]) {
        expect(forcedGivenSat(shape, clues, truth, flipped)).toEqual(
          forcedGiven(shape, clues, truth, flipped),
        );
      }
    }
  });

  it('agrees that a card is unforced when nothing constrains it', () => {
    const shape: Shape = { grid: makeGrid(4, 4), professions: Array(16).fill('cook') };
    const truth = Array.from({ length: 16 }, () => false);
    const clues: Clues = Array.from({ length: 16 }, () => null);
    expect(forcedGivenSat(shape, clues, truth, [])).toEqual(forcedGiven(shape, clues, truth, []));
  });
});
