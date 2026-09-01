import type { HintStep } from '../puzzle';
import { forcedGivenSat, isUniquelySolvableSat } from './backbone';
import { type Clues, activeHints, knownFrom } from './clues';
import { type Known, type Shape, forcedFromMasks, survivors } from './enumerate';

export { type Clues, activeHints, knownFrom, parseClues } from './clues';

/**
 * Precondition: `truth` must be consistent with `clues` — the flipped truth
 * values, together with the hints on the flipped cards, must admit at least
 * one satisfying assignment. If they don't (the puzzle's own truth violates
 * its own clues), this throws `ContradictionError`.
 *
 * Answered by the SAT engine. The enumerator below is the same function written
 * the obvious way, and remains the reference the differential test checks
 * against — but it builds all 2^free assignments, which is 2^19 on a 4x5 board
 * and 2^30 on a 5x6 one, where the single allocation alone is over 4 GB. The
 * backbone is what the caller actually wants, and asking for it directly costs
 * about one solver call per *open* card rather than one array per position.
 */
export function forcedGiven(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  flipped: number[],
): Known {
  return forcedGivenSat(shape, clues, truth, flipped);
}

/** `forcedGiven` by exhaustive enumeration: the reference, not the fast path. */
export function forcedGivenBrute(
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
  return isUniquelySolvableSat(shape, clues, truth, revealed);
}

/** `isUniquelySolvable` by exhaustive enumeration: the reference, not the fast path. */
export function isUniquelySolvableBrute(
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

/**
 * The hint steps to ship with a puzzle, built from each card's `minimalPaths`.
 *
 * `solveChain`'s steps are the wrong shape for this even though they are the
 * right shape for proving a puzzle solvable. It closes over the board round by
 * round: each round applies every visible clue at once and flips everything
 * that follows, so a step cites a dozen clues, turns over half a row, and lists
 * the whole cumulative flipped set as its prerequisite. Handing that to the
 * hint button says "re-read the board" — and because the prerequisite is a
 * whole wave, a player who flipped in any other order matches no step at all
 * and the button does nothing. The archive's own hints are the opposite: 58% of
 * them cite a single clue and 87% reveal a single card.
 *
 * A minimal path is already exactly that — the smallest set of flipped cards
 * that still forces one particular card — so each path becomes one step. The
 * prerequisite is the path rather than the solve state it was found in, which
 * is both sound (the path forces the card on its own) and far more available:
 * paths run two or three cards where a wave runs a dozen.
 *
 * `paths[i]` is the minimal paths for card `i`, as stored on `Person.paths`;
 * cards the player is handed up front have none and contribute no steps.
 */
export function hintSteps(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  paths: readonly (readonly number[][])[],
): HintStep[] {
  const drafts: { flipped: number[]; clues: number[] }[] = [];
  paths.forEach((forCard, index) => {
    for (const path of forCard) {
      // A path never contains the card it forces, but a hint that lists its own
      // answer as a prerequisite would be unofferable rather than merely odd —
      // `pickHint` would need the answer flipped before it would suggest it.
      const flipped = path.filter((i) => i !== index).sort((a, b) => a - b);

      // A path is minimal in cards, which is not the same as minimal in clues: a
      // card can earn its place by its known criminal/innocent value alone while
      // its clue contributes nothing. Outlining it anyway is what separates a
      // hint that points at one sentence from one that points at three, so drop
      // each clue in turn — keeping the card flipped — and outline only those
      // the deduction still needs. Greedy, so the result is minimal in the sense
      // that no single clue can come out, which is what the archive's steps look
      // like: 58% of them cite exactly one clue.
      let active = clues;
      const outlined: number[] = [];
      for (const i of flipped) {
        if (active[i] === null) continue;
        const without = [...active];
        without[i] = null;
        if (forcedGiven(shape, without, truth, flipped)[index] !== null) active = without;
        else outlined.push(i);
      }
      drafts.push({ flipped, clues: outlined });
    }
  });

  // Path-derived steps go stale. Each is minimised against its own path, which
  // is a handful of cards, and it stays that shape for the whole puzzle — so a
  // card that needed five clues from six flipped cards is still offered with
  // five clues when the player holds seventeen and one clue would do. The step
  // is sound; it argues for a position the player left long ago, which reads as
  // the same "re-read the board" noise the wave-shaped steps did.
  //
  // So each card also gets a step minimised against its fullest honest position,
  // every other card flipped. That step needs a lot of prerequisites and so only
  // becomes available late, which is exactly when it is the sharp one — and
  // `pickHint` sorts by fewest clues, so it wins as soon as it is offerable.
  paths.forEach((forCard, index) => {
    if (forCard.length === 0) return; // handed to the player up front
    drafts.push(sharpestStep(shape, clues, truth, index));
  });

  // A draft is built around one card, but the position and sentences it hands
  // the player are not that card's private property: one clue can crack open
  // several cards at once, and often the card the step was built for is the one
  // that falls out *last*. Naming only that card dots the conclusion and hides
  // the deduction — so each step names everything its own outlined clues force.
  //
  // A draft that forces nothing is dropped rather than shipped: `pickHint`
  // ranks by fewest clues, so a step outlining none of them would win every
  // contest and assert its card with no argument at all.
  const steps = drafts.flatMap((d) => {
    const reveals = revealsFor(shape, clues, truth, d);
    return reveals.length === 0 ? [] : [{ ...d, reveals }];
  });

  // Both families can land on the same step — on a card whose minimal path is
  // already the whole board, say — and `pickHint` would then rank a duplicate
  // against itself.
  const seen = new Set<string>();
  return steps.filter((s) => {
    const key = `${s.reveals}|${s.flipped}|${s.clues}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every not-yet-flipped card that `draft`'s outlined clues force at its position. */
function revealsFor(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  draft: { flipped: number[]; clues: number[] },
): number[] {
  const outlined = clues.map((h, j) => (draft.clues.includes(j) ? h : null));
  const forced = forcedGiven(shape, outlined, truth, draft.flipped);
  return forced.flatMap((v, i) => (v !== null && !draft.flipped.includes(i) ? [i] : []));
}

/**
 * The step for `index` at its fullest position: every other card flipped, then
 * cut back to the clues and cards that deduction actually rests on.
 *
 * Clues come out first and cards second, because clues are what the player
 * reads: a step outlining one sentence and naming nine known cards is a better
 * hint than one outlining five sentences and naming two, even though the second
 * asks less of the board. Dropping clues greedily leaves a set no single clue
 * can come out of, which is usually one; the explicit single-clue sweep after it
 * is for the cases where greedy order strands two clues that either could have
 * done alone.
 */
function sharpestStep(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  index: number,
): { flipped: number[]; clues: number[] } {
  const others = clues.map((_, i) => i).filter((i) => i !== index);
  const holds = (active: Clues, flipped: number[]) =>
    forcedGiven(shape, active, truth, flipped)[index] === truth[index];

  let active = clues;
  let outlined: number[] = [];
  for (const i of others) {
    if (active[i] === null) continue;
    const without = [...active];
    without[i] = null;
    if (holds(without, others)) active = without;
    else outlined.push(i);
  }

  if (outlined.length > 1) {
    for (const i of outlined) {
      const only = clues.map((h, j) => (j === i ? h : null));
      if (!holds(only, others)) continue;
      active = only;
      outlined = [i];
      break;
    }
  }

  // Now the cards. A card carrying an outlined clue has to stay flipped for the
  // player to read it; the rest are here only for their known value.
  let flipped = others;
  for (const i of others) {
    if (outlined.includes(i)) continue;
    const without = flipped.filter((x) => x !== i);
    if (holds(active, without)) flipped = without;
  }
  return { flipped, clues: outlined };
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
