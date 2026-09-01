import { describe, expect, it } from 'vitest';
import {
  cornerMembers, colMembers, edgeMembers, isConnected, makeGrid,
  neighbors, offsetIndex, rowMembers, segment,
} from './grid';

const g = makeGrid(4, 5);

describe('neighbors', () => {
  it('gives 8 neighbours for an interior card', () => {
    expect(neighbors(g, 5)).toEqual([0, 1, 2, 4, 6, 8, 9, 10]);
  });
  it('gives 3 neighbours for a corner and never wraps rows', () => {
    expect(neighbors(g, 0)).toEqual([1, 4, 5]);
    expect(neighbors(g, 3)).toEqual([2, 6, 7]);
    expect(neighbors(g, 4)).toEqual([0, 1, 5, 8, 9]);
  });
});

describe('segment', () => {
  it('walks a row run inclusively', () => {
    expect(segment(g, 4, 7)).toEqual([4, 5, 6, 7]);
    expect(segment(g, 7, 4)).toEqual([4, 5, 6, 7]);
  });
  it('walks a column run by width, not by index range', () => {
    expect(segment(g, 1, 13)).toEqual([1, 5, 9, 13]);
  });
  it('is empty for endpoints sharing neither row nor column', () => {
    expect(segment(g, 0, 5)).toEqual([]);
  });
});

describe('units', () => {
  it('indexes rows and columns 1-based', () => {
    expect(rowMembers(g, 1)).toEqual([0, 1, 2, 3]);
    expect(colMembers(g, 1)).toEqual([0, 4, 8, 12, 16]);
    expect(colMembers(g, 4)).toEqual([3, 7, 11, 15, 19]);
  });
  it('lists the perimeter and the four corners', () => {
    expect(edgeMembers(g)).toEqual([0, 1, 2, 3, 4, 7, 8, 11, 12, 15, 16, 17, 18, 19]);
    expect(cornerMembers(g)).toEqual([0, 3, 16, 19]);
  });
});

describe('offsetIndex', () => {
  it('applies dx/dy with y growing downward', () => {
    expect(offsetIndex(g, 5, 1, 0)).toBe(6);
    expect(offsetIndex(g, 5, 0, -1)).toBe(1);
    expect(offsetIndex(g, 5, 0, 1)).toBe(9);
  });
  it('returns null off-grid instead of wrapping', () => {
    expect(offsetIndex(g, 3, 1, 0)).toBeNull();
    expect(offsetIndex(g, 0, 0, -1)).toBeNull();
  });
});

describe('isConnected', () => {
  it('accepts a diagonal chain and the empty/singleton sets', () => {
    expect(isConnected(g, [0, 5, 10])).toBe(true);
    expect(isConnected(g, [])).toBe(true);
    expect(isConnected(g, [7])).toBe(true);
  });
  it('rejects two separated clumps', () => {
    expect(isConnected(g, [0, 1, 19])).toBe(false);
  });
});
