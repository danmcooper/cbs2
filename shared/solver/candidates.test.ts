import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { formatHint, parseHint } from './hint';
import { type Board, makeBoard, evaluate } from './predicates';
import { canRender } from './render';
import { candidateHints, candidateUnits, referencedCards } from './candidates';

const board = makeBoard(
  makeGrid(4, 5),
  Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? 'cook' : i % 3 === 1 ? 'cop' : 'pilot')),
  Array.from({ length: 20 }, (_, i) => [0, 1, 6, 13, 19].includes(i)),
);

describe('candidateUnits', () => {
  it('includes every kind, and between segments only along a row or column', () => {
    const units = candidateUnits(board);
    const kinds = new Set(units.map((u) => u.kind));
    expect(kinds).toEqual(new Set(['row', 'col', 'neighbor', 'between', 'profession', 'edge', 'corner']));
    const betweens = units.filter((u) => u.kind === 'between');
    // 5 rows * C(4,2) [width=4] + 4 cols * C(5,2) [height=5] = 5*6 + 4*10 = 30 + 40 = 70
    expect(betweens.length).toBe(70);
    for (const u of betweens) {
      expect((u as { a: number; b: number }).a).toBeLessThan((u as { a: number; b: number }).b);
    }
  });
});

describe('candidateHints', () => {
  const hints = candidateHints(board);

  it('produces a large pool covering many predicates', () => {
    expect(hints.length).toBeGreaterThan(500);
    expect(new Set(hints.map((h) => h.pred)).size).toBeGreaterThanOrEqual(20);
  });
  it('every candidate is true of the board and renders', () => {
    for (const h of hints) {
      expect(evaluate(board, h), formatHint(h)).toBe(true);
      expect(canRender(h), formatHint(h)).toBe(true);
    }
  });
  it('contains no duplicates', () => {
    const strings = hints.map(formatHint);
    expect(new Set(strings).size).toBe(strings.length);
  });
  it('never uses has_most_traits or only_unit_has_exactly_n_traits with a unit kind that has ' +
    'fewer than two units (between, edge, corner) — those are vacuously true regardless of the board', () => {
    const vacuousKinds = new Set(['between', 'edge', 'corner']);
    for (const h of hints) {
      if (h.pred !== 'has_most_traits' && h.pred !== 'only_unit_has_exactly_n_traits') continue;
      const arg0 = h.args[0];
      expect(arg0.t).toBe('unit');
      if (arg0.t === 'unit') {
        expect(vacuousKinds.has(arg0.unit.kind), formatHint(h)).toBe(false);
      }
    }
  });
});

describe('candidateHints exhaustive tautology regression', () => {
  it('every candidate hint is false for at least one of the 512 possible assignments on a 3x3 board', () => {
    // 3x3 (9 cells) keeps 2^9 = 512 assignments small enough to enumerate exhaustively —
    // exact rather than sampled — while still exercising every unit kind (row, col,
    // neighbor, between, edge, corner, profession) and every direction, including the
    // boundary geometry (topmost row + "above", corner-cell neighbor cliques, etc.) that
    // only shows up on a real grid shape. A hint that is true of literally every possible
    // assignment constrains nothing, no matter how confident the rendered English sounds,
    // so this test only passes if every emitted hint is false somewhere in that space.
    const grid = makeGrid(3, 3);
    const professions = Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? 'cook' : 'cop'));
    const fixedAssignment = Array.from({ length: 9 }, (_, i) => [0, 4, 8].includes(i));
    const smallBoard = makeBoard(grid, professions, fixedAssignment);
    const hints = candidateHints(smallBoard);

    const allBoards: Board[] = [];
    for (let mask = 0; mask < 512; mask++) {
      const criminal = Array.from({ length: 9 }, (_, i) => ((mask >> i) & 1) === 1);
      allBoards.push(makeBoard(grid, professions, criminal));
    }

    for (const h of hints) {
      const isFalsifiable = allBoards.some((other) => !evaluate(other, h));
      expect(isFalsifiable, formatHint(h)).toBe(true);
    }
  });
});

describe('referencedCards', () => {
  it('collects unit members and bare indices', () => {
    expect([...referencedCards(board, parseHint('number_of_traits_in_unit(unit(row,2),criminal,1)'))].sort(
      (a, b) => a - b,
    )).toEqual([4, 5, 6, 7]);
    expect(referencedCards(board, parseHint('has_trait(11,innocent)'))).toEqual(new Set([11]));
    expect(referencedCards(board, parseHint('is_one_of_n_traits_in_unit(unit(neighbor,5),1,criminal,2)'))).toContain(
      1,
    );
  });
});
