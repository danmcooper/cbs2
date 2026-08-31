import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { validatePuzzle } from '../shared/puzzle.ts';
import type { LabelBand } from '../shared/solver/difficulty.ts';
import { classify, loadBands, measure } from '../shared/solver/difficulty.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { isUniquelySolvable, parseClues, solveChain } from '../shared/solver/solve.ts';
import {
  type GenerateProgress,
  type GenerateRunResult,
  runGenerate,
  seedForDate,
  unionCriminals,
} from './generate.mts';

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
    abstractShare: { min: 0, max: 1 },
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

      expect(result.written).toEqual([{ date: '2026-07-01', label: 'Easy', aimedAt: 'Easy' }]);
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
      expect(third.written).toEqual([{ date: '2026-07-01', label: 'Easy', aimedAt: 'Easy' }]);
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
      expect(result.written).toEqual([{ date: '2026-07-01', label: 'Easy', aimedAt: 'Easy' }]);
      expect(result.failed).toEqual([{ date: '2026-07-02', reason: 'no calibrated band for Brutal' }]);
    },
    60_000,
  );
});

// --- Labelling by measurement, not by the label that was aimed at ------------
//
// Generation aims at the real puzzle's difficulty but never rejects for
// missing it; the puzzle that comes out is measured and labelled with
// whatever `classify` says it is. "Alpha" here admits only chainLength 7
// exactly, so it is the label a puzzle earns only by landing on the nose;
// "Beta" is wide enough to accept any valid attempt. Both are legitimate
// destinations, and which one the run picks is decided by the generated
// puzzle's own metrics rather than by which label was requested.
const alphaBand: LabelBand = {
  samples: 5,
  criminals: { min: 4, max: 16 },
  clueCards: { min: 0, max: 20 },
  chainLength: { min: 7, max: 7 },
  meanRevealsPerStep: { min: 0, max: 20 },
  meanPathSize: { min: 0, max: 20 },
  abstractShare: { min: 0, max: 1 },
};
const betaBand: LabelBand = {
  samples: 5,
  criminals: { min: 4, max: 16 },
  clueCards: { min: 0, max: 20 },
  chainLength: { min: 0, max: 20 },
  meanRevealsPerStep: { min: 0, max: 20 },
  meanPathSize: { min: 0, max: 20 },
  abstractShare: { min: 0, max: 1 },
};

async function twoLabelFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cbs-generate-label-'));
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

describe('runGenerate labels by measurement', () => {
  let dir: string;
  let bandsPath: string;
  let result: GenerateRunResult;
  let progress: GenerateProgress[];

  beforeAll(async () => {
    ({ dir, bandsPath } = await twoLabelFixture());
    progress = [];
    result = await runGenerate({ puzzlesDir: dir, bandsPath, onProgress: (e) => progress.push(e) });
  }, 120_000);

  it('writes one puzzle per date, discarding nothing', () => {
    expect(result.failed).toEqual([]);
    expect(result.written.map((w) => w.date)).toEqual(['2026-07-01', '2026-07-02']);
    // Each date aimed at its own real puzzle's label, whatever it ended up as.
    expect(result.written.map((w) => w.aimedAt)).toEqual(['Alpha', 'Beta']);
  });

  it('gives every puzzle a calibrated label its own metrics earn', async () => {
    const parsedBands = loadBands(JSON.parse(await readFile(bandsPath, 'utf8')));

    for (const { date, label } of result.written) {
      const puzzle = validatePuzzle(
        JSON.parse(await readFile(path.join(dir, `${date}-dan.json`), 'utf8')),
      );
      expect(puzzle.date).toBe(date);
      expect(puzzle.difficulty).toBe(label);
      expect(Object.keys(parsedBands)).toContain(label);

      const shape = {
        grid: makeGrid(puzzle.width, puzzle.height),
        professions: puzzle.people.map((p) => p.profession),
      };
      const clues = parseClues(puzzle.people.map((p) => p.origHint));
      const truth = puzzle.people.map((p) => p.criminal);
      const paths = puzzle.people.map((p) => p.paths ?? []);
      const metrics = measure({ shape, clues, truth, initialReveals: puzzle.initialReveals, paths });

      // The label on disk is exactly what the file's own contents classify as,
      // re-derived here from the JSON rather than trusted from the run.
      expect(classify(parsedBands, metrics)).toBe(label);

      // Dropping the band gate must not drop any correctness guarantee.
      expect(isUniquelySolvable(shape, clues, truth)).toBe(true);
      expect(solveChain(shape, clues, truth, puzzle.initialReveals).solvedAll).toBe(true);
      puzzle.people.forEach((person, i) => {
        if (puzzle.initialReveals.includes(i)) return;
        expect(person.paths, `${date} people[${i}]`).not.toBeNull();
        expect((person.paths as number[][]).length).toBeGreaterThan(0);
      });
    }
  });

  it('reports each date as it is settled rather than only at the end', () => {
    // A backfill runs for the better part of an hour, so the callback firing
    // per date — not once at the end — is the whole point of it existing.
    expect(progress).toHaveLength(2);
    expect(progress.map((e) => e.date)).toEqual(['2026-07-01', '2026-07-02']);
    for (const [i, event] of progress.entries()) {
      expect(event.outcome).toBe('written');
      if (event.outcome !== 'written') continue;
      expect(event.label).toBe(result.written[i].label);
      expect(event.aimedAt).toBe(result.written[i].aimedAt);
      expect(event.seconds).toBeGreaterThan(0);
    }
  });
});

// --- Criminals sampling uses the union of all calibrated labels (task-20
// addendum, second correction) ----------------------------------------------
//
// Criminal count carries no difficulty signal in the archive (Medium/Tricky/
// Hard cluster within 0.23 of each other's mean; the Easy/Brutal split is an
// artifact of Brutal's 3-sample band). So `runGenerate` must sample criminals
// from the union of every calibrated label's `criminals` range, not the
// target label's own range — see `unionCriminals` in `generate.mts`.

describe('unionCriminals', () => {
  it("spans the min of every label's min and the max of every label's max", () => {
    const twoBands = {
      Narrow: {
        samples: 5,
        criminals: { min: 11, max: 16 },
        clueCards: { min: 0, max: 20 },
        chainLength: { min: 0, max: 20 },
        meanRevealsPerStep: { min: 0, max: 20 },
        meanPathSize: { min: 0, max: 20 },
        abstractShare: { min: 0, max: 1 },
      },
      Wide: {
        samples: 5,
        criminals: { min: 4, max: 10 },
        clueCards: { min: 0, max: 20 },
        chainLength: { min: 0, max: 20 },
        meanRevealsPerStep: { min: 0, max: 20 },
        meanPathSize: { min: 0, max: 20 },
        abstractShare: { min: 0, max: 1 },
      },
    };
    expect(unionCriminals(twoBands)).toEqual({ min: 4, max: 16 });
  });
});

describe('runGenerate samples criminals from the union of all calibrated labels', () => {
  // "Narrow" only calibrates 11-16 criminals; "Wide" calibrates 4-10. Their
  // union is exactly {4,16}. Empirically (see the task report), attempt 0 for
  // 2026-07-02's derived seed lands on 7 criminals when sampled from a
  // {4,16} range — a value only reachable if the criminals range actually
  // handed to `generatePuzzle` was the union, since Narrow's own {11,16}
  // range cannot produce 7. Every other gated field is wide open so this
  // attempt is also a same-attempt success (no extra generation cost).
  const narrowBand: LabelBand = {
    samples: 5,
    criminals: { min: 11, max: 16 },
    clueCards: { min: 0, max: 20 },
    chainLength: { min: 0, max: 20 },
    meanRevealsPerStep: { min: 0, max: 20 },
    meanPathSize: { min: 0, max: 20 },
    abstractShare: { min: 0, max: 1 },
  };
  const wideBand: LabelBand = {
    samples: 5,
    criminals: { min: 4, max: 10 },
    clueCards: { min: 0, max: 20 },
    chainLength: { min: 0, max: 20 },
    meanRevealsPerStep: { min: 0, max: 20 },
    meanPathSize: { min: 0, max: 20 },
    abstractShare: { min: 0, max: 1 },
  };

  it(
    "generates a puzzle whose criminal count falls outside its own label's narrow range",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'cbs-generate-union-'));
      const bandsPath = path.join(dir, 'difficulty.json');
      await writeFile(bandsPath, JSON.stringify({ Narrow: narrowBand, Wide: wideBand }));
      await writeFile(
        path.join(dir, '2026-07-02.json'),
        JSON.stringify(realPuzzle('2026-07-02', 'dddddddddddd', 'Narrow')),
      );

      const result = await runGenerate({ puzzlesDir: dir, bandsPath });
      expect(result.written.map((w) => ({ date: w.date, aimedAt: w.aimedAt }))).toEqual([
        { date: '2026-07-02', aimedAt: 'Narrow' },
      ]);
      expect(result.failed).toEqual([]);

      const raw = JSON.parse(await readFile(path.join(dir, '2026-07-02-dan.json'), 'utf8'));
      const puzzle = validatePuzzle(raw);
      // Which label this earns is decided by `classify` and is not what this
      // test is about — it only has to be a calibrated one.
      expect(['Narrow', 'Wide']).toContain(puzzle.difficulty);
      const criminals = puzzle.people.filter((p) => p.criminal).length;

      // Only reachable if generatePuzzle sampled from the union {4,16}
      // rather than Narrow's own {11,16}.
      expect(criminals).toBeGreaterThanOrEqual(4);
      expect(criminals).toBeLessThan(11);
    },
    60_000,
  );
});
