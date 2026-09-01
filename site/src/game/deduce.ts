import type { Puzzle } from '../../../shared/puzzle';
import type { Shape } from '../../../shared/solver/enumerate';
import { makeGrid } from '../../../shared/solver/grid';
import { type Clues, forcedGiven, parseClues } from '../../../shared/solver/solve';

interface Solvable {
  shape: Shape;
  clues: Clues;
  truth: boolean[];
  /** `forcedGiven` results, keyed by the flipped set that produced them. */
  forced: Map<string, (boolean | null)[]>;
}

/** Parsing twenty clues is wasted work to repeat on every guess. */
const solvableCache = new WeakMap<Puzzle, Solvable | null>();

function solvableFor(puzzle: Puzzle): Solvable | null {
  const cached = solvableCache.get(puzzle);
  if (cached !== undefined) return cached;
  let solvable: Solvable | null = null;
  try {
    solvable = {
      shape: {
        grid: makeGrid(puzzle.width, puzzle.height),
        professions: puzzle.people.map((p) => p.profession),
      },
      clues: parseClues(puzzle.people.map((p) => p.origHint)),
      truth: puzzle.people.map((p) => p.criminal),
      forced: new Map(),
    };
  } catch {
    // A scraped puzzle may use a predicate this solver does not implement.
    // Those puzzles keep the stored-path behaviour and nothing else changes.
    solvable = null;
  }
  solvableCache.set(puzzle, solvable);
  return solvable;
}

/** Whether the clues on the flipped cards pin this card's trait outright. */
function isForced(puzzle: Puzzle, flipped: number[], index: number): boolean {
  const solvable = solvableFor(puzzle);
  if (!solvable) return false;
  const key = [...flipped].sort((a, b) => a - b).join(',');
  let forced = solvable.forced.get(key);
  if (!forced) {
    try {
      forced = forcedGiven(solvable.shape, solvable.clues, solvable.truth, flipped);
    } catch {
      return false;
    }
    solvable.forced.set(key, forced);
  }
  return forced[index] !== null;
}

/**
 * Whether the player has enough on the table to justify calling this card.
 *
 * `paths` is the fast answer: the generator (and the source site) record
 * sufficient sets of cards per card, so a matching one settles it without any
 * solving. But those recorded paths are a *sample*, not an enumeration —
 * `minimalPaths` greedily drops cards over a handful of orderings, so it finds
 * a few minimal sufficient sets and misses the rest. Treating that sample as
 * the whole truth counted correct deductions as mistakes: across the 54
 * generated puzzles, 32 of them rejected a card that the flipped clues plainly
 * forced, in one case a card that a single flipped clue announced outright.
 *
 * So a miss falls through to the question the paths were only ever a proxy
 * for: given exactly these flipped cards and their clues, is this card's trait
 * the same in every assignment that survives? That is the real rule of the
 * game, and it needs no puzzle regenerated to be right.
 */
export function isDeducible(puzzle: Puzzle, flipped: number[], index: number): boolean {
  const paths = puzzle.people[index].paths;
  if (paths === null) return true;
  if (paths.some((path) => path.every((i) => flipped.includes(i)))) return true;
  return isForced(puzzle, flipped, index);
}
