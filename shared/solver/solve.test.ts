import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { type Shape } from './enumerate';
import {
  type Clues,
  forcedGiven,
  parseClues,
  hintSteps,
  isUniquelySolvable,
  minimalPaths,
  solveChain,
} from './solve';
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

// Every card on a 4x5 board gets its minimal paths worked out below, and each
// one enumerates all 2^20 assignments repeatedly. That is seconds rather than
// milliseconds, and under the whole suite's parallelism it overran the 5s
// default — so this block gets a real budget instead.
describe('hintSteps', { timeout: 60_000 }, () => {
  // The clue on card 0 caps the board at two criminals; card 1's clue puts none
  // of them between cards 2 and 19. Once 0 and 1 are flipped, both criminals are
  // accounted for and every other card is forced innocent.
  const c = clues({
    0: 'number_of_traits(criminal,2)',
    1: 'number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)',
    2: 'number_of_traits_in_unit(unit(row,3),criminal,0)',
  });
  const paths = truth.map((_, i) => (i === 0 ? [] : minimalPaths(shape, c, truth, i, [0, 1, 2], 4)));

  it('carries no clue the player could have done without', () => {
    // What separates a step from a `solveChain` round is not how many cards it
    // turns over — one clue legitimately cracks open several — but how much it
    // asks the player to read. A round outlines every visible clue at once,
    // which is the right shape for proving a puzzle solvable and the wrong
    // shape for a hint button. So no outlined clue may be dead weight: taking
    // any one away has to cost the step at least one of the cards it claims.
    const steps = hintSteps(shape, c, truth, paths);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      for (const drop of s.clues) {
        const kept = c.map((h, j) => (s.clues.includes(j) && j !== drop ? h : null));
        const forced = forcedGiven(shape, kept, truth, s.flipped);
        const still = forced.flatMap((v, i) => (v !== null && !s.flipped.includes(i) ? [i] : []));
        expect(still.length).toBeLessThan(s.reveals.length);
      }
    }
  });

  it('outlines only the clues the deduction needs', () => {
    // What forces card 19 is card 0's whole-board count of two criminals plus
    // the sight of both of them already flipped. So the step needs card 1
    // *flipped* — it is the second criminal — but its clue is a vacuous
    // between() on a non-collinear pair (see the minimalPaths test below) and
    // contributes nothing, and card 2's clue is irrelevant. Outlining either is
    // the noise that makes a hint read as "re-read the board".
    const steps = hintSteps(shape, c, truth, paths).filter((s) => s.reveals.includes(19));
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      expect(s.clues).toEqual([0]);
      expect(s.flipped).toContain(1);
      // Every outlined clue has to be a prerequisite the player already holds,
      // and every prerequisite has to be something other than the answer.
      for (const i of s.clues) expect(s.flipped).toContain(i);
      expect(s.flipped).not.toContain(19);
    }
  });

  it('names every card its outlined clues force, not just the one it was built for', () => {
    // A step hands the player a position and a sentence to read. If that much of
    // the board forces three cards, dotting one of them hides two deductions the
    // player has already earned — and the hidden one is often the one that has to
    // come first. Reported on 2026-07-07: Piet's "as many criminal doctors as
    // criminal clerks" forces Ferran and Rafael together, by way of Rafael, and
    // the hint dotted Ferran alone.
    const steps = hintSteps(shape, c, truth, paths);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      const outlined = c.map((h, j) => (s.clues.includes(j) ? h : null));
      const forced = forcedGiven(shape, outlined, truth, s.flipped);
      const everything = forced.flatMap((v, i) => (v !== null && !s.flipped.includes(i) ? [i] : []));
      expect([...s.reveals].sort((a, b) => a - b)).toEqual(everything);
    }
  });

  it('names a clue-bearing card in every outlined position', () => {
    // `clues` indexes cards whose clue is worth reading; a prerequisite that
    // carries no clue is a known value, not something to outline.
    for (const s of hintSteps(shape, c, truth, paths)) {
      for (const i of s.clues) expect(c[i]).not.toBeNull();
    }
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
