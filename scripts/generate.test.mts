import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { validatePuzzle } from '../shared/puzzle.ts';
import type { LabelBand } from '../shared/solver/difficulty.ts';
import { bandsFor, classify, loadBands, measure } from '../shared/solver/difficulty.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { isUniquelySolvable, parseClues, solveChain } from '../shared/solver/solve.ts';
import {
  DEFAULT_VARIANTS,
  randomBoard,
  type GenerateProgress,
  type GenerateRunResult,
  type VariantSpec,
  runGenerate,
  seedForDate,
  unionCriminals,
} from './generate.mts';

// Every test here pins the variants it generates rather than taking the shipped
// list, because the shipped list draws its board and solving is exponential in
// the number of cards — a date that draws 7x7 costs more than this whole file.
// `DEFAULT_VARIANTS` is checked as data instead, in its own describe below.
const DAN_ONLY: VariantSpec[] = [{ variant: 'dan', board: 'inherit', seedSalt: '' }];

// A real puzzle file only needs the fields runGenerate reads plus schema validity
// — but its board is not incidental. A Dan puzzle takes its size and its cast's
// profession grouping from the real puzzle for that date, so this fixture decides
// both. It is 4x4 rather than the shipped 4x5 because solving enumerates all
// 2^(width*height) assignments: one row fewer is sixteen times cheaper, which is
// what lets these tests generate real puzzles in the ordinary suite. Group sizes
// are the archive's ragged shape — trios and pairs, one singleton — cut to
// sixteen cards. `npm run test:generate` covers the shipped size.
const FIXTURE_BOARD = { width: 4, height: 4 };

const FIXTURE_PROFESSIONS = ['coder', 'cop', 'cook']
  .flatMap((p) => [p, p, p])
  .concat(['guard', 'judge', 'pilot'].flatMap((p) => [p, p]))
  .concat(['sleuth']);

function realPuzzle(date: string, id: string, difficulty: string) {
  const people = FIXTURE_PROFESSIONS.map((profession, i) => ({
    name: `banda${i}`, profession, gender: 'male',
    criminal: false, clue: null, origHint: null, paths: [],
  }));
  return {
    formatVersion: 1, id, date, title: `Title ${date}`, difficulty,
    ...FIXTURE_BOARD, initialReveals: [], source: 'cluesbysam.com',
    people,
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
      const result = await runGenerate({ puzzlesDir: dir, bandsPath, variants: DAN_ONLY });

      expect(result.written).toEqual([
        { date: '2026-07-01', variant: 'dan', label: 'Easy', aimedAt: 'Easy' },
      ]);
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
    30_000,
  );

  it(
    'skips dates that already have a Dan puzzle, and regenerates identically with force',
    async () => {
      const { dir, bandsPath } = await fixture();
      await runGenerate({ puzzlesDir: dir, bandsPath, variants: DAN_ONLY });
      const first = await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8');

      const second = await runGenerate({ puzzlesDir: dir, bandsPath, variants: DAN_ONLY });
      expect(second.written).toEqual([]);
      expect(second.skipped).toEqual([{ date: '2026-07-01', variant: 'dan' }]);

      const third = await runGenerate({
        puzzlesDir: dir,
        bandsPath,
        variants: DAN_ONLY,
        force: true,
      });
      expect(third.written).toEqual([
        { date: '2026-07-01', variant: 'dan', label: 'Easy', aimedAt: 'Easy' },
      ]);
      expect(await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8')).toBe(first);
    },
    30_000,
  );

  it(
    'reports a date whose difficulty has no calibrated band without throwing',
    async () => {
      const { dir, bandsPath } = await fixture();
      await writeFile(
        path.join(dir, '2026-07-02.json'),
        JSON.stringify(realPuzzle('2026-07-02', 'cccccccccccc', 'Brutal')),
      );
      const result = await runGenerate({ puzzlesDir: dir, bandsPath, variants: DAN_ONLY });
      expect(result.written).toEqual([
        { date: '2026-07-01', variant: 'dan', label: 'Easy', aimedAt: 'Easy' },
      ]);
      expect(result.failed).toEqual([
        { date: '2026-07-02', variant: 'dan', reason: 'no calibrated band for Brutal' },
      ]);
    },
    30_000,
  );

  it(
    'writes the sibling on the board its variant asks for, not the real one',
    async () => {
      const { dir, bandsPath } = await fixture();
      // An explicit board, small enough to solve in the time an ordinary test
      // may take, and deliberately not the real puzzle's own.
      const variants: VariantSpec[] = [
        { variant: 'dan', board: { width: 3, height: 5 }, seedSalt: '' },
      ];

      const result = await runGenerate({ puzzlesDir: dir, bandsPath, variants });

      expect(result.failed).toEqual([]);
      expect(result.written.map((w) => w.variant)).toEqual(['dan']);

      const dan = validatePuzzle(
        JSON.parse(await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8')),
      );
      expect(dan.variant).toBe('dan');
      expect([dan.width, dan.height]).toEqual([3, 5]);
      expect(dan.people).toHaveLength(15);
      expect([dan.width, dan.height]).not.toEqual([FIXTURE_BOARD.width, FIXTURE_BOARD.height]);

      const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
      expect(index.map((e: { slug: string }) => e.slug)).toEqual([
        '2026-07-01',
        '2026-07-01-dan',
      ]);
    },
    60_000,
  );

  it(
    'draws the board from the date when the variant asks for a random one',
    async () => {
      const { dir, bandsPath } = await fixture();
      const variants: VariantSpec[] = [{ variant: 'dan', board: 'random', seedSalt: '' }];

      const result = await runGenerate({ puzzlesDir: dir, bandsPath, variants });

      expect(result.failed).toEqual([]);
      const dan = validatePuzzle(
        JSON.parse(await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8')),
      );
      // Whatever the draw gave, it is the draw for this date and it is a legal
      // board — the shape itself is pinned by `randomBoard`'s own tests.
      expect([dan.width, dan.height]).toEqual([
        randomBoard(seedForDate('2026-07-01-board')).width,
        randomBoard(seedForDate('2026-07-01-board')).height,
      ]);
      expect(dan.people).toHaveLength(dan.width * dan.height);
    },
    120_000,
  );
});

describe('DEFAULT_VARIANTS', () => {
  it('builds one Dan puzzle per date, on a board drawn for that date', () => {
    expect(DEFAULT_VARIANTS.map((v) => v.variant)).toEqual(['dan']);
    expect(DEFAULT_VARIANTS[0].board).toBe('random');
  });

  it('keeps the Dan seed key bare and every variant distinct', () => {
    expect(DEFAULT_VARIANTS[0].seedSalt).toBe('');
    const salts = DEFAULT_VARIANTS.map((v) => v.seedSalt);
    expect(new Set(salts).size).toBe(salts.length);
  });
});

describe('randomBoard', () => {
  it('stays within 3..7 on both sides, and is never taller than it is wide', () => {
    // Both sides are drawn from the same range and then sorted, so the board is
    // always portrait or square — never wider than it is tall.
    for (let i = 0; i < 500; i++) {
      const { width, height } = randomBoard(i);
      expect(width).toBeGreaterThanOrEqual(3);
      expect(height).toBeLessThanOrEqual(7);
      expect(width).toBeLessThanOrEqual(height);
    }
  });

  it('reaches every size the range allows, corners included', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) {
      const { width, height } = randomBoard(i);
      seen.add(`${width}x${height}`);
    }
    // 3..7 choose 2 with repetition: fifteen distinct boards.
    expect(seen.size).toBe(15);
    expect(seen.has('3x3')).toBe(true);
    expect(seen.has('7x7')).toBe(true);
  });

  it('is a function of the seed alone, so a regenerated date keeps its board', () => {
    expect(randomBoard(seedForDate('2026-07-01'))).toEqual(
      randomBoard(seedForDate('2026-07-01')),
    );
  });
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
    result = await runGenerate({
      puzzlesDir: dir,
      bandsPath,
      variants: DAN_ONLY,
      onProgress: (e) => progress.push(e),
    });
  }, 30_000);

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
  // union is exactly {4,16}, so a count below Narrow's floor is reachable only
  // if the range handed to `generatePuzzle` was the union rather than Narrow's
  // own. Both ranges are read off the calibration board and refitted to the
  // fixture's smaller one before they mean anything here, so the assertions
  // below go through `bandsFor` rather than naming 4, 11 and 16 outright.
  //
  // Which count a given date draws depends on its derived seed and on how many
  // attempts that seed needs, so this asks several dates for one rather than
  // pinning a single date to a single value — a pin that any change to how
  // generation consumes its rng silently invalidates. Every other gated field is
  // wide open, so each date succeeds on its first attempt.
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
      const dates = ['2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'];
      const dir = await mkdtemp(path.join(tmpdir(), 'cbs-generate-union-'));
      const bandsPath = path.join(dir, 'difficulty.json');
      await writeFile(bandsPath, JSON.stringify({ Narrow: narrowBand, Wide: wideBand }));
      for (const date of dates) {
        await writeFile(
          path.join(dir, `${date}.json`),
          JSON.stringify(realPuzzle(date, `dddddddddd${date.slice(-2)}`, 'Narrow')),
        );
      }

      const result = await runGenerate({ puzzlesDir: dir, bandsPath, variants: DAN_ONLY });
      expect(result.written.map((w) => w.date).sort()).toEqual(dates);
      expect(result.written.every((w) => w.aimedAt === 'Narrow')).toBe(true);
      expect(result.failed).toEqual([]);

      const counts: number[] = [];
      for (const date of dates) {
        const raw = JSON.parse(await readFile(path.join(dir, `${date}-dan.json`), 'utf8'));
        const puzzle = validatePuzzle(raw);
        // Which label each earns is decided by `classify` and is not what this
        // test is about — it only has to be a calibrated one.
        expect(['Narrow', 'Wide']).toContain(puzzle.difficulty);
        counts.push(puzzle.people.filter((p) => p.criminal).length);
      }

      // Every count inside the union, and at least one below Narrow's own floor
      // — only reachable if generatePuzzle sampled from the union rather than
      // Narrow's range. On this fixture's board that is a draw from {3,13} with
      // 9 as the floor to undercut; five draws all landing at or above it runs
      // at (5/11)^5, about one in 110.
      const size = FIXTURE_BOARD.width * FIXTURE_BOARD.height;
      const union = unionCriminals({ Narrow: narrowBand, Wide: wideBand });
      const board = bandsFor(
        { union: { ...narrowBand, criminals: union }, Narrow: narrowBand },
        size,
      );
      for (const c of counts) expect(c).toBeGreaterThanOrEqual(board.union.criminals.min);
      for (const c of counts) expect(c).toBeLessThanOrEqual(board.union.criminals.max);
      expect(
        counts.some((c) => c < board.Narrow.criminals.min),
        `counts ${counts.join(',')}`,
      ).toBe(true);
    },
    120_000,
  );
});
