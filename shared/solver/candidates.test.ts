import { describe, expect, it } from 'vitest';
import { loadArchive } from './corpus';
import { makeGrid, neighbors } from './grid';
import { type Hint, formatHint, parseHint } from './hint';
import { type Board, makeBoard, evaluate, unitMembers } from './predicates';
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
  it('offers cross-trait comparisons between two units, but only where they say something new', () => {
    const cross = hints.filter(
      (h) =>
        h.pred === 'more_traits_in_unit_than_traits_in_unit' ||
        h.pred === 'equal_traits_in_unit_and_traits_in_unit',
    );
    expect(cross.length).toBeGreaterThan(0);
    for (const h of cross) {
      const [u1, t1, u2, t2] = h.args;
      expect(u1.t, formatHint(h)).toBe('unit');
      expect(u2.t, formatHint(h)).toBe('unit');
      if (u1.t !== 'unit' || u2.t !== 'unit') continue;
      // Same kind, because that is the only shape the renderer has words for, and
      // because "as many criminals in row 2 as innocent cooks" reads as two clues
      // glued together.
      expect(u1.unit.kind, formatHint(h)).toBe(u2.unit.kind);
      expect(formatHint({ ...h, args: [u1] })).not.toBe(formatHint({ ...h, args: [u2] }));
      // Equal traits would make this the existing same-trait comparison in longer
      // words; equal units would make it the existing same-unit one.
      expect(t1.t === 'trait' && t2.t === 'trait' && t1.trait !== t2.trait, formatHint(h)).toBe(true);
    }
  });
  it('contains no duplicates', () => {
    const strings = hints.map(formatHint);
    expect(new Set(strings).size).toBe(strings.length);
  });
  it('never shares all of a unit\'s traits — "only 1 of the 1" is both bad phrasing and a ' +
    'duplicate of both_traits_in_unit_are_in_unit, and the archive has no such instance', () => {
    let seen = 0;
    for (const h of hints) {
      if (h.pred !== 'unit_shares_n_out_of_n_traits_with_unit') continue;
      seen++;
      const [shared, total] = h.args.slice(3);
      expect(shared.t).toBe('num');
      expect(total.t).toBe('num');
      if (shared.t === 'num' && total.t === 'num') {
        expect(shared.n, formatHint(h)).toBeLessThan(total.n);
      }
    }
    // Guard against a vacuous pass if the predicate stops being generated entirely.
    expect(seen).toBeGreaterThan(0);
  });
  it('never asks whether traits are connected inside a unit whose members are all mutually ' +
    'adjacent — the connectedness clause carries no information there', () => {
    // "Both innocents between #12 and #13 are connected": those are the only two
    // cards in the segment and they are side by side, so this says no more than
    // "there are exactly 2 innocents there". Not a tautology — it can be false —
    // but the connectedness half of it is free, which is why the archive's 54
    // instances are all full rows, full columns, or 3+ card spans and never this.
    // all_traits_are_neighbors_in_unit is already guarded; both_ was not.
    const connectedness = ['both_traits_are_neighbors_in_unit', 'all_traits_are_neighbors_in_unit'];
    let seen = 0;
    for (const h of hints) {
      if (!connectedness.includes(h.pred)) continue;
      seen++;
      const arg0 = h.args[0];
      if (arg0.t !== 'unit') throw new Error('expected a unit');
      const members = unitMembers(board, arg0.unit);
      const clique = members.every((x) => members.every((y) => x === y || neighbors(board.grid, x).includes(y)));
      expect(clique, formatHint(h)).toBe(false);
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('never counts zero in a directional clue — the archive floors all three families at one, ' +
    'and "0 #PROFS:guard have a criminal directly above them" is not how the source words it', () => {
    // These read as a template that never got its "no one" branch: the source
    // says "Only one person in a corner has an innocent above them", never
    // "0 persons in a corner have...". Measured over the 54 real puzzles, by
    // argument position: n_in_unit 1x9/2x5/4x2, n_t_in_unit 1x4/2x6/3x1/4x1,
    // n_professions 1x13/2x8 — not one zero among the 41.
    const dirFamilies = new Set([
      'n_in_unit_have_trait_in_dir',
      'n_t_in_unit_have_trait_in_dir',
      'n_professions_have_trait_in_dir',
    ]);
    let seen = 0;
    for (const h of hints) {
      if (!dirFamilies.has(h.pred)) continue;
      seen++;
      const count = h.args[h.args.length - 1];
      expect(count.t).toBe('num');
      if (count.t === 'num') expect(count.n, formatHint(h)).toBeGreaterThan(0);
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('never says a card is "one of 1" of a trait — the same slip as "1 of the 1", and the ' +
    'archive floors this count at two', () => {
    // "#NAME:1 is one of 1 criminals between #0 and #3" should be "is the only
    // criminal between...". The archive's 63 instances start at 2 (2x15, 3x23,
    // then a long tail); is_not_only_trait_in_unit already covers the >= 2 case
    // in words that work, and the n = 1 case has no rendering that does.
    let seen = 0;
    for (const h of hints) {
      if (h.pred !== 'is_one_of_n_traits_in_unit') continue;
      seen++;
      const count = h.args[3];
      expect(count.t).toBe('num');
      if (count.t === 'num') expect(count.n, formatHint(h)).toBeGreaterThan(1);
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('never singles out one member of a unit whose members all share the trait — "Cleo is one ' +
    'of Desmond\'s 3 innocent neighbors" says nothing when Desmond sits in a corner', () => {
    // Who neighbors whom is visible on the board, so when the count covers the
    // whole unit the clue reduces to "every one of them has the trait" and the
    // named card adds nothing — while the wording implies a distinction that
    // isn't there. None of the archive's 42 instances counts a whole unit.
    let seen = 0;
    for (const h of hints) {
      if (h.pred !== 'is_one_of_n_traits_in_unit') continue;
      const unit = h.args[0];
      const count = h.args[3];
      expect(unit.t).toBe('unit');
      expect(count.t).toBe('num');
      if (unit.t !== 'unit' || count.t !== 'num') continue;
      seen++;
      expect(count.n, formatHint(h)).toBeLessThan(unitMembers(board, unit.unit).length);
    }
    expect(seen).toBeGreaterThan(0);
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
      // exactly 30 name their own host. Those are floors rather than equalities
      // because the archive gains a puzzle a night, and an assertion that has to
      // be edited on every scrape stops being read; what they still rule out is
      // the vacuous pass — an empty archive, or a namedCards that always returns
      // nothing.
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

      expect(archive.length).toBeGreaterThanOrEqual(54);
      expect(total).toBeGreaterThanOrEqual(660);
      expect(positive).toBeGreaterThanOrEqual(30);
    },
  );
});
