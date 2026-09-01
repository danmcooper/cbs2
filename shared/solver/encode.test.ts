import { describe, expect, it } from 'vitest';
import { MAX_ENUMERATED_UNIT, SUPPORTED, UnsupportedPredicateError, encode } from './encode';
import { makeGrid } from './grid';
import { ARG_KINDS } from './hint';
import { EVALUATORS } from './predicates';

const shape = { grid: makeGrid(4, 4), professions: Array<string>(16).fill('cook') };
const nothingKnown = Array<null>(16).fill(null);

describe('predicate coverage', () => {
  it('encodes every predicate the game can express', () => {
    // The generator draws from `ARG_KINDS` and the archive parses into it, so a
    // predicate that exists there but not here is one that would reach the
    // solver and throw. Adding a predicate has to mean adding its encoding.
    const missing = Object.keys(ARG_KINDS).filter((p) => !SUPPORTED.has(p));
    expect(missing, `no encoding for: ${missing}`).toEqual([]);
  });

  it('claims nothing the evaluator cannot check', () => {
    const extra = [...SUPPORTED].filter((p) => !(p in EVALUATORS));
    expect(extra, `encoded but not evaluable: ${extra}`).toEqual([]);
  });
});

describe('encode', () => {
  it('refuses a predicate it has no encoding for', () => {
    expect(() => encode(shape, [{ pred: 'no_such_predicate', args: [] }], nothingKnown)).toThrow(
      UnsupportedPredicateError,
    );
  });

  it('refuses a connectivity clue over a unit too large to enumerate', () => {
    // The subset walk is exponential in the unit, so an oversized one has to be
    // refused rather than silently attempted: a 5x6 board's edge is 18 cards.
    const wide = { grid: makeGrid(6, 5), professions: Array<string>(30).fill('cook') };
    expect(wide.grid.width * 2 + (wide.grid.height - 2) * 2).toBeGreaterThan(MAX_ENUMERATED_UNIT);
    expect(() =>
      encode(
        wide,
        [{ pred: 'all_traits_are_neighbors_in_unit', args: [{ t: 'unit', unit: { kind: 'edge' } }, { t: 'trait', trait: 'criminal' }] }],
        Array<null>(30).fill(null),
      ),
    ).toThrow(UnsupportedPredicateError);
  });

  it('gives every card a variable, whatever the clues say', () => {
    const { vars } = encode(shape, [], nothingKnown);
    expect(new Set(vars).size).toBe(16);
  });
});
