import { describe, expect, it } from 'vitest';
import { loadArchive } from './corpus';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import type { Clues } from './solve';
import {
  type Metrics,
  ABSTRACT_PREDICATES,
  InsufficientSamplesError,
  buildBands,
  classify,
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

describe('measure abstractShare', () => {
  it('is the share of clues drawn from the abstract predicate family', () => {
    // 2 clues from the abstract family, 6 from outside it: 2/8 = 0.25.
    const mixClues: Clues = Array.from({ length: 20 }, () => null);
    mixClues[0] = parseHint('is_not_only_trait_in_unit(unit(row,0),3,criminal)');
    mixClues[1] = parseHint('only_unit_has_exactly_n_traits(unit(col,1),criminal,2)');
    mixClues[2] = parseHint('has_trait(4,criminal)');
    mixClues[3] = parseHint('number_of_traits(criminal,2)');
    mixClues[4] = parseHint('number_of_traits_in_unit(unit(row,2),criminal,1)');
    mixClues[5] = parseHint('odd_number_of_traits_in_unit(unit(col,2),criminal)');
    mixClues[6] = parseHint('has_most_traits(unit(row,3),criminal)');
    mixClues[7] = parseHint('min_number_of_traits_in_unit(unit(col,3),criminal,1)');
    const mixPaths: (number[][] | null)[] = Array.from({ length: 20 }, () => [[0, 1]]);

    // initialReveals is deliberately empty: forcedGiven only checks hints on
    // flipped cards for consistency with truth, and this test's synthetic
    // clues are not meant to be true statements about `truth` — they only
    // need to exercise measure's clue-counting, which reads input.clues
    // directly rather than the chain solveChain derives from them.
    const m = measure({ shape, clues: mixClues, truth, initialReveals: [], paths: mixPaths });
    expect(m.clueCards).toBe(8);
    expect(m.abstractShare).toBe(0.25);
  });

  it('is 0, not NaN, when there are no clues at all', () => {
    const noClues: Clues = Array.from({ length: 20 }, () => null);
    const noCluesPaths: (number[][] | null)[] = Array.from({ length: 20 }, () => [[0, 1]]);
    const m = measure({ shape, clues: noClues, truth, initialReveals: [], paths: noCluesPaths });
    expect(m.clueCards).toBe(0);
    expect(m.abstractShare).toBe(0);
  });
});

describe('abstractShare separates the archive by human difficulty label', () => {
  it('is strictly increasing Easy < Medium < Tricky < Hard < Brutal across all 54 real puzzles', () => {
    const archive = loadArchive();
    const byLabel = new Map<string, number[]>();
    let total = 0;
    for (const { puzzle } of archive) {
      total++;
      let clueCards = 0;
      let abstractCount = 0;
      for (const person of puzzle.people) {
        if (person.origHint === null) continue;
        clueCards++;
        const pred = person.origHint.split('(')[0];
        if (ABSTRACT_PREDICATES.has(pred)) abstractCount++;
      }
      const share = clueCards === 0 ? 0 : abstractCount / clueCards;
      const list = byLabel.get(puzzle.difficulty) ?? [];
      list.push(share);
      byLabel.set(puzzle.difficulty, list);
    }

    // Guards against a vacuous pass: if the archive layout changes underfoot
    // (a label goes missing, or files get added/removed) this must fail
    // rather than silently compare fewer than five means.
    expect(total).toBe(54);
    const order = ['Easy', 'Medium', 'Tricky', 'Hard', 'Brutal'];
    for (const label of order) {
      expect(byLabel.has(label), `missing label ${label}`).toBe(true);
    }
    expect([...byLabel.values()].reduce((a, l) => a + l.length, 0)).toBe(54);

    const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const means = order.map((label) => meanOf(byLabel.get(label) as number[]));

    for (let i = 1; i < means.length; i++) {
      expect(means[i], `${order[i - 1]}=${means[i - 1]} vs ${order[i]}=${means[i]}`).toBeGreaterThan(
        means[i - 1],
      );
    }
    expect(means[0]).toBeLessThan(0.25);
    expect(means[means.length - 1]).toBeGreaterThan(0.5);
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
  abstractShare: 0.3,
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
    { label: 'Easy', metrics: metrics({ chainLength: 4, abstractShare: 0.2 }) },
    { label: 'Easy', metrics: metrics({ chainLength: 6, abstractShare: 0.3 }) },
    { label: 'Easy', metrics: metrics({ chainLength: 9, abstractShare: 0.4 }) },
  ]).Easy;

  it('accepts in-band solve shape', () => {
    expect(gatesPass(band, metrics({ chainLength: 5, abstractShare: 0.3 }))).toBe(true);
  });
  it('rejects out-of-band solve shape', () => {
    expect(gatesPass(band, metrics({ chainLength: 12 }))).toBe(false);
    expect(gatesPass(band, metrics({ abstractShare: 0.9 }))).toBe(false);
  });
  it('ignores criminal count, which is sampled rather than gated', () => {
    expect(gatesPass(band, metrics({ criminals: 99 }))).toBe(true);
    expect(gatesPass(band, metrics({ clueCards: 99 }))).toBe(false);
  });
  it('ignores meanPathSize, which is recorded but not yet gated because the generator cannot currently reach the calibrated range', () => {
    expect(gatesPass(band, metrics({ meanPathSize: 999 }))).toBe(true);
  });
});

describe('classify', () => {
  // Two labels separated on chainLength only: Low covers 2-6, High covers
  // 10-14. Every other gated metric is identical across both, so the choice
  // turns entirely on where chainLength falls.
  const bands = buildBands([
    { label: 'Low', metrics: metrics({ chainLength: 2 }) },
    { label: 'Low', metrics: metrics({ chainLength: 4 }) },
    { label: 'Low', metrics: metrics({ chainLength: 6 }) },
    { label: 'High', metrics: metrics({ chainLength: 10 }) },
    { label: 'High', metrics: metrics({ chainLength: 12 }) },
    { label: 'High', metrics: metrics({ chainLength: 14 }) },
  ]);

  it('picks the label whose band contains the metrics', () => {
    expect(classify(bands, metrics({ chainLength: 3 }))).toBe('Low');
    expect(classify(bands, metrics({ chainLength: 13 }))).toBe('High');
  });

  it('picks the nearest label when no band contains the metrics', () => {
    // 7 and 9 both sit in the gap between the bands; each goes to the side
    // it is closer to, so a puzzle is never refused a label for landing
    // between two of them.
    expect(classify(bands, metrics({ chainLength: 7 }))).toBe('Low');
    expect(classify(bands, metrics({ chainLength: 9 }))).toBe('High');
    // Far outside every band on the low side still resolves, to Low.
    expect(classify(bands, metrics({ chainLength: -50 }))).toBe('Low');
  });

  it('breaks containment ties toward the band the metrics sit most centrally in', () => {
    // Wide contains Low's whole range, so a chainLength of 3 is inside both.
    // Without the midpoint key the winner would come down to label spelling;
    // with it, 3 goes to Narrow, whose midpoint is 3 rather than 10.
    const overlapping = buildBands([
      { label: 'Narrow', metrics: metrics({ chainLength: 2 }) },
      { label: 'Narrow', metrics: metrics({ chainLength: 3 }) },
      { label: 'Narrow', metrics: metrics({ chainLength: 4 }) },
      { label: 'Wide', metrics: metrics({ chainLength: 1 }) },
      { label: 'Wide', metrics: metrics({ chainLength: 10 }) },
      { label: 'Wide', metrics: metrics({ chainLength: 19 }) },
    ]);
    expect(classify(overlapping, metrics({ chainLength: 3 }))).toBe('Narrow');
    expect(classify(overlapping, metrics({ chainLength: 17 }))).toBe('Wide');
  });

  it('always returns a calibrated label, and the same one for the same metrics', () => {
    for (const chainLength of [-5, 0, 3, 7, 8, 11, 20, 500]) {
      const m = metrics({ chainLength });
      const label = classify(bands, m);
      expect(Object.keys(bands)).toContain(label);
      expect(classify(bands, m)).toBe(label);
    }
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
