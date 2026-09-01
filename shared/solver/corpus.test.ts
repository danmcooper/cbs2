import { describe, expect, it } from 'vitest';
import { parseHint } from './hint';
import { evaluate } from './predicates';
import { archiveClueMix, CROSS_TRAIT, CROSS_TRAIT_RATE, loadArchive, isSelfReferential } from './corpus';
import { canRender, render } from './render';
import type { Shape } from './enumerate';
import { forcedGiven, isUniquelySolvable, parseClues } from './solve';
import { makeGrid } from './grid';

const archive = loadArchive();

describe('archive', () => {
  it('loads every real puzzle', () => {
    expect(archive.length).toBeGreaterThanOrEqual(53);
    for (const { file, puzzle } of archive) {
      expect(puzzle.width, file).toBe(4);
      expect(puzzle.height, file).toBe(5);
    }
  });
});

describe('archiveClueMix', () => {
  const mix = archiveClueMix();

  it('reports predicate and feature shares that each sum to one', () => {
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    expect(sum(mix.pred)).toBeCloseTo(1, 10);
    expect(sum(mix.feature)).toBeCloseTo(1, 10);
    for (const v of [...Object.values(mix.pred), ...Object.values(mix.feature)]) {
      expect(v).toBeGreaterThan(0);
    }
  });

  it('covers every predicate the archive uses, and keys features by unit kind, between-span ' +
    'length, and direction', () => {
    const preds = new Set<string>();
    for (const { puzzle } of archive) {
      for (const person of puzzle.people) {
        if (!person.origHint) continue;
        preds.add(parseHint(person.origHint).pred);
      }
    }
    // Plus the cross-trait comparisons, which no archived clue uses and which
    // are budgeted in deliberately — see the test below.
    expect(new Set(Object.keys(mix.pred))).toEqual(new Set([...preds, ...Object.keys(CROSS_TRAIT)]));
    for (const invented of Object.keys(CROSS_TRAIT)) expect(preds.has(invented)).toBe(false);

    const features = Object.keys(mix.feature);
    expect(new Set(features.filter((f) => f.startsWith('unit:')))).toEqual(
      new Set([
        'unit:row', 'unit:col', 'unit:neighbor', 'unit:profession', 'unit:edge', 'unit:corner',
        // A between segment spans 2 to 5 cards on a 4x5 board (a whole column
        // is 5, a whole row 4); every length occurs in the archive.
        'unit:between:2', 'unit:between:3', 'unit:between:4', 'unit:between:5',
      ]),
    );
    expect(new Set(features.filter((f) => f.startsWith('dir:')))).toEqual(
      new Set(['dir:-1,0', 'dir:1,0', 'dir:0,-1', 'dir:0,1']),
    );
  });

  it('budgets for the cross-trait comparisons the source never wrote', () => {
    // The source compares one trait across two units ("more criminals in row 1
    // than row 4") and two traits inside one unit ("more criminals than
    // innocents in row 1"), but never both at once — no archived clue says "as
    // many innocent cooks as criminal cops". Nothing in the game forbids it, and
    // a mix read straight off the archive gives it share 0, which in `orderPool`
    // means it is never drawn. So it gets an explicit budget, pegged to the
    // same-trait form it extends: seen less often than its parent, often enough
    // to turn up.
    for (const [invented, parent] of [
      ['more_traits_in_unit_than_traits_in_unit', 'more_traits_in_unit_than_unit'],
      ['equal_traits_in_unit_and_traits_in_unit', 'equal_number_of_traits_in_units'],
    ]) {
      expect(mix.pred[invented]).toBeGreaterThan(0);
      expect(mix.pred[invented]).toBeLessThan(mix.pred[parent]);
      expect(mix.pred[invented] / mix.pred[parent]).toBeCloseTo(CROSS_TRAIT_RATE, 6);
    }
  });

  it('records the profession group sizes of every archived puzzle', () => {
    // Real casts are ragged — 7 to 11 professions (one themed outlier at 16) in
    // groups of mostly 2 and 3 — where generation used to hand out a rigid five
    // professions of exactly four people, 54 puzzles running. Sampling a whole
    // observed shape reproduces the raggedness, the distinct-profession count,
    // and the rarity of singletons in one draw, without a model of any of them.
    expect(mix.professionShapes.length).toBe(archive.length);
    for (const shape of mix.professionShapes) {
      expect(shape.reduce((a, b) => a + b, 0)).toBe(20);
      expect(shape).toEqual([...shape].sort((a, b) => b - a));
      expect(shape.length).toBeGreaterThanOrEqual(7);
    }
    const sizes = mix.professionShapes.flat();
    const twosAndThrees = sizes.filter((n) => n === 2 || n === 3).length;
    expect(twosAndThrees / sizes.length).toBeGreaterThan(0.8);
  });

  it('ranks the archive\'s own favourites first', () => {
    // Sanity anchors measured off the 54 archived puzzles: the plain count clue
    // is the single most common, and `neighbor` edges out `between` among units.
    const top = (r: Record<string, number>) =>
      Object.entries(r).sort((a, b) => b[1] - a[1])[0][0];
    expect(top(mix.pred)).toBe('number_of_traits_in_unit');
    expect(top(mix.feature)).toBe('unit:neighbor');
    const between = Object.entries(mix.feature)
      .filter(([k]) => k.startsWith('unit:between:'))
      .reduce((a, [, v]) => a + v, 0);
    expect(between).toBeLessThan(mix.feature['unit:neighbor']);
    // Real between clues lean long: four-card spans are the most common by far
    // and two-card ones the rarest. Generation had it the other way round.
    expect(mix.feature['unit:between:4']).toBeGreaterThan(mix.feature['unit:between:2'] * 2);
    // The four directions are used near-evenly; none is twice another.
    const dirs = Object.entries(mix.feature).filter(([k]) => k.startsWith('dir:')).map(([, v]) => v);
    expect(Math.max(...dirs)).toBeLessThan(Math.min(...dirs) * 2.5);
  });
});

describe('evaluator soundness', () => {
  it('every stored origHint is true of its own puzzle solution', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { file, puzzle, board } of archive) {
      puzzle.people.forEach((person, i) => {
        if (!person.origHint) return;
        checked++;
        if (!evaluate(board, parseHint(person.origHint))) {
          failures.push(`${file} people[${i}]: ${person.origHint}`);
        }
      });
    }
    expect(checked).toBeGreaterThan(600);
    expect(failures).toEqual([]);
  });
});

describe('renderer fidelity', () => {
  it('reproduces at least 95% of non-self-referential archive clues exactly', () => {
    const mismatches: string[] = [];
    let comparable = 0;
    let selfReferential = 0;
    let unsupported = 0;

    for (const { file, puzzle } of archive) {
      puzzle.people.forEach((person, i) => {
        if (!person.origHint || !person.clue) return;
        if (isSelfReferential(puzzle, i)) {
          selfReferential++;
          return;
        }
        const hint = parseHint(person.origHint);
        if (!canRender(hint)) {
          unsupported++;
          return;
        }
        comparable++;
        const got = render(hint);
        if (got !== person.clue) {
          mismatches.push(`${file} [${i}] ${person.origHint}\n  want: ${person.clue}\n  got:  ${got}`);
        }
      });
    }

    const ratio = (comparable - mismatches.length) / comparable;
    console.log(
      `fidelity ${(ratio * 100).toFixed(1)}% of ${comparable} comparable ` +
        `(${selfReferential} self-referential, ${unsupported} unsupported shapes)`,
    );
    expect(ratio).toBeGreaterThanOrEqual(0.95);
    expect(mismatches.sort()).toMatchSnapshot();
  });
});

function shapeOf(puzzle: (typeof archive)[number]['puzzle']): Shape {
  return {
    grid: makeGrid(puzzle.width, puzzle.height),
    professions: puzzle.people.map((p) => p.profession),
  };
}

describe('solver agreement', () => {
  it('every archived puzzle is uniquely solvable under its full clue set', { timeout: 600_000 }, () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { file, puzzle } of archive) {
      const clues = parseClues(puzzle.people.map((p) => p.origHint));
      const truth = puzzle.people.map((p) => p.criminal);
      checked++;
      if (!isUniquelySolvable(shapeOf(puzzle), clues, truth, puzzle.initialReveals)) {
        failures.push(file);
      }
    }
    console.log(`puzzles checked: ${checked}`);
    expect(checked).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });

  it('every stored path is genuinely sufficient', { timeout: 600_000 }, () => {
    const failures: string[] = [];
    let pathsChecked = 0;
    for (const { file, puzzle } of archive) {
      const shape = shapeOf(puzzle);
      const clues = parseClues(puzzle.people.map((p) => p.origHint));
      const truth = puzzle.people.map((p) => p.criminal);
      puzzle.people.forEach((person, i) => {
        if (person.paths === null) return;
        for (const path of person.paths) {
          if (path.includes(i)) continue; // trivially known once flipped
          pathsChecked++;
          if (forcedGiven(shape, clues, truth, path)[i] === null) {
            failures.push(`${file} [${i}] path ${path.join(',')}`);
          }
        }
      });
    }
    console.log(`paths checked: ${pathsChecked}`);
    expect(pathsChecked).toBeGreaterThan(1000);
    expect(failures).toEqual([]);
  });
});
