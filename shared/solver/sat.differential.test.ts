import { describe, expect, it } from 'vitest';
import { forcedGivenSat, supports } from './backbone';
import { SUPPORTED } from './encode';
import { type Shape } from './enumerate';
import { makeGrid } from './grid';
import { evaluate, makeBoard } from './predicates';
import { SAMPLED_PREDICATES, makeSampleCtx, randomTrueClue } from './sample';
import { type Clues, forcedGivenBrute } from './solve';

/**
 * `enumerate.ts` is the reference: it decides a card by looking at every
 * assignment, which is slow but obviously right. The SAT engine has to agree
 * with it exactly, on every card, for every position — a disagreement in either
 * direction is a bug that would silently corrupt hints and `paths`.
 *
 * Clues come from `sample.ts`, which builds them true-of-a-random-truth because
 * `forcedGiven`'s precondition is that the truth satisfies its own clues. Every
 * clue is then checked against the evaluator before use, so a builder that
 * guesses wrong costs coverage rather than correctness — which is why the run
 * also asserts that each supported predicate actually turned up.
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

interface Case {
  shape: Shape;
  clues: Clues;
  truth: boolean[];
}

function randomCase(
  rng: () => number,
  width: number,
  height: number,
  seen?: Map<string, number>,
): Case {
  const shape = randomShape(rng, width, height);
  const size = shape.grid.size;
  const truth = Array.from({ length: size }, () => rng() < 0.35);
  const board = makeBoard(shape.grid, shape.professions, truth);
  const ctx = makeSampleCtx(rng, board, shape, truth);
  const clues: Clues = Array.from({ length: size }, () => null);
  for (let i = 0; i < size; i++) {
    if (rng() < 0.45) continue;
    const hint = randomTrueClue(ctx);
    // Anything that slipped through as false is dropped rather than trusted: a
    // false clue would break the precondition both engines may assume.
    if (hint && supports(hint) && evaluate(board, hint)) {
      clues[i] = hint;
      if (seen) seen.set(hint.pred, (seen.get(hint.pred) ?? 0) + 1);
    }
  }
  return { shape, clues, truth };
}

describe('SAT engine against the enumerator', () => {
  it('deduces exactly the same cards on random boards', () => {
    const rng = mulberry32(20260901);
    const seen = new Map<string, number>();
    let checked = 0;
    for (let trial = 0; trial < 60; trial++) {
      const { shape, clues, truth } = randomCase(rng, 4, 4, seen);
      const size = shape.grid.size;
      for (let round = 0; round < 6; round++) {
        const flipped = [...Array(size).keys()].filter(() => rng() < 0.35);
        const expected = forcedGivenBrute(shape, clues, truth, flipped);
        const actual = forcedGivenSat(shape, clues, truth, flipped);
        expect(actual, `trial ${trial} round ${round} flipped ${flipped}`).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBe(360);
    // Agreement is only worth as much as the clues it ran on. A family that
    // stopped being generated would quietly stop being compared, so the loop
    // asserts its own coverage rather than trusting it.
    const thin = [...SUPPORTED].filter((p) => (seen.get(p) ?? 0) < 3);
    expect(thin, `too few clues compared for: ${thin}`).toEqual([]);
  });

  it('agrees on the opening position of a 4x5 board, where the most is unknown', () => {
    const rng = mulberry32(77);
    for (let trial = 0; trial < 8; trial++) {
      const { shape, clues, truth } = randomCase(rng, 4, 5);
      for (const flipped of [[], [0], [0, 7], [3, 11, 19]]) {
        expect(forcedGivenSat(shape, clues, truth, flipped)).toEqual(
          forcedGivenBrute(shape, clues, truth, flipped),
        );
      }
    }
  });

  it('agrees that a card is unforced when nothing constrains it', () => {
    const shape: Shape = { grid: makeGrid(4, 4), professions: Array(16).fill('cook') };
    const truth = Array.from({ length: 16 }, () => false);
    const clues: Clues = Array.from({ length: 16 }, () => null);
    expect(forcedGivenSat(shape, clues, truth, [])).toEqual(forcedGivenBrute(shape, clues, truth, []));
  });

  it('has a builder for every predicate the encoder claims to support', () => {
    expect([...SAMPLED_PREDICATES].sort()).toEqual([...SUPPORTED].sort());
  });
});
