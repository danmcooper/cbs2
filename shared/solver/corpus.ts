import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Puzzle, validatePuzzle } from '../puzzle';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import { type Board, unitMembers } from './predicates';

export interface ArchivePuzzle {
  file: string;
  puzzle: Puzzle;
  board: Board;
}

const PUZZLES_DIR = path.join(process.cwd(), 'puzzles');

export function boardFor(puzzle: Puzzle): Board {
  return {
    grid: makeGrid(puzzle.width, puzzle.height),
    professions: puzzle.people.map((p) => p.profession),
    criminal: puzzle.people.map((p) => p.criminal),
  };
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
