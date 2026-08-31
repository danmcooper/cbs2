import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePuzzle } from '../puzzle';
import { type LabelBand, classify, loadBands } from './difficulty';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import { render } from './render';
import { isUniquelySolvable, parseClues, solveChain } from './solve';
import { GenerationError, generatePuzzle, makeRng } from './generate';

// Wide bands: this test proves the machinery works, not that it hits a target.
const band: LabelBand = {
  samples: 10,
  criminals: { min: 4, max: 7 },
  clueCards: { min: 4, max: 16 },
  chainLength: { min: 2, max: 19 },
  meanRevealsPerStep: { min: 1, max: 8 },
  meanPathSize: { min: 1, max: 12 },
  abstractShare: { min: 0, max: 1 },
};

describe('makeRng', () => {
  it('is deterministic and in range', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    for (let i = 0; i < 5; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('generatePuzzle', () => {
  const result = generatePuzzle({ date: '2026-01-01', difficulty: 'Medium', band, seed: 1 });
  const puzzle = result.puzzle;

  it('produces a valid, uniquely solvable, fully chained puzzle', () => {
    expect(() => validatePuzzle(puzzle)).not.toThrow();
    expect(puzzle.variant).toBe('dan');
    expect(puzzle.date).toBe('2026-01-01');
    expect(puzzle.difficulty).toBe('Medium');
    const shape = {
      grid: makeGrid(puzzle.width, puzzle.height),
      professions: puzzle.people.map((p) => p.profession),
    };
    const clues = parseClues(puzzle.people.map((p) => p.origHint));
    const truth = puzzle.people.map((p) => p.criminal);
    expect(isUniquelySolvable(shape, clues, truth)).toBe(true);
    expect(solveChain(shape, clues, truth, puzzle.initialReveals).solvedAll).toBe(true);
  });

  it('round-trips every generated clue exactly', () => {
    for (const person of puzzle.people) {
      if (!person.origHint) continue;
      expect(render(parseHint(person.origHint))).toBe(person.clue);
    }
  });

  it('never puts a clue on a card the clue talks about', () => {
    // Enforced by construction; assert on the rendered markup, which names cards.
    puzzle.people.forEach((person, i) => {
      if (!person.clue) return;
      expect(person.clue).not.toContain(`#NAME:${i}`);
      expect(person.clue).not.toContain(`#NAMES:${i}`);
    });
  });

  it('gives every non-initial card at least one sufficient path', () => {
    puzzle.people.forEach((person, i) => {
      if (puzzle.initialReveals.includes(i)) return;
      expect(person.paths, `people[${i}]`).not.toBeNull();
      expect((person.paths as number[][]).length).toBeGreaterThan(0);
    });
  });

  it(
    'reproduces exactly from its seed',
    () => {
      const again = generatePuzzle({ date: '2026-01-01', difficulty: 'Medium', band, seed: 1 });
      expect(again.puzzle).toEqual(puzzle);
    },
    // A second full generation call from scratch measured ~23s locally; this leaves
    // comfortable margin without masking a genuine performance regression.
    60_000,
  );

  it('uses only original titles and flavour text', () => {
    expect(puzzle.source).toBe('generated');
    for (const person of puzzle.people) {
      if (person.origHint === null) expect(person.clue).not.toBeNull();
    }
  });

});

describe('labelOf', () => {
  // Same band/date/seed as the fixture above, but chainLength narrowed to a
  // single unreachable value, so every attempt that clears every other check
  // (chain solved, uniquely solvable, every card path-reachable) still misses
  // the gate. That makes the band impossible to satisfy by construction —
  // which is exactly what distinguishes the two code paths under test.
  const impossibleBand: LabelBand = { ...band, chainLength: { min: 1000, max: 1000 } };

  it(
    'without labelOf, an unsatisfiable band exhausts every attempt and throws',
    () => {
      expect(() =>
        generatePuzzle({
          date: '2026-01-01',
          difficulty: 'Medium',
          band: impossibleBand,
          seed: 1,
          maxAttempts: 1,
        }),
      ).toThrow(GenerationError);
    },
    60_000,
  );

  it(
    'with labelOf, the same unsatisfiable band still yields a sound puzzle carrying the label it earned',
    () => {
      const seen: number[] = [];
      const { puzzle: p } = generatePuzzle({
        date: '2026-01-01',
        difficulty: 'Medium',
        band: impossibleBand,
        seed: 1,
        maxAttempts: 1,
        labelOf: (m) => {
          seen.push(m.chainLength);
          return 'Whatever';
        },
      });

      // The label on the puzzle is the one labelOf returned, not `difficulty`,
      // and it was decided from metrics that genuinely miss the band.
      expect(p.difficulty).toBe('Whatever');
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toBe(1000);

      // Relaxing the band gate must not relax anything else: the puzzle is
      // still schema-valid, uniquely solvable, fully chained, and free of
      // guesses. This is the whole risk of accepting off-band puzzles.
      expect(() => validatePuzzle(p)).not.toThrow();
      const shape = { grid: makeGrid(p.width, p.height), professions: p.people.map((x) => x.profession) };
      const clues = parseClues(p.people.map((x) => x.origHint));
      const truth = p.people.map((x) => x.criminal);
      expect(isUniquelySolvable(shape, clues, truth)).toBe(true);
      expect(solveChain(shape, clues, truth, p.initialReveals).solvedAll).toBe(true);
      p.people.forEach((person, i) => {
        if (p.initialReveals.includes(i)) return;
        expect(person.paths, `people[${i}]`).not.toBeNull();
        expect((person.paths as number[][]).length).toBeGreaterThan(0);
      });
    },
    60_000,
  );
});

describe('generatePuzzle against the real calibrated bands', () => {
  // Loads the real calibrated config/difficulty.json rather than a synthetic
  // fixture, and exercises the way generation is actually driven: aim at a
  // real label's band, accept the first valid puzzle, and label it by what it
  // measured. Easy sits near the bottom and Brutal near the top of the
  // calibrated abstractShare range, so together they exercise the abstraction
  // bias in both directions.
  const bands = loadBands(
    JSON.parse(readFileSync(path.join(process.cwd(), 'config', 'difficulty.json'), 'utf8')),
  );

  it(
    'aims at Easy and at Brutal, returns a sound puzzle for each, and labels it by its own metrics',
    () => {
      const easy = generatePuzzle({
        date: '2026-01-01',
        difficulty: 'Easy',
        band: bands.Easy,
        seed: 1,
        labelOf: (m) => classify(bands, m),
      });
      const brutal = generatePuzzle({
        date: '2026-01-01',
        difficulty: 'Brutal',
        band: bands.Brutal,
        seed: 1,
        labelOf: (m) => classify(bands, m),
      });

      // The stored label must be reproducible from the puzzle's own metrics —
      // this is the invariant scripts/audit-dan.mts enforces across the whole
      // archive, asserted here at the point the label is assigned.
      for (const r of [easy, brutal]) {
        expect(Object.keys(bands)).toContain(r.puzzle.difficulty);
        expect(r.puzzle.difficulty).toBe(classify(bands, r.metrics));
      }

      // The bias still separates the two aims even though neither is now
      // required to land in band: Easy's calibrated share tops out around 0.23
      // and Brutal's starts around 0.45, so aiming at each should pull the
      // abstraction share in opposite directions rather than land on one
      // pool-average value for both.
      expect(brutal.metrics.abstractShare).toBeGreaterThan(easy.metrics.abstractShare);
    },
    // Two full generations against real bands. Far cheaper than the old
    // gate-satisfying version (which could burn 25 attempts per label), but
    // still minutes rather than seconds.
    600_000,
  );
});
