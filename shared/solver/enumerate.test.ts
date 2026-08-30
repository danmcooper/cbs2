import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import {
  type Shape,
  ContradictionError,
  allMasks,
  criminalOf,
  filterMasks,
  forcedFromMasks,
  maskOf,
  survivors,
} from './enumerate';

const shape: Shape = {
  grid: makeGrid(4, 5),
  professions: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 'cook' : 'cop')),
};
const unknown = () => Array.from({ length: 20 }, () => null) as (boolean | null)[];

describe('mask conversion', () => {
  it('round-trips', () => {
    const criminal = Array.from({ length: 20 }, (_, i) => i === 0 || i === 19);
    expect(maskOf(criminal)).toBe((1 << 0) | (1 << 19));
    expect(criminalOf(maskOf(criminal), 20)).toEqual(criminal);
  });
});

describe('allMasks', () => {
  it('enumerates the whole space when nothing is known', () => {
    expect(allMasks(shape, unknown()).length).toBe(2 ** 20);
  });
  it('fixes known cards', () => {
    const known = unknown();
    known[0] = true;
    known[1] = false;
    const masks = allMasks(shape, known);
    expect(masks.length).toBe(2 ** 18);
    for (const m of masks) {
      expect(m & 1).toBe(1);
      expect(m & 2).toBe(0);
    }
  });
});

describe('filterMasks', () => {
  it('keeps only assignments satisfying every hint', () => {
    const hints = [parseHint('number_of_traits(criminal,20)')];
    const out = filterMasks(shape, allMasks(shape, unknown()), hints);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(2 ** 20 - 1);
  });
  it('runs a full-space pass in reasonable time', () => {
    const started = Date.now();
    const out = survivors(shape, unknown(), [parseHint('number_of_traits(criminal,5)')]);
    expect(out.length).toBe(15504); // C(20,5)
    expect(Date.now() - started).toBeLessThan(20000);
  });
});

describe('forcedFromMasks', () => {
  it('marks cards that agree across every survivor', () => {
    const known = unknown();
    const out = survivors(shape, known, [
      parseHint('number_of_traits_in_unit(unit(row,1),criminal,4)'),
      parseHint('number_of_traits_in_unit(unit(row,5),criminal,0)'),
    ]);
    const forced = forcedFromMasks(out, 20);
    expect(forced.slice(0, 4)).toEqual([true, true, true, true]);
    expect(forced.slice(16, 20)).toEqual([false, false, false, false]);
    expect(forced[8]).toBeNull();
  });
  it('throws on an unsatisfiable clue set', () => {
    const out = survivors(shape, unknown(), [
      parseHint('number_of_traits(criminal,3)'),
      parseHint('number_of_traits(criminal,4)'),
    ]);
    expect(() => forcedFromMasks(out, 20)).toThrow(ContradictionError);
  });
});
