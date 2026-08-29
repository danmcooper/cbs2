import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARG_KINDS, formatHint, HintParseError, parseHint } from './hint';

describe('parseHint', () => {
  it('parses a unit with a pair argument', () => {
    expect(parseHint('all_traits_are_neighbors_in_unit(unit(between,pair(0,3)),criminal)')).toEqual({
      pred: 'all_traits_are_neighbors_in_unit',
      args: [
        { t: 'unit', unit: { kind: 'between', a: 0, b: 3 } },
        { t: 'trait', trait: 'criminal' },
      ],
    });
  });

  it('parses bare kinds, numbers and negative direction offsets', () => {
    expect(parseHint('all_units_have_at_least_n_traits(col,innocent,1)').args[0]).toEqual({
      t: 'kind',
      kind: 'col',
    });
    expect(parseHint('n_professions_have_trait_in_dir(cook,innocent,0,-1,1)').args).toEqual([
      { t: 'profession', name: 'cook' },
      { t: 'trait', trait: 'innocent' },
      { t: 'num', n: 0 },
      { t: 'num', n: -1 },
      { t: 'num', n: 1 },
    ]);
  });

  it('parses void-argument units and person indices', () => {
    expect(parseHint('is_one_of_n_traits_in_unit(unit(edge,void),7,innocent,3)').args).toEqual([
      { t: 'unit', unit: { kind: 'edge' } },
      { t: 'index', i: 7 },
      { t: 'trait', trait: 'innocent' },
      { t: 'num', n: 3 },
    ]);
  });

  it('rejects unknown predicates and wrong arity', () => {
    expect(() => parseHint('no_such_predicate(criminal)')).toThrow(HintParseError);
    expect(() => parseHint('number_of_traits(criminal)')).toThrow(HintParseError);
  });
});

describe('formatHint', () => {
  it('round-trips every signature shape', () => {
    for (const s of [
      'has_trait(11,innocent)',
      'number_of_traits(criminal,6)',
      'number_of_traits_in_unit(unit(between,pair(4,7)),innocent,2)',
      'odd_number_of_traits_in_unit(unit(neighbor,12),criminal)',
      'only_one_unit_has_exactly_n_traits(row,criminal,2)',
      'unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,5),unit(row,3),criminal,1,2)',
      'n_t_in_unit_have_trait_in_dir(unit(edge,void),innocent,innocent,1,0,2)',
      'equal_number_of_traits_in_units(unit(profession,cook),unit(profession,cop),innocent)',
    ]) {
      expect(formatHint(parseHint(s))).toBe(s);
    }
  });
});

describe('ARG_KINDS', () => {
  it('covers all 27 predicates', () => {
    expect(Object.keys(ARG_KINDS)).toHaveLength(27);
  });
});

const PUZZLES = path.join(process.cwd(), 'puzzles');
const files = readdirSync(PUZZLES).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));

describe('archive round-trip', () => {
  it('parses and re-formats every origHint in the archive identically', () => {
    let count = 0;
    for (const file of files) {
      const puzzle = JSON.parse(readFileSync(path.join(PUZZLES, file), 'utf8'));
      for (const person of puzzle.people) {
        if (!person.origHint) continue;
        expect(formatHint(parseHint(person.origHint)), `${file}: ${person.origHint}`).toBe(
          person.origHint,
        );
        count++;
      }
    }
    expect(count).toBeGreaterThan(600);
  });
});
