/**
 * Independent audit of every generated Dan puzzle in `puzzles/`.
 *
 * Deliberately re-derives everything from the puzzle file alone rather than
 * trusting anything the generator recorded: it re-parses the `origHint`
 * strings, re-solves from scratch, and re-measures difficulty. A puzzle that
 * passes here is playable and fair no matter what the generator believed.
 *
 * Run: npx tsx scripts/audit-dan.mts [puzzlesDir]
 * Exits non-zero if any check fails on any file.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Puzzle } from '../shared/puzzle.ts';
import { validatePuzzle } from '../shared/puzzle.ts';
import { namedCards } from '../shared/solver/candidates.ts';
import type { Bands } from '../shared/solver/difficulty.ts';
import { classify, loadBands, measure } from '../shared/solver/difficulty.ts';
import type { Shape } from '../shared/solver/enumerate.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { makeBoard } from '../shared/solver/predicates.ts';
import {
  type Clues,
  forcedGiven,
  isUniquelySolvable,
  parseClues,
  solveChain,
} from '../shared/solver/solve.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A directory argument lets this be pointed at a scratch copy — which is how it
// gets mutation-tested, without writing anything into the real archive.
const PUZZLES = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'puzzles');
const DAN_FILE = /^\d{4}-\d{2}-\d{2}-dan\.json$/;
const REAL_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

interface Loaded {
  file: string;
  puzzle: Puzzle;
  shape: Shape;
  clues: Clues;
  truth: boolean[];
}

/**
 * The source site's *authored* prose: puzzle titles, and the chatter on cards
 * that carry no logical clue. These are its creative, commercial content and
 * nothing we ship may reproduce them.
 *
 * Deliberately excludes rendered clue sentences, even though they are also
 * strings the site wrote. A clue is the mechanical rendering of a predicate —
 * "Exactly 2 criminals in row 1 have a criminal directly below them" is
 * `n_t_in_unit_have_trait_in_dir(unit(row,1),criminal,criminal,0,1,2)` and
 * nothing else — and `shared/solver/render.ts` is *required* to reproduce the
 * site's templates verbatim, which is exactly what the renderer-fidelity
 * corpus test enforces against all 54 archived puzzles. A finite template set
 * over a finite parameter space collides by arithmetic, not by copying: four
 * of the first 54 generated puzzles produced a clue string that also occurs
 * somewhere in the archive, each time for a different logical reason on a
 * different board. Banning those would mean either shipping clues that render
 * wrongly or refusing valid puzzles for a coincidence, so the ban covers
 * authored prose only.
 */
async function archiveProse(files: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const file of files) {
    const p = validatePuzzle(JSON.parse(await readFile(path.join(PUZZLES, file), 'utf8')));
    seen.add(p.title.trim());
    // A card with no `origHint` carries flavour text rather than a clue.
    for (const person of p.people) {
      if (person.origHint === null && person.clue) seen.add(person.clue.trim());
    }
  }
  return seen;
}

function load(file: string, puzzle: Puzzle): Loaded {
  const grid = makeGrid(puzzle.width, puzzle.height);
  const professions = puzzle.people.map((p) => p.profession);
  return {
    file,
    puzzle,
    shape: { grid, professions },
    clues: parseClues(puzzle.people.map((p) => p.origHint)),
    truth: puzzle.people.map((p) => p.criminal),
  };
}

/** Returns one message per failed check; empty means the puzzle is sound. */
function audit(l: Loaded, banned: Set<string>, bands: Bands): string[] {
  const bad: string[] = [];
  const { puzzle, shape, clues, truth } = l;
  const size = shape.grid.size;

  if (puzzle.variant !== 'dan') bad.push(`variant is ${String(puzzle.variant)}, expected 'dan'`);
  if (puzzle.source !== 'generated') bad.push(`source is ${puzzle.source}, expected 'generated'`);
  if (`${puzzle.date}-dan.json` !== l.file) bad.push(`date ${puzzle.date} does not match filename`);

  // Fairness. The strict form: every card recoverable from clue text alone,
  // with nothing handed to the player up front.
  if (!isUniquelySolvable(shape, clues, truth)) {
    bad.push('not uniquely solvable from zero reveals');
  }
  const chain = solveChain(shape, clues, truth, puzzle.initialReveals);
  if (!chain.solvedAll) bad.push('deduction chain stalls before every card is revealed');

  // No guessing: each non-initial card must carry at least one stored path,
  // and every stored path must actually suffice to deduce that card.
  const initial = new Set(puzzle.initialReveals);
  for (let i = 0; i < size; i++) {
    const paths = puzzle.people[i].paths;
    if (initial.has(i)) continue;
    if (paths === null || paths.length === 0) {
      bad.push(`card ${i} has no path — the player would have to guess it`);
      continue;
    }
    for (const flipped of paths) {
      if (forcedGiven(shape, clues, truth, flipped)[i] !== truth[i]) {
        bad.push(`card ${i}: stored path [${flipped.join(',')}] does not deduce it`);
      }
    }
  }

  // A clue may not name the card it sits on.
  const board = makeBoard(shape.grid, shape.professions, truth);
  for (let i = 0; i < size; i++) {
    const hint = clues[i];
    if (hint && namedCards(board, hint).has(i)) {
      bad.push(`card ${i}: its own clue refers to it`);
    }
  }

  // The stored difficulty must be the one the puzzle's own metrics earn.
  // Generation no longer rejects a puzzle for missing a band — it labels it
  // by what it measured — so the invariant worth checking is that the label
  // on disk is reproducible from the puzzle itself, not that it falls inside
  // some band it was never required to hit.
  if (!bands[puzzle.difficulty]) {
    bad.push(`difficulty ${puzzle.difficulty} has no calibrated band`);
  } else {
    const metrics = measure({
      shape,
      clues,
      truth,
      initialReveals: puzzle.initialReveals,
      paths: puzzle.people.map((p) => p.paths),
    });
    const earned = classify(bands, metrics);
    if (earned !== puzzle.difficulty) {
      bad.push(
        `labelled ${puzzle.difficulty} but its metrics classify as ${earned}: ` +
          `clueCards=${metrics.clueCards} chainLength=${metrics.chainLength} ` +
          `abstractShare=${metrics.abstractShare.toFixed(2)} ` +
          `meanPathSize=${metrics.meanPathSize.toFixed(2)}`,
      );
    }
  }

  // Nothing we ship may reproduce the source site's authored prose.
  if (banned.has(puzzle.title.trim())) bad.push(`title "${puzzle.title}" appears in the archive`);
  for (let i = 0; i < size; i++) {
    const person = puzzle.people[i];
    if (person.origHint !== null) continue;
    if (person.clue && banned.has(person.clue.trim())) {
      bad.push(`card ${i}: flavour text appears in the archive`);
    }
  }

  return bad;
}

async function main(): Promise<void> {
  const files = await readdir(PUZZLES);
  const dan = files.filter((f) => DAN_FILE.test(f)).sort();
  const real = files.filter((f) => REAL_FILE.test(f)).sort();
  if (dan.length === 0) {
    console.error('no -dan.json files to audit');
    process.exit(1);
  }

  const banned = await archiveProse(real);
  const bands = loadBands(
    JSON.parse(await readFile(path.join(ROOT, 'config', 'difficulty.json'), 'utf8')),
  );
  console.log(`auditing ${dan.length} Dan puzzles against ${real.length} real ones`);

  const byLabel = new Map<string, number>();
  let failed = 0;
  for (const file of dan) {
    let bad: string[];
    let label = '?';
    try {
      const puzzle = validatePuzzle(JSON.parse(await readFile(path.join(PUZZLES, file), 'utf8')));
      label = puzzle.difficulty;
      bad = audit(load(file, puzzle), banned, bands);
    } catch (e) {
      bad = [`threw: ${String(e)}`];
    }
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
    if (bad.length > 0) {
      failed++;
      console.log(`FAIL ${file}`);
      for (const line of bad) console.log(`     ${line}`);
    }
  }

  console.log(`\n${dan.length - failed}/${dan.length} sound`);
  console.log(
    [...byLabel].sort().map(([k, v]) => `${k}=${v}`).join(' '),
  );
  process.exit(failed === 0 ? 0 : 1);
}

await main();
