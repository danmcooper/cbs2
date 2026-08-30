import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { type Shape } from './enumerate';
import { type Clues, parseClues, isUniquelySolvable, minimalPaths, solveChain } from './solve';
import { parseHint } from './hint';

const shape: Shape = {
  grid: makeGrid(4, 5),
  professions: Array.from({ length: 20 }, () => 'cook'),
};
// Truth: criminals at 0 and 1 only.
const truth = Array.from({ length: 20 }, (_, i) => i < 2);

function clues(entries: Record<number, string>): Clues {
  const out: Clues = Array.from({ length: 20 }, () => null);
  for (const [i, s] of Object.entries(entries)) out[Number(i)] = parseHint(s);
  return out;
}

describe('isUniquelySolvable', () => {
  it('is true when the clue set pins exactly one assignment', () => {
    const c = clues({
      0: 'number_of_traits(criminal,2)',
      2: 'number_of_traits_in_unit(unit(between,pair(0,1)),criminal,2)',
      3: 'number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)',
    });
    expect(isUniquelySolvable(shape, c, truth)).toBe(true);
  });
  it('is false when clues leave several assignments open', () => {
    expect(isUniquelySolvable(shape, clues({ 0: 'number_of_traits(criminal,2)' }), truth)).toBe(
      false,
    );
  });
});

describe('solveChain', () => {
  it('reveals cards step by step from the initial reveals', () => {
    // Card 0's clue pins both 0 and 1 as criminal (the pair has exactly 2
    // criminals, and it only has 2 members), so flipping 0 forces 1 open.
    // Card 1's clue is a vacuous between() on a non-collinear pair, so the
    // chain stalls there instead of finishing the grid.
    const c = clues({
      0: 'number_of_traits_in_unit(unit(between,pair(0,1)),criminal,2)',
      1: 'number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)',
    });
    const chain = solveChain(shape, c, truth, [0]);
    expect(chain.steps.length).toBeGreaterThan(0);
    expect(chain.steps[0].flipped).toEqual([0]);
    expect(chain.steps[0].reveals).toEqual([1]);
    expect(chain.solvedAll).toBe(false); // nothing pins down cards 2..19
    expect(chain.revealedAt[0]).toBe(0);
  });
  it('reports solvedAll when every card is reached', () => {
    // Same forced pair (0,1) as above, but card 1's clue caps the whole
    // board's criminal count at 2 -- once both known criminals are flipped,
    // every remaining card is forced innocent.
    const c = clues({
      0: 'number_of_traits_in_unit(unit(between,pair(0,1)),criminal,2)',
      1: 'number_of_traits(criminal,2)',
    });
    const chain = solveChain(shape, c, truth, [0]);
    expect(chain.solvedAll).toBe(true);
    expect(chain.revealedAt.every((s) => s !== null)).toBe(true);
  });
});

describe('minimalPaths', () => {
  it('drops flipped cards that were not needed', () => {
    const c = clues({
      0: 'number_of_traits(criminal,2)',
      1: 'number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)',
      2: 'number_of_traits_in_unit(unit(row,3),criminal,0)',
    });
    const paths = minimalPaths(shape, c, truth, 19, [0, 1, 2], 4);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      // unit(between,pair(2,19)) is non-collinear (row 0 vs row 4, col 2 vs
      // col 3), so card 1's clue is vacuously true and contributes nothing;
      // what forces 19 is card 1's own identity combined with card 0's
      // whole-board criminal count.
      expect(path).toContain(1);
      expect(path).not.toContain(2); // card 2's clue is irrelevant to card 19
    }
  });
});
