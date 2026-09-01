import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Puzzle, validatePuzzle } from '../puzzle';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import { type Board, hintFeatures, makeBoard, unitMembers } from './predicates';

export interface ArchivePuzzle {
  file: string;
  puzzle: Puzzle;
  board: Board;
}

const PUZZLES_DIR = path.join(process.cwd(), 'puzzles');

export function boardFor(puzzle: Puzzle): Board {
  return makeBoard(
    makeGrid(puzzle.width, puzzle.height),
    puzzle.people.map((p) => p.profession),
    puzzle.people.map((p) => p.criminal),
  );
}

/** Real (non-Dan) archived puzzles, in date order. */
export function loadArchive(dir: string = PUZZLES_DIR): ArchivePuzzle[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((file) => {
      const puzzle = validatePuzzle(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
      return { file, puzzle, board: boardFor(puzzle) };
    });
}

/**
 * How often the archive reaches for each predicate and each unit kind, as
 * shares that sum to one.
 *
 * The candidate pool is combinatorial, so its composition reflects how many
 * ways a predicate can be instantiated rather than how often the source site
 * uses it: `between` is 58% of the pool's unit slots (there are 70 between
 * segments on a 4x5 board against 5 rows and 4 columns) and
 * `units_share_n_traits` is 35% of the pool (it is quadratic in unit count),
 * while `number_of_traits_in_unit` — the archive's single most common clue — is
 * 1.1%. Drawing uniformly from the pool therefore reproduces the pool's shape,
 * not the archive's. These shares are what generation re-weights toward.
 */
export interface ClueMix {
  pred: Record<string, number>;
  /** Shares of the hint features of `hintFeatures` — `unit:<kind>` per unit
   * argument, with between segments keyed by span length, plus `dir:<dx>,<dy>`
   * for the directional families. */
  feature: Record<string, number>;
  /**
   * Each archived puzzle's profession group sizes, descending — one entry per
   * puzzle, each summing to twenty. Generation samples a whole observed shape
   * rather than modelling one, which gets the raggedness (mostly 2s and 3s over
   * 7-11 professions), the rarity of singletons, and even the one themed
   * 16-profession cast at its true rate, all from a single uniform draw. It
   * rides along in the clue mix because it comes from the same read of the same
   * archive and goes to the same caller; splitting it out would mean two passes
   * over the directory and two arguments threaded to the same place.
   */
  professionShapes: number[][];
}

/**
 * Predicates the generator may use that no archived clue does, each mapped to
 * the attested predicate whose rate sets its budget.
 *
 * The source compares one trait across two units ("more criminals in row 1 than
 * row 4") and two traits within one unit ("more criminals than innocents in row
 * 1"), and never both at once. That gap looks like an accident of what the
 * source happened to write rather than a rule of the game: "there are as many
 * innocent cooks as criminal cops" is an ordinary deduction, and the generator
 * is short of comparison shapes without it.
 *
 * A mix read straight off the archive gives such a predicate share 0, and
 * `orderPool` multiplies by that share, so it would be generated never. Hence an
 * explicit budget rather than a measured one.
 */
export const CROSS_TRAIT: Record<string, string> = {
  more_traits_in_unit_than_traits_in_unit: 'more_traits_in_unit_than_unit',
  equal_traits_in_unit_and_traits_in_unit: 'equal_number_of_traits_in_units',
};

/** What fraction of its attested parent's rate each `CROSS_TRAIT` predicate
 * gets. A third puts the pair together at rather less than one clue per puzzle:
 * present, not a tic. */
export const CROSS_TRAIT_RATE = 1 / 3;

function shares(counts: Map<string, number>): Record<string, number> {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return Object.fromEntries([...counts].map(([k, n]) => [k, n / total]));
}

export function archiveClueMix(dir: string = PUZZLES_DIR): ClueMix {
  const pred = new Map<string, number>();
  const feature = new Map<string, number>();
  const professionShapes: number[][] = [];
  for (const { puzzle, board } of loadArchive(dir)) {
    const group = new Map<string, number>();
    for (const person of puzzle.people) {
      group.set(person.profession, (group.get(person.profession) ?? 0) + 1);
    }
    professionShapes.push([...group.values()].sort((a, b) => b - a));
    for (const person of puzzle.people) {
      if (!person.origHint) continue;
      const hint = parseHint(person.origHint);
      pred.set(hint.pred, (pred.get(hint.pred) ?? 0) + 1);
      for (const f of hintFeatures(board, hint)) feature.set(f, (feature.get(f) ?? 0) + 1);
    }
  }
  // Budgeted before normalising, so the invented predicates dilute the attested
  // ones the same way one more archived clue of their kind would have.
  for (const [invented, parent] of Object.entries(CROSS_TRAIT)) {
    pred.set(invented, (pred.get(parent) ?? 0) * CROSS_TRAIT_RATE);
  }
  return { pred: shares(pred), feature: shares(feature), professionShapes };
}

/** True when card `index` is a member of a unit its own clue talks about — the
 * source phrases these in the first person ("in my row"), which our renderer
 * deliberately does not produce. */
export function isSelfReferential(puzzle: Puzzle, index: number): boolean {
  const origHint = puzzle.people[index].origHint;
  if (!origHint) return false;
  const board = boardFor(puzzle);
  return parseHint(origHint).args.some(
    (a) => a.t === 'unit' && unitMembers(board, a.unit).includes(index),
  );
}
