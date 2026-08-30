import { describe, expect, it } from 'vitest';
import { parseHint } from './hint';
import { canRender, render, UnsupportedShapeError } from './render';

const r = (s: string) => render(parseHint(s));

describe('counting clue templates', () => {
  it('has_trait', () => {
    expect(r('has_trait(11,innocent)')).toBe('#NAME:11 is innocent');
    expect(r('has_trait(11,criminal)')).toBe('#NAME:11 is a criminal');
  });
  it('number_of_traits', () => {
    expect(r('number_of_traits(criminal,6)')).toBe('There are 6 criminals in total');
  });
  it('number_of_traits_in_unit over a between segment', () => {
    expect(r('number_of_traits_in_unit(unit(between,pair(4,7)),innocent,1)')).toBe(
      'There is only one innocent #BETWEEN:pair(4,7)',
    );
    expect(r('number_of_traits_in_unit(unit(between,pair(4,7)),innocent,3)')).toBe(
      'There are exactly 3 innocents #BETWEEN:pair(4,7)',
    );
    expect(r('number_of_traits_in_unit(unit(between,pair(4,7)),criminal,0)')).toBe(
      'There are no criminals #BETWEEN:pair(4,7)',
    );
  });
  it('number_of_traits_in_unit over neighbours, rows, columns, edges, corners', () => {
    expect(r('number_of_traits_in_unit(unit(neighbor,5),criminal,2)')).toBe(
      '#NAME:5 has exactly 2 criminal neighbors',
    );
    expect(r('number_of_traits_in_unit(unit(neighbor,5),innocent,1)')).toBe(
      '#NAME:5 has only one innocent neighbor',
    );
    expect(r('number_of_traits_in_unit(unit(neighbor,5),criminal,0)')).toBe(
      '#NAME:5 has no criminal neighbors',
    );
    expect(r('number_of_traits_in_unit(unit(row,3),innocent,2)')).toBe(
      'There are exactly 2 innocents in row 3',
    );
    expect(r('number_of_traits_in_unit(unit(col,2),criminal,1)')).toBe(
      'There is only one criminal in column #C:2',
    );
    // Ground truth (docs/superpowers/specs/2026-08-29-clue-templates.txt, "number_of_traits_in_unit"
    // section) attests only the bare-number phrasing for the edge unit ("There are N innocents on
    // the edges" / "There are N criminals on the edges") — never "exactly N ... on the edges".
    // The brief's step-1 test used "exactly 7"; ground truth wins per task instructions.
    expect(r('number_of_traits_in_unit(unit(edge,void),innocent,7)')).toBe(
      'There are 7 innocents on the edges',
    );
    expect(r('number_of_traits_in_unit(unit(corner,void),innocent,3)')).toBe(
      'There are exactly 3 innocents in the corners',
    );
  });
  it('min_number_of_traits_in_unit', () => {
    expect(r('min_number_of_traits_in_unit(unit(col,2),innocent,3)')).toBe(
      'There are at least 3 innocents in column #C:2',
    );
    expect(r('min_number_of_traits_in_unit(unit(between,pair(0,3)),innocent,1)')).toBe(
      'There is at least one innocent #BETWEEN:pair(0,3)',
    );
  });
  it('odd_number_of_traits_in_unit', () => {
    expect(r('odd_number_of_traits_in_unit(unit(neighbor,12),innocent)')).toBe(
      "There's an odd number of innocents neighboring #NAME:12",
    );
    expect(r('odd_number_of_traits_in_unit(unit(col,3),criminal)')).toBe(
      "There's an odd number of criminals in column #C:3",
    );
    expect(r('odd_number_of_traits_in_unit(unit(profession,singer),criminal)')).toBe(
      "There's an odd number of criminal #PROFS:singer",
    );
  });
  it('is_one_of_n_traits_in_unit', () => {
    expect(r('is_one_of_n_traits_in_unit(unit(neighbor,9),4,innocent,3)')).toBe(
      '#NAME:4 is one of #NAMES:9 3 innocent neighbors',
    );
    expect(r('is_one_of_n_traits_in_unit(unit(between,pair(0,3)),1,criminal,2)')).toBe(
      '#NAME:1 is one of 2 criminals #BETWEEN:pair(0,3)',
    );
    expect(r('is_one_of_n_traits_in_unit(unit(edge,void),7,innocent,5)')).toBe(
      '#NAME:7 is one of 5 innocents on the edges',
    );
  });
  it('is_not_only_trait_in_unit', () => {
    expect(r('is_not_only_trait_in_unit(unit(row,2),5,innocent)')).toBe(
      '#NAME:5 is one of two or more innocents in row 2',
    );
  });
  it('all_units_have_at_least_n_traits', () => {
    expect(r('all_units_have_at_least_n_traits(col,innocent,2)')).toBe(
      'Each column has at least 2 innocents',
    );
    expect(r('all_units_have_at_least_n_traits(row,innocent,1)')).toBe(
      'Each row has at least one innocent',
    );
    expect(r('all_units_have_at_least_n_traits(profession,criminal,1)')).toBe(
      'There is at least one criminal among all professions',
    );
    expect(r('all_units_have_at_least_n_traits(neighbor,criminal,2)')).toBe(
      'Everyone has at least 2 criminal neighbors',
    );
  });
  it('only_one_unit_has_exactly_n_traits', () => {
    expect(r('only_one_unit_has_exactly_n_traits(row,criminal,2)')).toBe(
      'Only one row has exactly 2 criminals',
    );
    expect(r('only_one_unit_has_exactly_n_traits(col,innocent,1)')).toBe(
      'Only one column has exactly one innocent',
    );
    expect(r('only_one_unit_has_exactly_n_traits(col,criminal,0)')).toBe(
      'Only one column has no criminals',
    );
  });
});

describe('unsupported shapes', () => {
  it('throws rather than inventing a phrasing', () => {
    expect(() => r('number_of_traits_in_unit(unit(profession,cook),innocent,2)')).toThrow(
      UnsupportedShapeError,
    );
    expect(canRender(parseHint('number_of_traits_in_unit(unit(profession,cook),innocent,2)'))).toBe(
      false,
    );
    expect(canRender(parseHint('number_of_traits_in_unit(unit(row,1),innocent,2)'))).toBe(true);
  });
});
