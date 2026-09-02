/**
 * The SAT engine against the archive, on real clues rather than generated ones.
 *
 * The differential test proves agreement on random 4x4 boards; this proves the
 * encoder covers what the game actually contains, and that it agrees on the
 * positions a player passes through. It also times both engines at 4x5 and runs
 * the SAT engine alone at 5x6, which the enumerator cannot reach at all.
 *
 * Run: npx tsx scripts/check-sat.mts [puzzlesDir]
 * Exits non-zero on any unsupported clue or any disagreement.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Puzzle } from '../shared/puzzle.ts';
import { VARIANTS } from '../shared/puzzle.ts';
import { forcedGivenSat, isUniquelySolvableSat, supports } from '../shared/solver/backbone.ts';
import type { Shape } from '../shared/solver/enumerate.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { evaluate, makeBoard } from '../shared/solver/predicates.ts';
import { makeSampleCtx, randomTrueClue } from '../shared/solver/sample.ts';
import { type Clues, forcedGiven, isUniquelySolvable, parseClues } from '../shared/solver/solve.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUZZLES = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'puzzles');
const PUZZLE_FILE = new RegExp(
  `^\\d{4}-\\d{2}-\\d{2}(${Object.values(VARIANTS).map((v) => v.suffix).join('|')})?\\.json$`,
);

interface Loaded {
  file: string;
  shape: Shape;
  clues: Clues;
  truth: boolean[];
}

async function loadAll(): Promise<Loaded[]> {
  const names = (await readdir(PUZZLES)).filter((n) => PUZZLE_FILE.test(n)).sort();
  const out: Loaded[] = [];
  for (const file of names) {
    const puzzle = JSON.parse(await readFile(path.join(PUZZLES, file), 'utf8')) as Puzzle;
    out.push({
      file,
      shape: { grid: makeGrid(puzzle.width, puzzle.height), professions: puzzle.people.map((p) => p.profession) },
      clues: parseClues(puzzle.people.map((p) => p.origHint)),
      truth: puzzle.people.map((p) => p.criminal),
    });
  }
  return out;
}

const ms = (f: () => void): number => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

/** The positions a player actually passes through: reveal cards one at a time. */
function walkthrough(l: Loaded): number[][] {
  const out: number[][] = [[]];
  const flipped: number[] = [];
  for (let i = 0; i < l.shape.grid.size; i++) {
    flipped.push(i);
    out.push([...flipped]);
  }
  return out;
}

const failures: string[] = [];

const puzzles = await loadAll();
console.log(`${puzzles.length} puzzles in ${path.relative(ROOT, PUZZLES)}\n`);

// --- coverage: every clue the archive contains must encode ---
const byPred = new Map<string, number>();
const unsupported = new Map<string, number>();
for (const l of puzzles) {
  for (const h of l.clues) {
    if (!h) continue;
    byPred.set(h.pred, (byPred.get(h.pred) ?? 0) + 1);
    if (!supports(h)) unsupported.set(h.pred, (unsupported.get(h.pred) ?? 0) + 1);
  }
}
const total = [...byPred.values()].reduce((a, b) => a + b, 0);
console.log(`clues: ${total} across ${byPred.size} predicates`);
if (unsupported.size > 0) {
  for (const [pred, n] of [...unsupported].sort((a, b) => b[1] - a[1])) {
    failures.push(`unsupported predicate ${pred} (${n} clues)`);
  }
} else {
  console.log('coverage: every clue in the archive encodes\n');
}

// --- agreement: same answer as the enumerator, on every position of every puzzle ---
let compared = 0;
let brute = 0;
let sat = 0;
for (const l of puzzles) {
  for (const flipped of walkthrough(l)) {
    let want: ReturnType<typeof forcedGiven> | null = null;
    let got: ReturnType<typeof forcedGivenSat> | null = null;
    brute += ms(() => {
      want = forcedGiven(l.shape, l.clues, l.truth, flipped);
    });
    sat += ms(() => {
      got = forcedGivenSat(l.shape, l.clues, l.truth, flipped);
    });
    compared++;
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      failures.push(`${l.file}: disagreement after ${flipped.length} reveals`);
      break;
    }
  }
  const wantU = isUniquelySolvable(l.shape, l.clues, l.truth);
  const gotU = isUniquelySolvableSat(l.shape, l.clues, l.truth);
  if (wantU !== gotU) failures.push(`${l.file}: uniqueness disagreement (${wantU} vs ${gotU})`);
}
console.log(`agreement: ${compared} positions compared, ${failures.length} disagreements`);
console.log(`  enumerate ${(brute / 1000).toFixed(1)}s   sat ${(sat / 1000).toFixed(1)}s   ${(brute / sat).toFixed(0)}x\n`);

// --- 5x6, which the enumerator cannot reach ---
const grid = makeGrid(5, 6);
const PROFS = ['cook', 'clerk', 'doctor', 'cop', 'teacher'];
let seed = 20260901;
const rng = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const big: Shape = {
  grid,
  professions: Array.from({ length: 30 }, () => PROFS[Math.floor(rng() * PROFS.length)]),
};
const bigTruth = Array.from({ length: 30 }, () => rng() < 0.35);

// A clue mix drawn predicate-by-predicate from the archive's own proportions, so
// the timing reflects the encodings the game really produces. Weighting matters:
// a board carrying nothing but `number_of_traits_in_unit` would be the cheapest
// thing the encoder can be asked to do and would say nothing about the rest.
const mixed: Clues = Array.from({ length: 30 }, () => null);
{
  const weighted = [...byPred.entries()].flatMap(([pred, n]) => Array<string>(n).fill(pred));
  const board = makeBoard(grid, big.professions, bigTruth);
  const ctx = makeSampleCtx(rng, board, big, bigTruth);
  const placedPreds = new Map<string, number>();
  let placed = 0;
  for (let attempt = 0; attempt < 200000 && placed < 24; attempt++) {
    const hint = randomTrueClue(ctx, [weighted[Math.floor(rng() * weighted.length)]]);
    if (!hint || !supports(hint) || !evaluate(board, hint)) continue;
    const slot = Math.floor(rng() * 30);
    if (mixed[slot] !== null) continue;
    mixed[slot] = hint;
    placedPreds.set(hint.pred, (placedPreds.get(hint.pred) ?? 0) + 1);
    placed++;
  }
  console.log(`5x6 board: ${placed} clues over ${placedPreds.size} predicates`);
}

let bigTotal = 0;
let calls = 0;
for (let i = 0; i <= 30; i++) {
  const flipped = [...Array(i).keys()];
  bigTotal += ms(() => forcedGivenSat(big, mixed, bigTruth, flipped));
  calls++;
}
console.log(`  walkthrough ${bigTotal.toFixed(1)} ms over ${calls} calls`);
console.log(`  uniqueness  ${ms(() => isUniquelySolvableSat(big, mixed, bigTruth)).toFixed(2)} ms`);

console.log();
for (const f of failures) console.log(`FAIL ${f}`);
if (failures.length > 0) process.exitCode = 1;
else console.log('all checks passed');
