/**
 * Clues that are true of a given board, one builder per predicate.
 *
 * Random clues are almost never true, and a false clue is not a weaker test but
 * an invalid one — `forcedGiven` is entitled to assume the truth satisfies its
 * own clues. So each builder reads the board and derives arguments that make its
 * predicate hold, returning null when the board offers no instance of that
 * shape.
 *
 * Used by the differential test to compare the two solvers on every predicate,
 * and by `check-sat.mts` to time the SAT engine on a board size the enumerator
 * cannot reach. Both need the same thing — a realistic clue set over an
 * arbitrary board — and neither is served by a mix that quietly collapses to
 * whichever predicate was easiest to satisfy.
 */
import type { Shape } from './enumerate';
import { isConnected, neighbors, offsetIndex } from './grid';
import type { Hint, Trait, Unit, UnitKind } from './hint';
import { type Board, unitMembers, unitsOfKind } from './predicates';

const num = (n: number) => ({ t: 'num' as const, n });
const unit = (u: Unit) => ({ t: 'unit' as const, unit: u });
const kind = (k: UnitKind) => ({ t: 'kind' as const, kind: k });
const trait = (t: Trait) => ({ t: 'trait' as const, trait: t });
const index = (i: number) => ({ t: 'index' as const, i });
const profession = (name: string) => ({ t: 'profession' as const, name });

const other = (t: Trait): Trait => (t === 'criminal' ? 'innocent' : 'criminal');

/** Everything a builder needs about the board it is writing a clue for. */
export interface SampleCtx {
  rng: () => number;
  board: Board;
  shape: Shape;
  truth: boolean[];
  professions: string[];
  /** Whether card `i` carries trait `t`. */
  has: (i: number, t: Trait) => boolean;
  count: (members: number[], t: Trait) => number;
  carriers: (u: Unit, t: Trait) => number[];
  members: (u: Unit) => number[];
  /** A grab-bag of units a clue can name, for builders that need a container. */
  candidates: Unit[];
  pick: <T>(xs: T[]) => T | null;
  /**
   * A unit satisfying `ok`, or null if the board has none. Builders that need a
   * particular shape — a unit holding exactly two adjacent criminals, say — get
   * one this way rather than by hoping a random unit fits: a shape that turns up
   * once in fifty draws would otherwise almost never be produced, and an
   * encoding nothing generates is an encoding nothing tests.
   */
  findUnit: (ok: (u: Unit) => boolean) => Unit | null;
}

export function randomUnit(rng: () => number, shape: Shape, professions: string[]): Unit {
  const { width, height, size } = shape.grid;
  const pick = Math.floor(rng() * 7);
  if (pick === 0) return { kind: 'row', n: 1 + Math.floor(rng() * height) };
  if (pick === 1) return { kind: 'col', n: 1 + Math.floor(rng() * width) };
  if (pick === 2) return { kind: 'neighbor', i: Math.floor(rng() * size) };
  if (pick === 3)
    return { kind: 'between', a: Math.floor(rng() * size), b: Math.floor(rng() * size) };
  if (pick === 4)
    return { kind: 'profession', name: professions[Math.floor(rng() * professions.length)] };
  if (pick === 5) return { kind: 'edge' };
  return { kind: 'corner' };
}

/** The value that occurs exactly once in `counts`, or null if there is none. */
function uniqueValue(rng: () => number, counts: number[]): number | null {
  const once = counts.filter((n) => counts.filter((m) => m === n).length === 1);
  return once.length === 0 ? null : once[Math.floor(rng() * once.length)];
}

function randomDir(rng: () => number): [number, number] | null {
  const dx = Math.floor(rng() * 3) - 1;
  const dy = Math.floor(rng() * 3) - 1;
  return dx === 0 && dy === 0 ? null : [dx, dy];
}

export type ClueBuilder = (c: SampleCtx, t: Trait, u: Unit) => Hint | null;

export const CLUE_BUILDERS: Record<string, ClueBuilder> = {
  has_trait: (c, t) => {
    const i = Math.floor(c.rng() * c.shape.grid.size);
    return { pred: 'has_trait', args: [index(i), trait(c.has(i, t) ? t : other(t))] };
  },

  number_of_traits: (c, t) => ({
    pred: 'number_of_traits',
    args: [trait(t), num(c.count([...c.truth.keys()], t))],
  }),

  number_of_traits_in_unit: (c, t, u) => ({
    pred: 'number_of_traits_in_unit',
    args: [unit(u), trait(t), num(c.count(c.members(u), t))],
  }),

  min_number_of_traits_in_unit: (c, t, u) => {
    const n = c.count(c.members(u), t);
    if (n === 0) return null;
    return {
      pred: 'min_number_of_traits_in_unit',
      args: [unit(u), trait(t), num(1 + Math.floor(c.rng() * n))],
    };
  },

  odd_number_of_traits_in_unit: (c, t, u) =>
    c.count(c.members(u), t) % 2 === 1
      ? { pred: 'odd_number_of_traits_in_unit', args: [unit(u), trait(t)] }
      : null,

  max_number_of_traits_in_neighbors_in_unit: (c, t, u) => {
    const mem = c.members(u);
    if (mem.length === 0) return null;
    const worst = Math.max(...mem.map((i) => c.count(neighbors(c.shape.grid, i), t)));
    return {
      pred: 'max_number_of_traits_in_neighbors_in_unit',
      args: [unit(u), trait(t), num(worst)],
    };
  },

  only_one_person_in_unit_has_exactly_n_trait_neighbors: (c, t, u) => {
    const mem = c.members(u);
    if (mem.length === 0) return null;
    const n = uniqueValue(
      c.rng,
      mem.map((i) => c.count(neighbors(c.shape.grid, i), t)),
    );
    if (n === null) return null;
    return {
      pred: 'only_one_person_in_unit_has_exactly_n_trait_neighbors',
      args: [unit(u), trait(t), num(n)],
    };
  },

  more_traits_in_unit_than_unit: (c, t, u) => {
    const n = c.count(c.members(u), t);
    const v = c.findUnit((w) => c.count(c.members(w), t) < n);
    if (v === null) return null;
    return { pred: 'more_traits_in_unit_than_unit', args: [unit(u), unit(v), trait(t)] };
  },

  equal_number_of_traits_in_units: (c, t, u) => {
    const n = c.count(c.members(u), t);
    const v = c.findUnit((w) => c.count(c.members(w), t) === n);
    if (v === null) return null;
    return { pred: 'equal_number_of_traits_in_units', args: [unit(u), unit(v), trait(t)] };
  },

  more_traits_than_traits_in_unit: (c, t) => {
    const v = c.findUnit((w) => c.count(c.members(w), t) > c.count(c.members(w), other(t)));
    if (v === null) return null;
    return { pred: 'more_traits_than_traits_in_unit', args: [unit(v), trait(t), trait(other(t))] };
  },

  equal_traits_and_traits_in_unit: (c, t) => {
    const v = c.findUnit((w) => c.count(c.members(w), t) === c.count(c.members(w), other(t)));
    if (v === null) return null;
    return { pred: 'equal_traits_and_traits_in_unit', args: [unit(v), trait(t), trait(other(t))] };
  },

  more_traits_in_unit_than_traits_in_unit: (c, t, u) => {
    const s = c.rng() < 0.5 ? t : other(t);
    const n = c.count(c.members(u), t);
    const v = c.findUnit((w) => c.count(c.members(w), s) < n);
    if (v === null) return null;
    return {
      pred: 'more_traits_in_unit_than_traits_in_unit',
      args: [unit(u), trait(t), unit(v), trait(s)],
    };
  },

  equal_traits_in_unit_and_traits_in_unit: (c, t, u) => {
    const s = c.rng() < 0.5 ? t : other(t);
    const n = c.count(c.members(u), t);
    const v = c.findUnit((w) => c.count(c.members(w), s) === n);
    if (v === null) return null;
    return {
      pred: 'equal_traits_in_unit_and_traits_in_unit',
      args: [unit(u), trait(t), unit(v), trait(s)],
    };
  },

  has_most_traits: (c, t) => {
    const k: UnitKind = c.rng() < 0.5 ? 'row' : 'col';
    const units = unitsOfKind(c.board, k);
    const counts = units.map((v) => c.count(c.members(v), t));
    const best = Math.max(...counts);
    if (counts.filter((n) => n === best).length !== 1) return null;
    return { pred: 'has_most_traits', args: [unit(units[counts.indexOf(best)]), trait(t)] };
  },

  only_unit_has_exactly_n_traits: (c, t) => {
    const k: UnitKind = c.rng() < 0.5 ? 'row' : 'col';
    const units = unitsOfKind(c.board, k);
    const counts = units.map((v) => c.count(c.members(v), t));
    const n = uniqueValue(c.rng, counts);
    if (n === null) return null;
    return {
      pred: 'only_unit_has_exactly_n_traits',
      args: [unit(units[counts.indexOf(n)]), trait(t), num(n)],
    };
  },

  only_one_unit_has_exactly_n_traits: (c, t) => {
    const k: UnitKind = c.rng() < 0.5 ? 'row' : 'col';
    const counts = unitsOfKind(c.board, k).map((v) => c.count(c.members(v), t));
    const n = uniqueValue(c.rng, counts);
    if (n === null) return null;
    return { pred: 'only_one_unit_has_exactly_n_traits', args: [kind(k), trait(t), num(n)] };
  },

  all_units_have_at_least_n_traits: (c, t) => {
    const k: UnitKind = c.rng() < 0.5 ? 'row' : 'col';
    const counts = unitsOfKind(c.board, k).map((v) => c.count(c.members(v), t));
    return {
      pred: 'all_units_have_at_least_n_traits',
      args: [kind(k), trait(t), num(Math.min(...counts))],
    };
  },

  is_one_of_n_traits_in_unit: (c, t, u) => {
    const own = c.carriers(u, t);
    const i = c.pick(own);
    if (i === null) return null;
    return {
      pred: 'is_one_of_n_traits_in_unit',
      args: [unit(u), index(i), trait(t), num(own.length)],
    };
  },

  is_not_only_trait_in_unit: (c, t, u) => {
    const own = c.carriers(u, t);
    if (own.length < 2) return null;
    return {
      pred: 'is_not_only_trait_in_unit',
      args: [unit(u), index(own[Math.floor(c.rng() * own.length)]), trait(t)],
    };
  },

  units_share_n_traits: (c, t, u) => {
    const v = randomUnit(c.rng, c.shape, c.professions);
    const first = new Set(c.members(u));
    const both = c.members(v).filter((i) => first.has(i));
    return {
      pred: 'units_share_n_traits',
      args: [unit(u), unit(v), trait(t), num(c.count(both, t))],
    };
  },

  units_share_odd_n_traits: (c, t, u) => {
    const v = randomUnit(c.rng, c.shape, c.professions);
    const first = new Set(c.members(u));
    const both = c.members(v).filter((i) => first.has(i));
    if (c.count(both, t) % 2 !== 1) return null;
    return { pred: 'units_share_odd_n_traits', args: [unit(u), unit(v), trait(t)] };
  },

  unit_shares_n_out_of_n_traits_with_unit: (c, t, u) => {
    const v = randomUnit(c.rng, c.shape, c.professions);
    const first = new Set(c.members(u));
    const both = c.members(v).filter((i) => first.has(i));
    return {
      pred: 'unit_shares_n_out_of_n_traits_with_unit',
      args: [unit(u), unit(v), trait(t), num(c.count(both, t)), num(c.count(c.members(u), t))],
    };
  },

  both_traits_in_unit_are_in_unit: (c, t) => {
    const u = c.findUnit((w) => c.carriers(w, t).length === 2);
    if (u === null) return null;
    const own = c.carriers(u, t);
    const v = c.pick(c.candidates.filter((w) => own.every((i) => c.members(w).includes(i))));
    if (v === null) return null;
    return { pred: 'both_traits_in_unit_are_in_unit', args: [unit(u), unit(v), trait(t)] };
  },

  only_trait_in_unit_is_in_unit: (c, t) => {
    const u = c.findUnit((w) => c.carriers(w, t).length === 1);
    if (u === null) return null;
    const only = c.carriers(u, t)[0];
    const v = c.pick(c.candidates.filter((w) => c.members(w).includes(only)));
    if (v === null) return null;
    return { pred: 'only_trait_in_unit_is_in_unit', args: [unit(u), unit(v), trait(t)] };
  },

  both_traits_are_neighbors_in_unit: (c, t) => {
    const u = c.findUnit((w) => {
      const own = c.carriers(w, t);
      return own.length === 2 && neighbors(c.shape.grid, own[0]).includes(own[1]);
    });
    if (u === null) return null;
    return { pred: 'both_traits_are_neighbors_in_unit', args: [unit(u), trait(t)] };
  },

  all_traits_are_neighbors_in_unit: (c, t) => {
    // Capped well below the encoder's ceiling: the subset walk is exponential in
    // the unit, and callers run this thousands of times.
    const u = c.findUnit(
      (w) => c.members(w).length <= 12 && isConnected(c.shape.grid, c.carriers(w, t)),
    );
    if (u === null) return null;
    return { pred: 'all_traits_are_neighbors_in_unit', args: [unit(u), trait(t)] };
  },

  n_in_unit_have_trait_in_dir: (c, t, u) => {
    const d = randomDir(c.rng);
    if (d === null) return null;
    const seen = c
      .members(u)
      .map((i) => offsetIndex(c.shape.grid, i, d[0], d[1]))
      .filter((j): j is number => j !== null);
    return {
      pred: 'n_in_unit_have_trait_in_dir',
      args: [unit(u), trait(t), num(d[0]), num(d[1]), num(c.count(seen, t))],
    };
  },

  n_t_in_unit_have_trait_in_dir: (c, t, u) => {
    const d = randomDir(c.rng);
    if (d === null) return null;
    const s = c.rng() < 0.5 ? t : other(t);
    const seen = c
      .carriers(u, t)
      .map((i) => offsetIndex(c.shape.grid, i, d[0], d[1]))
      .filter((j): j is number => j !== null);
    return {
      pred: 'n_t_in_unit_have_trait_in_dir',
      args: [unit(u), trait(t), trait(s), num(d[0]), num(d[1]), num(c.count(seen, s))],
    };
  },

  n_professions_have_trait_in_dir: (c, t) => {
    const d = randomDir(c.rng);
    if (d === null) return null;
    const name = c.professions[Math.floor(c.rng() * c.professions.length)];
    const seen = c
      .members({ kind: 'profession', name })
      .map((i) => offsetIndex(c.shape.grid, i, d[0], d[1]))
      .filter((j): j is number => j !== null);
    return {
      pred: 'n_professions_have_trait_in_dir',
      args: [profession(name), trait(t), num(d[0]), num(d[1]), num(c.count(seen, t))],
    };
  },
};

export const SAMPLED_PREDICATES = Object.keys(CLUE_BUILDERS);

export function makeSampleCtx(
  rng: () => number,
  board: Board,
  shape: Shape,
  truth: boolean[],
): SampleCtx {
  const has = (i: number, t: Trait) => (t === 'criminal' ? truth[i] : !truth[i]);
  const members = (u: Unit) => unitMembers(board, u);
  const professions = [...new Set(shape.professions)].sort();
  const { width, height, size } = shape.grid;
  return {
    rng,
    board,
    shape,
    truth,
    professions,
    has,
    members,
    count: (ms, t) => ms.filter((i) => has(i, t)).length,
    carriers: (u, t) => members(u).filter((i) => has(i, t)),
    candidates: [
      ...Array.from({ length: height }, (_, k): Unit => ({ kind: 'row', n: k + 1 })),
      ...Array.from({ length: width }, (_, k): Unit => ({ kind: 'col', n: k + 1 })),
      ...Array.from({ length: size }, (_, i): Unit => ({ kind: 'neighbor', i })),
      ...professions.map((name): Unit => ({ kind: 'profession', name })),
      { kind: 'edge' },
      { kind: 'corner' },
    ],
    pick: (xs) => (xs.length === 0 ? null : xs[Math.floor(rng() * xs.length)]),
    findUnit(ok) {
      const start = Math.floor(rng() * this.candidates.length);
      for (let k = 0; k < this.candidates.length; k++) {
        const u = this.candidates[(start + k) % this.candidates.length];
        if (ok(u)) return u;
      }
      return null;
    },
  };
}

/**
 * A clue of a randomly chosen predicate, aimed at being true of the board.
 * Callers must still check it against the evaluator: a builder derives arguments
 * that should make its predicate hold, but nothing here guarantees it did.
 */
export function randomTrueClue(c: SampleCtx, preds: string[] = SAMPLED_PREDICATES): Hint | null {
  const pred = preds[Math.floor(c.rng() * preds.length)];
  const t: Trait = c.rng() < 0.5 ? 'criminal' : 'innocent';
  return CLUE_BUILDERS[pred](c, t, randomUnit(c.rng, c.shape, c.professions));
}
