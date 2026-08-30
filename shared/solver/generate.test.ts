import { describe, expect, it } from 'vitest';
import { validatePuzzle } from '../puzzle';
import type { LabelBand } from './difficulty';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import { render } from './render';
import { isUniquelySolvable, parseClues, solveChain } from './solve';
import { GenerationError, type OffBandCandidate, generatePuzzle, makeRng } from './generate';

// Wide bands: this test proves the machinery works, not that it hits a target.
const band: LabelBand = {
  samples: 10,
  criminals: { min: 4, max: 7 },
  clueCards: { min: 4, max: 16 },
  chainLength: { min: 2, max: 19 },
  meanRevealsPerStep: { min: 1, max: 8 },
  meanPathSize: { min: 1, max: 12 },
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

  it(
    'does not change the outcome when onOffBand is supplied',
    () => {
      const withCallback = generatePuzzle({
        date: '2026-01-01',
        difficulty: 'Medium',
        band,
        seed: 1,
        onOffBand: () => {},
      });
      expect(withCallback.puzzle).toEqual(puzzle);
    },
    // Same cost profile as the reproduction test above: one full generation.
    60_000,
  );
});

describe('onOffBand', () => {
  // Same band/date/seed as the fixture above, but chainLength narrowed to a
  // single unreachable value. Every attempt that clears every other check
  // (chain solved, uniquely solvable, every card path-reachable) will
  // therefore always miss the gate, so onOffBand is guaranteed to fire on
  // attempt 0 without needing to search for a naturally-failing band.
  const impossibleBand: LabelBand = { ...band, chainLength: { min: 1000, max: 1000 } };

  it(
    'fires only for attempts that pass every other check but miss the band, and each candidate meets the no-guessing bar',
    () => {
      const candidates: OffBandCandidate[] = [];
      expect(() =>
        generatePuzzle({
          date: '2026-01-01',
          difficulty: 'Medium',
          band: impossibleBand,
          seed: 1,
          maxAttempts: 1,
          onOffBand: (c) => candidates.push(c),
        }),
      ).toThrow(GenerationError);

      expect(candidates.length).toBeGreaterThan(0);
      for (const { puzzle: p } of candidates) {
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
      }
    },
    60_000,
  );
});
