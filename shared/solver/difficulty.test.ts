import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import type { Clues } from './solve';
import {
  type Metrics,
  InsufficientSamplesError,
  buildBands,
  gatesPass,
  loadBands,
  measure,
} from './difficulty';

const shape = { grid: makeGrid(4, 5), professions: Array.from({ length: 20 }, () => 'cook') };
const truth = Array.from({ length: 20 }, (_, i) => i < 2);
const clues: Clues = Array.from({ length: 20 }, () => null);
clues[0] = parseHint('number_of_traits(criminal,2)');
clues[1] = parseHint('number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)');

const paths: (number[][] | null)[] = Array.from({ length: 20 }, () => [[0, 1]]);
paths[0] = [];

describe('measure', () => {
  it('reports counts, chain shape, and predicate mix', () => {
    // Both criminals must be revealed up front: with only card 0 revealed,
    // clue 1 (on card 1) is not yet active, and clue 0 alone ("exactly 2
    // criminals") cannot force any of the 19 remaining candidate positions
    // for the second criminal, so the chain would have zero steps. With
    // [0, 1] both clues are active from the start and "exactly 2 criminals"
    // forces all 18 remaining cards innocent in a single step.
    const m = measure({ shape, clues, truth, initialReveals: [0, 1], paths });
    expect(m.criminals).toBe(2);
    expect(m.clueCards).toBe(2);
    expect(m.chainLength).toBe(1);
    expect(m.meanRevealsPerStep).toBe(18);
    expect(m.meanPathSize).toBe(2);
    expect(m.maxPathSize).toBe(2);
    expect(m.predicateMix).toEqual({
      number_of_traits: 1,
      number_of_traits_in_unit: 1,
    });
  });
});

const metrics = (over: Partial<Metrics>): Metrics => ({
  criminals: 5,
  clueCards: 8,
  chainLength: 6,
  meanRevealsPerStep: 2,
  maxRevealsPerStep: 4,
  meanPathSize: 3,
  maxPathSize: 5,
  predicateMix: {},
  ...over,
});

describe('buildBands', () => {
  it('takes min and max per label', () => {
    const bands = buildBands([
      { label: 'Easy', metrics: metrics({ chainLength: 4 }) },
      { label: 'Easy', metrics: metrics({ chainLength: 6 }) },
      { label: 'Easy', metrics: metrics({ chainLength: 9 }) },
    ]);
    expect(bands.Easy.samples).toBe(3);
    expect(bands.Easy.chainLength).toEqual({ min: 4, max: 9 });
    expect(bands.Easy.criminals).toEqual({ min: 5, max: 5 });
  });
  it('refuses to invent a band from too few samples', () => {
    expect(() => buildBands([{ label: 'Brutal', metrics: metrics({}) }])).toThrow(
      InsufficientSamplesError,
    );
  });
});

describe('gatesPass', () => {
  const band = buildBands([
    { label: 'Easy', metrics: metrics({ chainLength: 4, meanPathSize: 2 }) },
    { label: 'Easy', metrics: metrics({ chainLength: 6, meanPathSize: 3 }) },
    { label: 'Easy', metrics: metrics({ chainLength: 9, meanPathSize: 4 }) },
  ]).Easy;

  it('accepts in-band solve shape', () => {
    expect(gatesPass(band, metrics({ chainLength: 5, meanPathSize: 3 }))).toBe(true);
  });
  it('rejects out-of-band solve shape', () => {
    expect(gatesPass(band, metrics({ chainLength: 12 }))).toBe(false);
    expect(gatesPass(band, metrics({ meanPathSize: 9 }))).toBe(false);
  });
  it('ignores criminal count, which is sampled rather than gated', () => {
    expect(gatesPass(band, metrics({ criminals: 99 }))).toBe(true);
    expect(gatesPass(band, metrics({ clueCards: 99 }))).toBe(false);
  });
});

describe('loadBands', () => {
  const band = buildBands([
    { label: 'Easy', metrics: metrics({}) },
    { label: 'Easy', metrics: metrics({}) },
    { label: 'Easy', metrics: metrics({}) },
  ]).Easy;

  it('accepts a well-formed bands object', () => {
    expect(loadBands({ Easy: band })).toEqual({ Easy: band });
  });
  it('rejects a band missing a metric or with a reversed range', () => {
    const { meanPathSize, ...missing } = band;
    expect(() => loadBands({ Easy: missing })).toThrow(/meanPathSize/);
    expect(() => loadBands({ Easy: { ...band, chainLength: { min: 9, max: 2 } } })).toThrow(
      /chainLength/,
    );
  });
});
