import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { ARG_KINDS, parseHint } from './hint';
import { type Board, countTrait, evaluate, EVALUATORS, unitMembers, unitsOfKind } from './predicates';

// 4x5. Criminals at 0, 1, 6, 13, 19.
const CRIMINALS = [0, 1, 6, 13, 19];
const PROFS = [
  'cook', 'cook', 'cop', 'cop',
  'cook', 'cop', 'pilot', 'pilot',
  'pilot', 'pilot', 'cook', 'cop',
  'cook', 'cook', 'cop', 'cop',
  'pilot', 'pilot', 'pilot', 'cook',
];
const board: Board = {
  grid: makeGrid(4, 5),
  professions: PROFS,
  criminal: Array.from({ length: 20 }, (_, i) => CRIMINALS.includes(i)),
};

const ok = (s: string) => evaluate(board, parseHint(s));

describe('unitMembers', () => {
  it('resolves every unit kind', () => {
    expect(unitMembers(board, { kind: 'row', n: 2 })).toEqual([4, 5, 6, 7]);
    expect(unitMembers(board, { kind: 'col', n: 3 })).toEqual([2, 6, 10, 14, 18]);
    expect(unitMembers(board, { kind: 'neighbor', i: 5 })).toEqual([0, 1, 2, 4, 6, 8, 9, 10]);
    expect(unitMembers(board, { kind: 'between', a: 2, b: 14 })).toEqual([2, 6, 10, 14]);
    expect(unitMembers(board, { kind: 'corner' })).toEqual([0, 3, 16, 19]);
    expect(unitMembers(board, { kind: 'profession', name: 'cop' })).toEqual([2, 3, 5, 11, 14, 15]);
  });
});

describe('unitsOfKind', () => {
  it('enumerates instances', () => {
    expect(unitsOfKind(board, 'row')).toHaveLength(5);
    expect(unitsOfKind(board, 'col')).toHaveLength(4);
    expect(unitsOfKind(board, 'neighbor')).toHaveLength(20);
    expect(unitsOfKind(board, 'edge')).toEqual([{ kind: 'edge' }]);
    expect(unitsOfKind(board, 'profession').map((u) => (u as { name: string }).name).sort()).toEqual(
      ['cook', 'cop', 'pilot'],
    );
  });
});

describe('countTrait', () => {
  it('counts both traits over a member list', () => {
    expect(countTrait(board, [0, 1, 2, 3], 'criminal')).toBe(2);
    expect(countTrait(board, [0, 1, 2, 3], 'innocent')).toBe(2);
  });
});

describe('counting predicates', () => {
  it('has_trait', () => {
    expect(ok('has_trait(0,criminal)')).toBe(true);
    expect(ok('has_trait(0,innocent)')).toBe(false);
    expect(ok('has_trait(2,innocent)')).toBe(true);
  });
  it('number_of_traits', () => {
    expect(ok('number_of_traits(criminal,5)')).toBe(true);
    expect(ok('number_of_traits(innocent,15)')).toBe(true);
    expect(ok('number_of_traits(criminal,4)')).toBe(false);
  });
  it('number_of_traits_in_unit', () => {
    expect(ok('number_of_traits_in_unit(unit(row,1),criminal,2)')).toBe(true);
    expect(ok('number_of_traits_in_unit(unit(corner,void),criminal,2)')).toBe(true);
    expect(ok('number_of_traits_in_unit(unit(between,pair(4,7)),criminal,1)')).toBe(true);
  });
  it('min_number_of_traits_in_unit is >=', () => {
    expect(ok('min_number_of_traits_in_unit(unit(row,1),criminal,2)')).toBe(true);
    expect(ok('min_number_of_traits_in_unit(unit(row,1),criminal,1)')).toBe(true);
    expect(ok('min_number_of_traits_in_unit(unit(row,1),criminal,3)')).toBe(false);
  });
  it('odd_number_of_traits_in_unit', () => {
    expect(ok('odd_number_of_traits_in_unit(unit(row,1),criminal)')).toBe(false);
    expect(ok('odd_number_of_traits_in_unit(unit(row,2),criminal)')).toBe(true);
  });
  it('is_one_of_n_traits_in_unit requires membership and the trait', () => {
    expect(ok('is_one_of_n_traits_in_unit(unit(row,1),0,criminal,2)')).toBe(true);
    expect(ok('is_one_of_n_traits_in_unit(unit(row,1),2,criminal,2)')).toBe(false);
    expect(ok('is_one_of_n_traits_in_unit(unit(row,2),0,criminal,2)')).toBe(false);
  });
  it('is_not_only_trait_in_unit', () => {
    expect(ok('is_not_only_trait_in_unit(unit(row,1),0,criminal)')).toBe(true);
    expect(ok('is_not_only_trait_in_unit(unit(row,2),6,criminal)')).toBe(false);
  });
  it('all_units_have_at_least_n_traits ranges over a bare kind', () => {
    expect(ok('all_units_have_at_least_n_traits(row,innocent,2)')).toBe(true);
    expect(ok('all_units_have_at_least_n_traits(row,criminal,1)')).toBe(false);
    expect(ok('all_units_have_at_least_n_traits(col,innocent,2)')).toBe(true);
  });
  it('only_one_unit_has_exactly_n_traits', () => {
    expect(ok('only_one_unit_has_exactly_n_traits(row,criminal,2)')).toBe(true);
    expect(ok('only_one_unit_has_exactly_n_traits(row,criminal,1)')).toBe(false);
    expect(ok('only_one_unit_has_exactly_n_traits(row,criminal,0)')).toBe(true);
  });
});

describe('comparison predicates', () => {
  it('more_traits_in_unit_than_unit is strict', () => {
    expect(ok('more_traits_in_unit_than_unit(unit(row,1),unit(row,2),criminal)')).toBe(true);
    expect(ok('more_traits_in_unit_than_unit(unit(row,2),unit(row,1),criminal)')).toBe(false);
    expect(ok('more_traits_in_unit_than_unit(unit(row,2),unit(row,4),criminal)')).toBe(false);
  });
  it('equal_number_of_traits_in_units', () => {
    expect(ok('equal_number_of_traits_in_units(unit(row,2),unit(row,4),criminal)')).toBe(true);
    expect(ok('equal_number_of_traits_in_units(unit(row,1),unit(row,2),criminal)')).toBe(false);
  });
  it('more_traits_than_traits_in_unit compares two traits inside one unit', () => {
    expect(ok('more_traits_than_traits_in_unit(unit(row,1),criminal,innocent)')).toBe(false);
    expect(ok('more_traits_than_traits_in_unit(unit(row,3),innocent,criminal)')).toBe(true);
  });
  it('equal_traits_and_traits_in_unit', () => {
    expect(ok('equal_traits_and_traits_in_unit(unit(row,1),criminal,innocent)')).toBe(true);
    expect(ok('equal_traits_and_traits_in_unit(unit(row,2),criminal,innocent)')).toBe(false);
  });
  it('has_most_traits is a strict maximum over the same kind', () => {
    expect(ok('has_most_traits(unit(row,1),criminal)')).toBe(true);
    expect(ok('has_most_traits(unit(row,2),criminal)')).toBe(false);
    expect(ok('has_most_traits(unit(col,2),criminal)')).toBe(true);
  });
  it('only_unit_has_exactly_n_traits', () => {
    expect(ok('only_unit_has_exactly_n_traits(unit(row,1),criminal,2)')).toBe(true);
    expect(ok('only_unit_has_exactly_n_traits(unit(row,2),criminal,1)')).toBe(false);
  });
  it('units_share_n_traits counts the intersection', () => {
    expect(ok('units_share_n_traits(unit(row,1),unit(col,1),criminal,1)')).toBe(true);
    expect(ok('units_share_n_traits(unit(row,1),unit(row,2),criminal,0)')).toBe(true);
  });
  it('units_share_odd_n_traits', () => {
    expect(ok('units_share_odd_n_traits(unit(row,1),unit(col,1),criminal)')).toBe(true);
    expect(ok('units_share_odd_n_traits(unit(row,1),unit(row,2),criminal)')).toBe(false);
  });
  it('unit_shares_n_out_of_n_traits_with_unit constrains total and overlap', () => {
    expect(ok('unit_shares_n_out_of_n_traits_with_unit(unit(row,1),unit(col,1),criminal,1,2)')).toBe(
      true,
    );
    expect(ok('unit_shares_n_out_of_n_traits_with_unit(unit(row,1),unit(col,1),criminal,1,1)')).toBe(
      false,
    );
    expect(ok('unit_shares_n_out_of_n_traits_with_unit(unit(row,1),unit(col,1),criminal,2,2)')).toBe(
      false,
    );
  });
});

describe('adjacency and direction predicates', () => {
  it('covers every predicate in the signature table', () => {
    expect(Object.keys(EVALUATORS).sort()).toEqual(Object.keys(ARG_KINDS).sort());
  });
  it('max_number_of_traits_in_neighbors_in_unit caps every member', () => {
    // row 5 is 16..19; criminal-neighbour counts: 16->1 (13), 17->1 (13), 18->2 (13,19), 19->0.
    // Max across the unit is 2.
    expect(ok('max_number_of_traits_in_neighbors_in_unit(unit(row,5),criminal,2)')).toBe(true);
    expect(ok('max_number_of_traits_in_neighbors_in_unit(unit(row,5),criminal,1)')).toBe(false);
  });
  it('both_traits_are_neighbors_in_unit needs exactly two, adjacent', () => {
    expect(ok('both_traits_are_neighbors_in_unit(unit(row,1),criminal)')).toBe(true);
    expect(ok('both_traits_are_neighbors_in_unit(unit(col,1),criminal)')).toBe(false);
    expect(ok('both_traits_are_neighbors_in_unit(unit(between,pair(0,2)),criminal)')).toBe(true);
  });
  it('all_traits_are_neighbors_in_unit is 8-way connectivity', () => {
    expect(ok('all_traits_are_neighbors_in_unit(unit(row,1),criminal)')).toBe(true);
    // col 2 criminals are 1 and 13, not neighbours of each other.
    expect(ok('all_traits_are_neighbors_in_unit(unit(col,2),criminal)')).toBe(false);
  });
  it('both_traits_in_unit_are_in_unit', () => {
    expect(ok('both_traits_in_unit_are_in_unit(unit(row,1),unit(col,1),criminal)')).toBe(false);
    expect(ok('both_traits_in_unit_are_in_unit(unit(row,1),unit(row,1),criminal)')).toBe(true);
  });
  it('only_trait_in_unit_is_in_unit', () => {
    expect(ok('only_trait_in_unit_is_in_unit(unit(row,2),unit(col,3),criminal)')).toBe(true);
    expect(ok('only_trait_in_unit_is_in_unit(unit(row,1),unit(col,3),criminal)')).toBe(false);
  });
  it('only_one_person_in_unit_has_exactly_n_trait_neighbors', () => {
    // row 1 members 0..3, criminal-neighbour counts: 0->1, 1->2, 2->2, 3->1 (two members tie at 1).
    expect(ok('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(row,1),criminal,1)')).toBe(
      false,
    );
    // row 3 members 8..11, criminal-neighbour counts: 8->1, 9->2, 10->2, 11->1 (none reach 3).
    expect(ok('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(row,3),criminal,3)')).toBe(
      false,
    );
  });
  it('n_in_unit_have_trait_in_dir counts on-grid offsets only', () => {
    // corners 0,3,16,19 with an innocent directly to the right: 0->1 criminal (no),
    // 3 off-grid, 16->17 innocent (yes), 19 off-grid.
    expect(ok('n_in_unit_have_trait_in_dir(unit(corner,void),innocent,1,0,1)')).toBe(true);
    expect(ok('n_in_unit_have_trait_in_dir(unit(corner,void),innocent,1,0,2)')).toBe(false);
  });
  it('n_t_in_unit_have_trait_in_dir filters the source by trait too', () => {
    // criminals in row 1 are 0 and 1; to the right: 1 (criminal), 2 (innocent).
    expect(ok('n_t_in_unit_have_trait_in_dir(unit(row,1),criminal,innocent,1,0,1)')).toBe(true);
    expect(ok('n_t_in_unit_have_trait_in_dir(unit(row,1),criminal,criminal,1,0,1)')).toBe(true);
  });
  it('n_professions_have_trait_in_dir ranges over a profession', () => {
    // cooks are 0,1,4,10,12,13,19; directly below each: 4,5,8,14,16,17,off-grid.
    // innocent among those: 4(y),5(y),8(y),14(y),16(y),17(y) -> 6
    expect(ok('n_professions_have_trait_in_dir(cook,innocent,0,1,6)')).toBe(true);
    expect(ok('n_professions_have_trait_in_dir(cook,innocent,0,1,7)')).toBe(false);
  });
});
