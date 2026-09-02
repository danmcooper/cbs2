/**
 * Generates one puzzle at the shipped 4x5 size and checks it is sound.
 *
 * The test suite generates on a 4x4 board, because solving enumerates all
 * 2^(width*height) assignments and 4x5 is sixteen times dearer — that is what
 * keeps `npm test` in seconds. Nothing in generation is 4x5-specific, but "not
 * specific" is an argument, not evidence, so this runs the real thing: the real
 * archive's clue mix, the real calibrated bands, the real board.
 *
 * Opt-in (`npm run test:generate`), and worth a minute before regenerating the
 * archive with `npm run generate`.
 *
 *   npm run test:generate              # aims at Medium, seed 1, on the 4x5 board
 *   npm run test:generate Brutal 7     # aims at a given label and seed
 *   npm run test:generate Medium 1 5x6 # on a board the archive has none of
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validatePuzzle } from '../shared/puzzle.ts';
import { archiveClueMix } from '../shared/solver/corpus.ts';
import { bandsFor, classify, loadBands, measure } from '../shared/solver/difficulty.ts';
import { generatePuzzle, professionShapesFor } from '../shared/solver/generate.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { parseHint } from '../shared/solver/hint.ts';
import { forcedGiven, isUniquelySolvable, parseClues, solveChain } from '../shared/solver/solve.ts';

const [label = 'Medium', seedArg, boardArg = '4x5'] = process.argv.slice(2);
const seed = Number(seedArg ?? 1);
const board = /^(\d+)x(\d+)$/.exec(boardArg);
if (!board) {
  console.error(`board must look like 4x5, got ${boardArg}`);
  process.exit(2);
}
const [width, height] = [Number(board[1]), Number(board[2])];

const bands = loadBands(
  JSON.parse(await readFile(path.join(process.cwd(), 'config', 'difficulty.json'), 'utf8')),
);
const band = bands[label];
if (!band) {
  console.error(`no calibrated band for ${label} — have ${Object.keys(bands).join(', ')}`);
  process.exit(2);
}

const mix = archiveClueMix();
// Bands are calibrated on the archive's 4x5 board; on any other board they have
// to be refitted to it before a label off them means anything.
const boardBands = bandsFor(bands, width * height);
const startedAt = Date.now();
const { puzzle, metrics } = generatePuzzle({
  date: '2026-01-01',
  difficulty: label,
  band,
  seed,
  mix,
  width,
  height,
  labelOf: (m) => classify(boardBands, m),
});
const seconds = (Date.now() - startedAt) / 1000;

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
};

try {
  validatePuzzle(puzzle);
} catch (e) {
  failures.push(`schema: ${(e as Error).message}`);
}

check(
  puzzle.width === width && puzzle.height === height,
  `board is ${puzzle.width}x${puzzle.height}, not ${boardArg}`,
);

const shape = {
  grid: makeGrid(puzzle.width, puzzle.height),
  professions: puzzle.people.map((p) => p.profession),
};
const clues = parseClues(puzzle.people.map((p) => p.origHint));
const truth = puzzle.people.map((p) => p.criminal);
check(isUniquelySolvable(shape, clues, truth), 'not uniquely solvable');
check(solveChain(shape, clues, truth, puzzle.initialReveals).solvedAll, 'chain does not solve every card');

puzzle.people.forEach((person, i) => {
  if (!puzzle.initialReveals.includes(i)) {
    check((person.paths ?? []).length > 0, `card ${i} has no sufficient path`);
  }
  // (?!\d) so "#NAMES:1" does not match a clue that names card 11.
  if (person.clue) {
    check(!new RegExp(`#NAMES?:${i}(?!\\d)`).test(person.clue), `card ${i} hosts a clue about itself`);
  }
});

// Hints have to be deductions the player can act on: every card the step claims
// deducible from the sentences it outlines and nothing else, no card it forces
// left unnamed, and at least one offer available from the opening position.
// Shipping solveChain's rounds verbatim satisfied none of it.
const hints = puzzle.hints ?? [];
const hintable = new Set(hints.flatMap((s) => s.reveals));
const forcedBy = (s: (typeof hints)[number]) => {
  const outlined = clues.map((h, j) => (s.clues.includes(j) ? h : null));
  const forced = forcedGiven(shape, outlined, truth, s.flipped);
  return forced.flatMap((v, i) => (v !== null && !s.flipped.includes(i) ? [i] : []));
};
check(
  hints.every((s) => `${forcedBy(s)}` === `${[...s.reveals].sort((a, b) => a - b)}`),
  "a hint's outlined clues do not deduce exactly the cards it names",
);
check(
  puzzle.people.every((_, i) => puzzle.initialReveals.includes(i) || hintable.has(i)),
  'some card has no hint step',
);
check(
  hints.some((s) => s.flipped.every((i) => puzzle.initialReveals.includes(i))),
  'no hint is available from the opening position',
);

// The stored label has to be reproducible from the puzzle's own metrics — the
// same invariant scripts/audit-dan.mts enforces across the whole archive.
check(puzzle.difficulty === classify(boardBands, metrics), `label ${puzzle.difficulty} is not what its metrics classify as`);
const remeasured = measure({
  shape,
  clues,
  truth,
  initialReveals: puzzle.initialReveals,
  paths: puzzle.people.map((p) => p.paths ?? []),
});
check(classify(boardBands, remeasured) === puzzle.difficulty, 'label does not survive re-measuring the written puzzle');

// The cast's profession grouping has to be one the generator was offered. Every
// archived shape covers exactly twenty cards, so at 4x5 that is the archive's
// own set; on any other board it is what `professionShapesFor` refitted from it.
const groups = new Map<string, number>();
for (const person of puzzle.people) groups.set(person.profession, (groups.get(person.profession) ?? 0) + 1);
const castShape = [...groups.values()].sort((a, b) => b - a).join(',');
const offered = new Set(
  professionShapesFor(mix.professionShapes, width * height).map((s) => s.join(',')),
);
check(offered.has(castShape), `profession shape [${castShape}] is not one of the offered shapes`);

// Names are how a clue points at a card, so the cast has to stay findable: in
// reading order, all distinct, and sharing an initial only where the alphabet
// runs out — which it does above twenty-six cards.
const names = puzzle.people.map((p) => p.name);
check(`${names}` === `${[...names].sort()}`, 'cast is not in alphabetical order');
check(new Set(names).size === names.length, 'two cards carry the same name');
check(
  new Set(names.map((n) => n[0])).size === Math.min(names.length, 26),
  'cast shares more initials than the alphabet forces',
);

const preds = new Map<string, number>();
for (const person of puzzle.people) {
  if (person.origHint) preds.set(parseHint(person.origHint).pred, (preds.get(parseHint(person.origHint).pred) ?? 0) + 1);
}

console.log(
  [
    `aimed at ${label}, seed ${seed}, ${boardArg} — generated in ${seconds.toFixed(1)}s`,
    `labelled ${puzzle.difficulty}: ${metrics.criminals} criminals, ${metrics.clueCards} clues, ` +
      `chain ${metrics.chainLength}, abstract share ${metrics.abstractShare.toFixed(2)}`,
    `cast [${castShape}], ${preds.size} distinct predicates, worst repeat ${Math.max(...preds.values())}`,
  ].join('\n'),
);

if (failures.length > 0) {
  console.error(`\nFAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nOK');
