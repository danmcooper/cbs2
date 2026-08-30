import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { validatePuzzle } from '../shared/puzzle.ts';
import type { LabelBand } from '../shared/solver/difficulty.ts';
import { gatesPass, loadBands, measure } from '../shared/solver/difficulty.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { isUniquelySolvable, parseClues } from '../shared/solver/solve.ts';
import { type GenerateRunResult, runGenerate, seedForDate } from './generate.mts';

// A real puzzle file only needs the fields runGenerate reads plus schema validity.
function realPuzzle(date: string, id: string, difficulty: string) {
  const person = {
    name: 'banda', profession: 'coder', gender: 'male',
    criminal: false, clue: null, origHint: null, paths: [],
  };
  return {
    formatVersion: 1, id, date, title: `Title ${date}`, difficulty,
    width: 1, height: 2, initialReveals: [], source: 'cluesbysam.com',
    people: [person, person],
  };
}

const bands = {
  Easy: {
    samples: 10,
    criminals: { min: 4, max: 7 },
    clueCards: { min: 4, max: 16 },
    chainLength: { min: 2, max: 19 },
    meanRevealsPerStep: { min: 1, max: 8 },
    meanPathSize: { min: 1, max: 12 },
  },
};

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cbs-generate-'));
  const bandsPath = path.join(dir, 'difficulty.json');
  await writeFile(bandsPath, JSON.stringify(bands));
  await writeFile(
    path.join(dir, '2026-07-01.json'),
    JSON.stringify(realPuzzle('2026-07-01', 'aaaaaaaaaaaa', 'Easy')),
  );
  return { dir, bandsPath };
}

describe('seedForDate', () => {
  it('is stable and differs between dates', () => {
    expect(seedForDate('2026-07-01')).toBe(seedForDate('2026-07-01'));
    expect(seedForDate('2026-07-01')).not.toBe(seedForDate('2026-07-02'));
  });
});

describe('runGenerate', () => {
  it(
    'writes a valid Dan sibling and lists it in the manifest',
    async () => {
      const { dir, bandsPath } = await fixture();
      const result = await runGenerate({ puzzlesDir: dir, bandsPath });

      expect(result.written).toEqual(['2026-07-01']);
      expect(result.failed).toEqual([]);
      const raw = JSON.parse(await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8'));
      const puzzle = validatePuzzle(raw);
      expect(puzzle.variant).toBe('dan');
      expect(puzzle.date).toBe('2026-07-01');
      expect(puzzle.difficulty).toBe('Easy');
      expect(puzzle.title).not.toBe('Title 2026-07-01');

      const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
      expect(index.map((e: { slug: string }) => e.slug)).toEqual(['2026-07-01', '2026-07-01-dan']);
    },
    60_000,
  );

  it(
    'skips dates that already have a Dan puzzle, and regenerates identically with force',
    async () => {
      const { dir, bandsPath } = await fixture();
      await runGenerate({ puzzlesDir: dir, bandsPath });
      const first = await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8');

      const second = await runGenerate({ puzzlesDir: dir, bandsPath });
      expect(second.written).toEqual([]);
      expect(second.skipped).toEqual(['2026-07-01']);

      const third = await runGenerate({ puzzlesDir: dir, bandsPath, force: true });
      expect(third.written).toEqual(['2026-07-01']);
      expect(await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8')).toBe(first);
    },
    120_000,
  );

  it(
    'reports a date whose difficulty has no calibrated band without throwing',
    async () => {
      const { dir, bandsPath } = await fixture();
      await writeFile(
        path.join(dir, '2026-07-02.json'),
        JSON.stringify(realPuzzle('2026-07-02', 'cccccccccccc', 'Brutal')),
      );
      const result = await runGenerate({ puzzlesDir: dir, bandsPath });
      expect(result.written).toEqual(['2026-07-01']);
      expect(result.failed).toEqual([{ date: '2026-07-02', reason: 'no calibrated band for Brutal' }]);
    },
    60_000,
  );
});

// --- Cross-label salvage (task-20 addendum) ---------------------------------
//
// `2026-07-01` is asked for label "Alpha", whose band matches only chainLength
// 7 exactly. Empirically (see the task report), attempt 0 for this date/seed
// lands on chainLength 6 — a miss for Alpha — and attempt 1 lands on
// chainLength 7, a hit. Label "Beta"'s band is wide enough to accept virtually
// any valid attempt, including attempt 0's. So generating for 2026-07-01
// reliably throws exactly one off-band candidate (attempt 0) that satisfies
// Beta before succeeding for Alpha on attempt 1 — landing a puzzle in the pool
// for 2026-07-02 (labeled Beta) without ever calling generatePuzzle for it.
const alphaBand: LabelBand = {
  samples: 5,
  criminals: { min: 4, max: 16 },
  clueCards: { min: 0, max: 20 },
  chainLength: { min: 7, max: 7 },
  meanRevealsPerStep: { min: 0, max: 20 },
  meanPathSize: { min: 0, max: 20 },
};
const betaBand: LabelBand = {
  samples: 5,
  criminals: { min: 4, max: 16 },
  clueCards: { min: 0, max: 20 },
  chainLength: { min: 0, max: 20 },
  meanRevealsPerStep: { min: 0, max: 20 },
  meanPathSize: { min: 0, max: 20 },
};

async function salvageFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cbs-generate-salvage-'));
  const bandsPath = path.join(dir, 'difficulty.json');
  await writeFile(bandsPath, JSON.stringify({ Alpha: alphaBand, Beta: betaBand }));
  await writeFile(
    path.join(dir, '2026-07-01.json'),
    JSON.stringify(realPuzzle('2026-07-01', 'aaaaaaaaaaaa', 'Alpha')),
  );
  await writeFile(
    path.join(dir, '2026-07-02.json'),
    JSON.stringify(realPuzzle('2026-07-02', 'bbbbbbbbbbbb', 'Beta')),
  );
  return { dir, bandsPath };
}

describe('runGenerate cross-label salvage', () => {
  let dir: string;
  let bandsPath: string;
  let result: GenerateRunResult;

  beforeAll(async () => {
    ({ dir, bandsPath } = await salvageFixture());
    result = await runGenerate({ puzzlesDir: dir, bandsPath });
  }, 120_000);

  it('salvages the off-band attempt for the second date instead of regenerating', () => {
    expect(result.salvaged).toEqual([{ date: '2026-07-02', fromDate: '2026-07-01', label: 'Beta' }]);
    expect(result.written).toEqual(['2026-07-01', '2026-07-02']);
  });

  it("writes the salvaged puzzle under the destination date and its own label", async () => {
    const raw = JSON.parse(await readFile(path.join(dir, '2026-07-02-dan.json'), 'utf8'));
    const puzzle = validatePuzzle(raw);
    expect(puzzle.date).toBe('2026-07-02');
    expect(puzzle.difficulty).toBe('Beta');
  });

  it('never mislabels: the salvaged puzzle genuinely satisfies the band it claims and is not a guess', async () => {
    const raw = JSON.parse(await readFile(path.join(dir, '2026-07-02-dan.json'), 'utf8'));
    const puzzle = validatePuzzle(raw);
    const parsedBands = loadBands(JSON.parse(await readFile(bandsPath, 'utf8')));

    const shape = {
      grid: makeGrid(puzzle.width, puzzle.height),
      professions: puzzle.people.map((p) => p.profession),
    };
    const clues = parseClues(puzzle.people.map((p) => p.origHint));
    const truth = puzzle.people.map((p) => p.criminal);
    const paths = puzzle.people.map((p) => p.paths ?? []);
    const metrics = measure({ shape, clues, truth, initialReveals: puzzle.initialReveals, paths });

    expect(gatesPass(parsedBands[puzzle.difficulty], metrics)).toBe(true);
    expect(isUniquelySolvable(shape, clues, truth)).toBe(true);
  });
});
