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

export function forcedGiven(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  flipped: number[],
): Known {
  const masks = survivors(shape, knownFrom(truth, flipped), activeHints(clues, flipped));
  return forcedFromMasks(masks, shape.grid.size);
}

export function isUniquelySolvable(shape: Shape, clues: Clues, truth: boolean[]): boolean {
  const all = clues.flatMap((h) => (h ? [h] : []));
  const masks = survivors(
    shape,
    truth.map(() => null),
    all,
  );
  return masks.length === 1;
}

export interface Chain {
  steps: HintStep[];
  solvedAll: boolean;
  revealedAt: (number | null)[];
}

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

/** Distinct minimal subsets of `flipped` that still force `index`. Greedy drop
 * over several shuffles; every result is genuinely sufficient. */
export function minimalPaths(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  index: number,
  flipped: number[],
  attempts = 3,
): number[][] {
  if (!forces(shape, clues, truth, index, flipped)) return [];
  const found = new Map<string, number[]>();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const order = [...flipped];
    // Deterministic per-attempt rotation instead of a random shuffle, so results
    // are reproducible without threading an RNG through the solver.
    for (let k = 0; k < attempt; k++) order.push(order.shift() as number);
    let current = [...flipped];
    for (const candidate of order) {
      const trial = current.filter((i) => i !== candidate);
      if (forces(shape, clues, truth, index, trial)) current = trial;
    }
    const path = [...current].sort((a, b) => a - b);
    found.set(path.join(','), path);
  }
  return [...found.values()];
}
