import { describe, expect, it } from 'vitest';
import { PuzzleValidationError, validatePuzzle } from './puzzle';

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
  it('accepts an absent variant and variant "dan"', () => {
    const base = puzzle();
    expect(validatePuzzle(base).variant).toBeUndefined();
    expect(validatePuzzle({ ...base, variant: 'dan' }).variant).toBe('dan');
  });

  it('rejects any other variant', () => {
    expect(() => validatePuzzle({ ...puzzle(), variant: 'real' })).toThrow(
      PuzzleValidationError,
    );
    expect(() => validatePuzzle({ ...puzzle(), variant: 7 })).toThrow(PuzzleValidationError);
  });
});
