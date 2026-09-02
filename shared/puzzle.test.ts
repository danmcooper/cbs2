import { describe, expect, it } from 'vitest';
import { PuzzleValidationError, VARIANTS, puzzleBillingOf, validatePuzzle } from './puzzle';

function person(overrides: object = {}) {
  return {
    name: 'banda',
    profession: 'coder',
    gender: 'male',
    criminal: false,
    clue: null,
    origHint: null,
    paths: [],
    ...overrides,
  };
}

function puzzle(overrides: object = {}) {
  return {
    formatVersion: 1,
    id: 'a6f09e2713b2',
    date: '2026-07-07',
    title: 'A tiny test mystery',
    difficulty: 'Easy',
    width: 2,
    height: 2,
    initialReveals: [0],
    source: 'cluesbysam.com',
    people: [person(), person(), person(), person()],
    ...overrides,
  };
}

describe('validatePuzzle', () => {
  it('accepts a valid puzzle and returns it', () => {
    const p = puzzle();
    expect(validatePuzzle(p)).toBe(p);
  });

  it('accepts nullable clue/origHint/paths and rich values', () => {
    const p = puzzle({
      people: [
        person({ clue: 'The #PROF:chef is guilty', origHint: 'x()', paths: [[0, 1], [3]] }),
        person({ paths: null }),
        person(),
        person(),
      ],
    });
    expect(validatePuzzle(p)).toBe(p);
  });

  it('rejects non-objects', () => {
    expect(() => validatePuzzle(null)).toThrow(PuzzleValidationError);
    expect(() => validatePuzzle('x')).toThrow(PuzzleValidationError);
  });

  it('rejects wrong formatVersion', () => {
    expect(() => validatePuzzle(puzzle({ formatVersion: 2 }))).toThrow(/formatVersion/);
  });

  it('rejects malformed id and date', () => {
    expect(() => validatePuzzle(puzzle({ id: 'nope' }))).toThrow(/id/);
    expect(() => validatePuzzle(puzzle({ date: '07/07/2026' }))).toThrow(/date/);
  });

  it('rejects person count != width*height', () => {
    expect(() => validatePuzzle(puzzle({ people: [person()] }))).toThrow(/people length/);
  });

  it('rejects out-of-range initialReveals and paths indices', () => {
    expect(() => validatePuzzle(puzzle({ initialReveals: [4] }))).toThrow(/initialReveals/);
    const p = puzzle({ people: [person({ paths: [[99]] }), person(), person(), person()] });
    expect(() => validatePuzzle(p)).toThrow(/paths/);
  });

  it('accepts a valid hints array and absent hints', () => {
    const p = puzzle({
      hints: [
        { flipped: [0], clues: [0], reveals: [1] },
        { flipped: [0, 1], clues: [1], reveals: [2, 3] },
      ],
    });
    expect(validatePuzzle(p)).toBe(p);
    expect(validatePuzzle(puzzle())).toBeTruthy();
  });

  it('rejects malformed hints', () => {
    expect(() => validatePuzzle(puzzle({ hints: 'nope' }))).toThrow(/hints/);
    expect(() => validatePuzzle(puzzle({ hints: [{ flipped: [0], clues: [0] }] }))).toThrow(/hints/);
    expect(() => validatePuzzle(puzzle({ hints: [{ flipped: [0], clues: [99], reveals: [1] }] }))).toThrow(/hints/);
  });

  it('rejects bad person fields', () => {
    expect(() => validatePuzzle(puzzle({ people: [person({ name: '' }), person(), person(), person()] }))).toThrow(/name/);
    expect(() => validatePuzzle(puzzle({ people: [person({ criminal: 'yes' }), person(), person(), person()] }))).toThrow(/criminal/);
    expect(() => validatePuzzle(puzzle({ people: [person({ clue: 42 }), person(), person(), person()] }))).toThrow(/clue/);
  });
});

describe('validatePuzzle variant', () => {
  it('accepts an absent variant and every generated one', () => {
    const base = puzzle();
    expect(validatePuzzle(base).variant).toBeUndefined();
    for (const variant of Object.keys(VARIANTS)) {
      expect(validatePuzzle({ ...base, variant }).variant).toBe(variant);
    }
  });

  it('rejects any other variant', () => {
    expect(() => validatePuzzle({ ...puzzle(), variant: 'real' })).toThrow(
      PuzzleValidationError,
    );
    expect(() => validatePuzzle({ ...puzzle(), variant: 'dan-short' })).toThrow(
      PuzzleValidationError,
    );
    expect(() => validatePuzzle({ ...puzzle(), variant: 7 })).toThrow(PuzzleValidationError);
  });
});

describe('puzzleBillingOf', () => {
  const base = { difficulty: 'Tricky', width: 4, height: 5 };

  // A real puzzle's board is always the source site's 4x5, so its size says
  // nothing; the difficulty is the source's own and is the whole billing.
  it('bills a real puzzle by difficulty', () => {
    expect(puzzleBillingOf(base)).toBe('Tricky');
    expect(puzzleBillingOf({ ...base, variant: 'real' })).toBe('Tricky');
  });

  // A generated puzzle's difficulty is our classifier's reading of a puzzle
  // nobody else has played; its board changes with the day of the week and is
  // what a player is actually sizing up.
  it('bills a generated puzzle by its board', () => {
    expect(puzzleBillingOf({ ...base, variant: 'dan', width: 6, height: 6 })).toBe('6x6');
    expect(puzzleBillingOf({ ...base, variant: 'dan', width: 3, height: 4 })).toBe('3x4');
  });
});

describe('VARIANTS', () => {
  it('gives every generated variant a distinct suffix and label', () => {
    const specs = Object.values(VARIANTS);
    expect(specs.length).toBeGreaterThanOrEqual(1);
    expect(new Set(specs.map((s) => s.suffix)).size).toBe(specs.length);
    expect(new Set(specs.map((s) => s.label)).size).toBe(specs.length);
  });

  // Filenames are `${date}${suffix}.json` and the manifest tells the variants
  // apart by matching the suffix, so a suffix that is a prefix of another would
  // let one swallow the other depending on which pattern ran first — as `-dan`
  // and the since-retired `-dan-long` could. Deriving the suffix from the
  // variant name keeps that hazard visible in one place as variants are added.
  it('names each variant so no suffix can be read as another', () => {
    for (const [variant, spec] of Object.entries(VARIANTS)) {
      expect(spec.suffix).toBe(`-${variant}`);
      expect(spec.suffix).toMatch(/^-[a-z][a-z-]*[a-z]$/);
    }
  });
});
