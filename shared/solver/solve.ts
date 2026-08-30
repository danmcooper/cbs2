import type { HintStep } from '../puzzle';
import { type Known, type Shape, forcedFromMasks, survivors } from './enumerate';
import { type Hint, parseHint } from './hint';

export type Clues = (Hint | null)[];

/** Convenience for tests and scripts: origHint strings -> Clues. */
export function parseClues(origHints: (string | null)[]): Clues {
  return origHints.map((s) => (s === null ? null : parseHint(s)));
}

export function knownFrom(truth: boolean[], flipped: number[]): Known {
  const known: Known = truth.map(() => null);
  for (const i of flipped) known[i] = truth[i];
  return known;
}

export function activeHints(clues: Clues, flipped: number[]): Hint[] {
  const out: Hint[] = [];
  for (const i of flipped) {
    const hint = clues[i];
    if (hint) out.push(hint);
  }
  return out;
}

/**
 * Precondition: `truth` must be consistent with `clues` — the flipped truth
 * values, together with the hints on the flipped cards, must admit at least
 * one satisfying assignment. If they don't (the puzzle's own truth violates
 * its own clues), `forcedFromMasks` throws `ContradictionError`; this
 * function does not catch it.
 */
export function forcedGiven(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  flipped: number[],
): Known {
  const masks = survivors(shape, knownFrom(truth, flipped), activeHints(clues, flipped));
  return forcedFromMasks(masks, shape.grid.size);
}

/**
 * True when the full clue set — every non-null hint, active simultaneously,
 * regardless of which card it lives on — pins exactly one assignment.
 *
 * `revealed` seeds those card indices as known (from `truth`) rather than
 * free; all other cards start unknown. The default `[]` is the strictly
 * stronger, no-prior-knowledge condition: every card, including any that are
 * only ever handed to the player as a pre-flipped given, must be recoverable
 * from clue text alone. Passing a puzzle's `initialReveals` here checks the
 * weaker, still-fair condition that real archived puzzles actually satisfy:
 * unique *given* what the game hands the player up front.
 */
export function isUniquelySolvable(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  revealed: number[] = [],
): boolean {
  const all = clues.flatMap((h) => (h ? [h] : []));
  const masks = survivors(shape, knownFrom(truth, revealed), all);
  return masks.length === 1;
}

export interface Chain {
  steps: HintStep[];
  solvedAll: boolean;
  revealedAt: (number | null)[];
}

/**
 * Precondition: `truth` must be consistent with `clues` (see `forcedGiven`).
 * Each step calls `forcedGiven` on the currently-flipped set; if `truth`
 * ever violates the active hints, that call throws `ContradictionError`
 * instead of returning a `Chain`.
 */
export function solveChain(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  initialReveals: number[],
): Chain {
  const size = shape.grid.size;
  const revealedAt: (number | null)[] = truth.map(() => null);
  for (const i of initialReveals) revealedAt[i] = 0;
  let flipped = [...initialReveals].sort((a, b) => a - b);
  const steps: HintStep[] = [];

  for (let step = 1; flipped.length < size; step++) {
    const forced = forcedGiven(shape, clues, truth, flipped);
    const reveals: number[] = [];
    for (let i = 0; i < size; i++) {
      if (revealedAt[i] === null && forced[i] !== null) {
        reveals.push(i);
        revealedAt[i] = step;
      }
    }
    if (reveals.length === 0) break;
    steps.push({
      flipped: [...flipped],
      clues: flipped.filter((i) => clues[i] !== null),
      reveals,
    });
    flipped = [...flipped, ...reveals].sort((a, b) => a - b);
  }

  return { steps, solvedAll: flipped.length === size, revealedAt };
}

function forces(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  index: number,
  flipped: number[],
): boolean {
  if (flipped.includes(index)) return true;
  return forcedGiven(shape, clues, truth, flipped)[index] !== null;
}

/**
 * Distinct minimal subsets of `flipped` that still force `index`. Greedy drop
 * over several shuffles; every result is genuinely sufficient.
 *
 * Precondition: `truth` must be consistent with `clues` (see `forcedGiven`).
 * A contradictory combination surfaces as an uncaught `ContradictionError`
 * from the underlying `forces`/`forcedGiven` call, not as an empty result.
 */
export function minimalPaths(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  index: number,
  flipped: number[],
  attempts = 3,
): number[][] {
  // Cache `forces` by sorted-subset key, shared across every attempt in this
  // call: different rotation orders repeatedly probe identical or
  // overlapping subsets, and each probe is up to O(2^free) work, so this
  // eliminates a large amount of redundant re-evaluation without changing
  // the worst-case complexity or the result.
  const cache = new Map<string, boolean>();
  const cachedForces = (subset: number[]): boolean => {
    const key = [...subset].sort((a, b) => a - b).join(',');
    let result = cache.get(key);
    if (result === undefined) {
      result = forces(shape, clues, truth, index, subset);
      cache.set(key, result);
    }
    return result;
  };

  if (!cachedForces(flipped)) return [];
  const found = new Map<string, number[]>();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const order = [...flipped];
    // Deterministic per-attempt rotation instead of a random shuffle, so results
    // are reproducible without threading an RNG through the solver.
    for (let k = 0; k < attempt; k++) order.push(order.shift() as number);
    let current = [...flipped];
    for (const candidate of order) {
      const trial = current.filter((i) => i !== candidate);
      if (cachedForces(trial)) current = trial;
    }
    const path = [...current].sort((a, b) => a - b);
    found.set(path.join(','), path);
  }
  return [...found.values()];
}
