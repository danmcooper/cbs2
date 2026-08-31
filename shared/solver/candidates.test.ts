import { describe, expect, it } from 'vitest';
import { loadArchive } from './corpus';
import { makeGrid } from './grid';
import { type Hint, formatHint, parseHint } from './hint';
import { type Board, makeBoard, evaluate } from './predicates';
import { canRender } from './render';
import { candidateHints, candidateUnits, namedCards, referencedCards } from './candidates';

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
  it(
    'every hint from every possible 3x3 assignment is false for at least one of the 512 possible assignments',
    () => {
      // 3x3 (9 cells) keeps 2^9 = 512 assignments small enough to enumerate exhaustively —
      // exact rather than sampled — while still exercising every unit kind (row, col,
      // neighbor, between, edge, corner, profession) and every direction, including the
      // boundary geometry (topmost row + "above", corner-cell neighbor cliques, etc.) that
      // only shows up on a real grid shape.
      //
      // Building the *pool* from a single fixed assignment (an earlier version of this
      // test did exactly that) only audits whichever candidates that one assignment
      // happens to generate — a filter that is wrong only for some *other* assignment's
      // pool would sail through untested. That is precisely how the
      // max_number_of_traits_in_neighbors_in_unit tautology (a corner cell can never have
      // more than 3 neighbors, so "no one in the corners has more than 3 innocent
      // neighbors" is true of every board) escaped detection. So instead: build
      // candidateHints for EVERY one of the 512 assignments, pool the results
      // (deduplicated by formatHint so equivalent hints from different pools are only
      // checked once), and require every distinct hint to be false for at least one of
      // the 512 assignments.
      const grid = makeGrid(3, 3);
      const professions = Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? 'cook' : 'cop'));

      const allBoards: Board[] = [];
      for (let mask = 0; mask < 512; mask++) {
        const criminal = Array.from({ length: 9 }, (_, i) => ((mask >> i) & 1) === 1);
        allBoards.push(makeBoard(grid, professions, criminal));
      }

      const distinct = new Map<string, Hint>();
      for (const b of allBoards) {
        for (const h of candidateHints(b)) {
          const key = formatHint(h);
          if (!distinct.has(key)) distinct.set(key, h);
        }
      }

      // Guards against a vacuous pass: if candidateHints ever regressed to emitting
      // nothing (or near-nothing, e.g. from an over-eager filter), the loop below would
      // trivially "pass" having checked almost nothing. Measured distinct count across all
      // 512 pools on this fixture is ~18,800; 15,000 leaves headroom for incidental
      // variation without masking a real regression.
      expect(distinct.size).toBeGreaterThan(15_000);

      for (const h of distinct.values()) {
        const isFalsifiable = allBoards.some((other) => !evaluate(other, h));
        expect(isFalsifiable, formatHint(h)).toBe(true);
      }
    },
    60_000,
  );
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

  it('includes a neighbor unit\'s own anchor card, not just its members', () => {
    // unitMembers(neighbor,5) is 5's neighbors, which never includes 5 itself — but every
    // rendering of a neighbor unit names the anchor card explicitly (e.g. "neighboring
    // #NAME:5"), so the anchor must be treated as referenced too.
    const cards = referencedCards(board, parseHint('has_most_traits(unit(neighbor,5),criminal)'));
    expect(cards).toContain(5);
  });
});

describe('namedCards', () => {
  it('only names direct indices, a neighbor unit\'s anchor, and between endpoints — not ordinary unit members', () => {
    // A plain row/col unit never puts a literal card index in the rendered text
    // (it renders as a locative phrase like "in row 2"), so none of its members
    // should show up here — unlike referencedCards, which deliberately includes
    // them for the pool-building use case at its other call site.
    expect(namedCards(board, parseHint('number_of_traits_in_unit(unit(row,2),criminal,1)'))).toEqual(new Set());
    expect(namedCards(board, parseHint('has_trait(11,innocent)'))).toEqual(new Set([11]));
    // Arg 1 here is a real card index too (the "one of n" card being described,
    // rendered via #NAME:), not a bare count — so both it and the neighbor
    // unit's anchor are named.
    expect(namedCards(board, parseHint('is_one_of_n_traits_in_unit(unit(neighbor,5),1,criminal,2)'))).toEqual(
      new Set([5, 1]),
    );
    expect(
      namedCards(board, parseHint('all_traits_are_neighbors_in_unit(unit(between,pair(0,3)),criminal)')),
    ).toEqual(new Set([0, 3]));
    expect(namedCards(board, parseHint('has_most_traits(unit(profession,cook),criminal)'))).toEqual(new Set());
  });

  it(
    'agrees exactly with the rendered #NAME:/#NAMES:/#BETWEEN: markers on every non-null clue in the archive',
    () => {
      // The archive is the ground truth for "what does a real rendering ever put
      // in the text": for every non-null clue on every real (non-generated)
      // puzzle, namedCards(board, hint).has(i) must match whether card i's own
      // index appears as a #NAME:/#NAMES: argument or as either endpoint of a
      // #BETWEEN:pair(a,b) in that clue's already-rendered text. Measured once
      // directly against this archive: 660 non-null clues total, of which
      // exactly 30 name their own host — asserting both counts below rules out
      // a vacuous pass (e.g. from an empty archive or a namedCards that always
      // returns nothing).
      const archive = loadArchive();
      let total = 0;
      let positive = 0;

      for (const { file, puzzle, board: puzzleBoard } of archive) {
        puzzle.people.forEach((person, i) => {
          if (!person.origHint || !person.clue) return;
          total++;
          const hint = parseHint(person.origHint);
          const fnSays = namedCards(puzzleBoard, hint).has(i);
          const clue = person.clue;

          let regexSays = false;
          for (const m of clue.matchAll(/#NAMES?:(\d+)/g)) {
            if (Number(m[1]) === i) regexSays = true;
          }
          for (const m of clue.matchAll(/#BETWEEN:pair\((\d+),(\d+)\)/g)) {
            if (Number(m[1]) === i || Number(m[2]) === i) regexSays = true;
          }

          expect(fnSays, `${file} person ${i}: "${clue}" (${person.origHint})`).toBe(regexSays);
          if (fnSays) positive++;
        });
      }

      expect(total).toBe(660);
      expect(positive).toBe(30);
    },
  );
});
