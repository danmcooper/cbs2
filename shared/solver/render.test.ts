import { describe, expect, it } from 'vitest';
import { ARG_KINDS, parseHint } from './hint';
import { canRender, render, RENDERERS, UnsupportedShapeError } from './render';

const r = (s: string) => render(parseHint(s));

// NOTE: many expected strings below join "row"/"column" to the following number
// or #C: token with a U+00A0 non-breaking space rather than a plain space (looks
// identical in a diff/editor). That matches the archive's convention for locative
// and comparative phrasings — see the `NBSP` constant in render.ts and
// corpus.test.ts's renderer-fidelity test, which measures this against every
// real puzzle in puzzles/*.json.

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
      'There are exactly 2 innocents in row 3',
    );
    expect(r('number_of_traits_in_unit(unit(col,2),criminal,1)')).toBe(
      'There is only one criminal in column #C:2',
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
      'There are at least 3 innocents in column #C:2',
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
      "There's an odd number of criminals in column #C:3",
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
      '#NAME:5 is one of two or more innocents in row 2',
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

describe('comparison clue templates', () => {
  it('more_traits_in_unit_than_unit', () => {
    expect(r('more_traits_in_unit_than_unit(unit(neighbor,3),unit(neighbor,9),criminal)')).toBe(
      '#NAME:3 has more criminal neighbors than #NAME:9',
    );
    expect(r('more_traits_in_unit_than_unit(unit(row,1),unit(row,4),innocent)')).toBe(
      'There are more innocents in row 1 than row 4',
    );
    expect(r('more_traits_in_unit_than_unit(unit(col,1),unit(col,3),criminal)')).toBe(
      'There are more criminals in column #C:1 than column #C:3',
    );
    expect(
      r('more_traits_in_unit_than_unit(unit(profession,cook),unit(profession,cop),criminal)'),
    ).toBe('There are more criminal #PROFS:cook than criminal #PROFS:cop');
  });
  it('equal_number_of_traits_in_units', () => {
    expect(r('equal_number_of_traits_in_units(unit(neighbor,3),unit(neighbor,9),criminal)')).toBe(
      '#NAME:3 and #NAME:9 have an equal number of criminal neighbors',
    );
    expect(r('equal_number_of_traits_in_units(unit(row,1),unit(row,4),innocent)')).toBe(
      "There's an equal number of innocents in rows 1 and 4",
    );
    expect(r('equal_number_of_traits_in_units(unit(col,1),unit(col,3),criminal)')).toBe(
      "There's an equal number of criminals in columns #C:1 and #C:3",
    );
    expect(
      r('equal_number_of_traits_in_units(unit(profession,cook),unit(profession,cop),innocent)'),
    ).toBe('There are as many innocent #PROFS:cook as there are innocent #PROFS:cop');
  });
  it('more_traits_than_traits_in_unit', () => {
    expect(r('more_traits_than_traits_in_unit(unit(between,pair(0,3)),innocent,criminal)')).toBe(
      'There are more innocents than criminals #BETWEEN:pair(0,3)',
    );
    expect(r('more_traits_than_traits_in_unit(unit(neighbor,5),criminal,innocent)')).toBe(
      '#NAME:5 has more criminal than innocent neighbors',
    );
  });
  it('equal_traits_and_traits_in_unit', () => {
    expect(r('equal_traits_and_traits_in_unit(unit(between,pair(0,3)),criminal,innocent)')).toBe(
      'There are as many criminals as innocents #BETWEEN:pair(0,3)',
    );
    expect(r('equal_traits_and_traits_in_unit(unit(profession,cop),innocent,criminal)')).toBe(
      "There's an equal number of innocent and criminal #PROFS:cop",
    );
  });
  it('more_traits_in_unit_than_traits_in_unit', () => {
    expect(
      r('more_traits_in_unit_than_traits_in_unit(unit(neighbor,3),criminal,unit(neighbor,9),innocent)'),
    ).toBe('#NAME:3 has more criminal neighbors than #NAME:9 has innocent ones');
    expect(r('more_traits_in_unit_than_traits_in_unit(unit(row,1),innocent,unit(row,4),criminal)')).toBe(
      'There are more innocents in row 1 than criminals in row 4',
    );
    expect(r('more_traits_in_unit_than_traits_in_unit(unit(col,1),criminal,unit(col,3),innocent)')).toBe(
      'There are more criminals in column #C:1 than innocents in column #C:3',
    );
    expect(
      r('more_traits_in_unit_than_traits_in_unit(unit(profession,cook),innocent,unit(profession,cop),criminal)'),
    ).toBe('There are more innocent #PROFS:cook than criminal #PROFS:cop');
  });
  it('equal_traits_in_unit_and_traits_in_unit', () => {
    expect(
      r('equal_traits_in_unit_and_traits_in_unit(unit(neighbor,3),criminal,unit(neighbor,9),innocent)'),
    ).toBe('#NAME:3 has as many criminal neighbors as #NAME:9 has innocent ones');
    expect(r('equal_traits_in_unit_and_traits_in_unit(unit(row,1),innocent,unit(row,4),criminal)')).toBe(
      'There are as many innocents in row 1 as criminals in row 4',
    );
    expect(r('equal_traits_in_unit_and_traits_in_unit(unit(col,1),criminal,unit(col,3),innocent)')).toBe(
      'There are as many criminals in column #C:1 as innocents in column #C:3',
    );
    expect(
      r('equal_traits_in_unit_and_traits_in_unit(unit(profession,cook),innocent,unit(profession,cop),criminal)'),
    ).toBe('There are as many innocent #PROFS:cook as there are criminal #PROFS:cop');
  });
  it('has_most_traits', () => {
    expect(r('has_most_traits(unit(col,2),criminal)')).toBe(
      'Column #C:2 has more criminals than any other column',
    );
    expect(r('has_most_traits(unit(row,3),innocent)')).toBe(
      'Row 3 has more innocents than any other row',
    );
    expect(r('has_most_traits(unit(neighbor,7),innocent)')).toBe(
      '#NAME:7 has the most innocent neighbors',
    );
  });
  it('only_unit_has_exactly_n_traits', () => {
    expect(r('only_unit_has_exactly_n_traits(unit(row,2),innocent,3)')).toBe(
      'Row 2 is the only row with exactly 3 innocents',
    );
    expect(r('only_unit_has_exactly_n_traits(unit(col,4),criminal,1)')).toBe(
      'Column #C:4 is the only column with exactly one criminal',
    );
    // Ground truth (only_unit_has_exactly_n_traits, line 214) attests this neighbor-shaped
    // clue: "NAME is the only one with exactly N criminal neighbor" — singular "neighbor"
    // verbatim regardless of the count. The brief's step-1 test expected this shape to
    // throw UnsupportedShapeError; ground truth wins per task instructions.
    expect(r('only_unit_has_exactly_n_traits(unit(neighbor,4),criminal,2)')).toBe(
      '#NAME:4 is the only one with exactly 2 criminal neighbor',
    );
  });
  it('units_share_n_traits', () => {
    expect(r('units_share_n_traits(unit(neighbor,3),unit(neighbor,9),innocent,1)')).toBe(
      '#NAME:3 and #NAME:9 have only one innocent neighbor in common',
    );
    expect(r('units_share_n_traits(unit(neighbor,3),unit(neighbor,9),innocent,2)')).toBe(
      '#NAME:3 and #NAME:9 have 2 innocent neighbors in common',
    );
    // "have 0 criminal neighbors in common" is not English the source would write,
    // and every other zero-count branch of this predicate spells the zero as a word.
    expect(r('units_share_n_traits(unit(neighbor,3),unit(neighbor,9),criminal,0)')).toBe(
      '#NAME:3 and #NAME:9 have no criminal neighbors in common',
    );
    expect(r('units_share_n_traits(unit(between,pair(0,3)),unit(neighbor,9),innocent,1)')).toBe(
      'Exactly 1 innocent #BETWEEN:pair(0,3) is neighboring #NAME:9',
    );
    expect(r('units_share_n_traits(unit(between,pair(0,3)),unit(neighbor,9),innocent,2)')).toBe(
      'Exactly 2 innocents #BETWEEN:pair(0,3) are neighboring #NAME:9',
    );
    expect(r('units_share_n_traits(unit(between,pair(0,3)),unit(row,2),innocent,0)')).toBe(
      'No innocent #BETWEEN:pair(0,3) is in row 2',
    );
    // Ground truth (units_share_n_traits, line 60) attests a distinct zero-count phrasing for
    // a neighbor target: "There are no innocents BTW who neighbor NAME" — not the generic
    // "No X ... is neighboring NAME" the row/col branch above uses. Added beyond the brief's
    // step-1 test to cover this deviation.
    expect(r('units_share_n_traits(unit(between,pair(0,3)),unit(neighbor,9),innocent,0)')).toBe(
      'There are no innocents #BETWEEN:pair(0,3) who neighbor #NAME:9',
    );
    // Fix round 1, Finding 1: neighbor-unit-first paired with a non-neighbor unit has at
    // least 3 mutually incompatible real sentence shapes in the archive (see fix report) —
    // unrenderable from the hint AST alone, so it must throw rather than approximate.
    expect(() => r('units_share_n_traits(unit(neighbor,5),unit(row,2),innocent,1)')).toThrow(
      UnsupportedShapeError,
    );
  });
  it('units_share_odd_n_traits', () => {
    expect(r('units_share_odd_n_traits(unit(between,pair(0,3)),unit(neighbor,9),innocent)')).toBe(
      'An odd number of innocents #BETWEEN:pair(0,3) neighbor #NAME:9',
    );
    expect(r('units_share_odd_n_traits(unit(neighbor,9),unit(row,2),innocent)')).toBe(
      'An odd number of innocents in row 2 neighbor #NAME:9',
    );
    expect(() => r('units_share_odd_n_traits(unit(row,1),unit(row,2),innocent)')).toThrow(
      UnsupportedShapeError,
    );
  });
  it('unit_shares_n_out_of_n_traits_with_unit', () => {
    expect(
      r('unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,5),unit(between,pair(0,3)),criminal,1,3)'),
    ).toBe('Only 1 of the 3 criminals neighboring #NAME:5 is #BETWEEN:pair(0,3)');
    expect(
      r('unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,5),unit(neighbor,9),criminal,1,2)'),
    ).toBe('Only 1 of the 2 criminals neighboring #NAME:5 is #NAMES:9 neighbor');
    expect(
      r('unit_shares_n_out_of_n_traits_with_unit(unit(edge,void),unit(neighbor,9),criminal,2,5)'),
    ).toBe('Exactly 2 of the 5 criminals on the edges are #NAMES:9 neighbors');
    expect(
      r('unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,5),unit(row,3),criminal,2,4)'),
    ).toBe('Exactly 2 of the 4 criminals neighboring #NAME:5 are in row 3');
    // Fix round 1, Finding 2: neighbor+neighbor pair with n!==1 uses a distinct "also
    // neighbor" construction, derived from real archive data (puzzles/2026-07-12.json).
    expect(
      r(
        'unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,14),unit(neighbor,12),criminal,2,4)',
      ),
    ).toBe('Exactly 2 of #NAMES:14 4 criminal neighbors also neighbor #NAME:12');
  });
});

describe('adjacency and direction clue templates', () => {
  it('covers every predicate', () => {
    expect(Object.keys(RENDERERS).sort()).toEqual(Object.keys(ARG_KINDS).sort());
  });
  it('max_number_of_traits_in_neighbors_in_unit', () => {
    expect(r('max_number_of_traits_in_neighbors_in_unit(unit(row,2),innocent,3)')).toBe(
      'No one in row 2 has more than 3 innocent neighbors',
    );
    expect(r('max_number_of_traits_in_neighbors_in_unit(unit(corner,void),innocent,1)')).toBe(
      'No one in the corners has more than one innocent neighbor',
    );
  });
  it('both_traits_in_unit_are_in_unit', () => {
    expect(
      r('both_traits_in_unit_are_in_unit(unit(between,pair(0,3)),unit(neighbor,9),criminal)'),
    ).toBe('Both criminals #BETWEEN:pair(0,3) are #NAMES:9 neighbors');
    expect(
      r('both_traits_in_unit_are_in_unit(unit(neighbor,5),unit(neighbor,9),innocent)'),
    ).toBe('Both innocents neighboring #NAME:5 are #NAMES:9 neighbors');
  });
  it('only_trait_in_unit_is_in_unit', () => {
    expect(r('only_trait_in_unit_is_in_unit(unit(row,2),unit(neighbor,9),criminal)')).toBe(
      'The only criminal in row 2 is #NAMES:9 neighbor',
    );
    expect(
      r('only_trait_in_unit_is_in_unit(unit(between,pair(0,3)),unit(between,pair(4,7)),criminal)'),
    ).toBe('The only criminal #BETWEEN:pair(0,3) is #BETWEEN:pair(4,7)');
  });
  it('both_traits_are_neighbors_in_unit and all_traits_are_neighbors_in_unit', () => {
    expect(r('both_traits_are_neighbors_in_unit(unit(between,pair(0,3)),innocent)')).toBe(
      'Both innocents #BETWEEN:pair(0,3) are connected',
    );
    expect(r('all_traits_are_neighbors_in_unit(unit(between,pair(0,3)),criminal)')).toBe(
      'All criminals #BETWEEN:pair(0,3) are connected',
    );
  });
  it('only_one_person_in_unit_has_exactly_n_trait_neighbors', () => {
    expect(r('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(row,2),innocent,3)')).toBe(
      'Only one person in row 2 has exactly 3 innocent neighbors',
    );
    expect(
      r('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(corner,void),criminal,0)'),
    ).toBe('Only one person in a corner has no criminal neighbors');
    expect(
      r('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(profession,mech),criminal,2)'),
    ).toBe('Only one #PROF:mech has exactly 2 criminal neighbors');
  });
  it('n_in_unit_have_trait_in_dir', () => {
    expect(r('n_in_unit_have_trait_in_dir(unit(profession,cook),criminal,1,0,1)')).toBe(
      'Only one #PROF:cook has a criminal directly to the right of them',
    );
    expect(r('n_in_unit_have_trait_in_dir(unit(corner,void),criminal,0,1,2)')).toBe(
      '2 persons in a corner have a criminal directly below them',
    );
    expect(r('n_in_unit_have_trait_in_dir(unit(edge,void),criminal,0,-1,3)')).toBe(
      '3 persons on the edges have a criminal directly above them',
    );
    expect(r('n_in_unit_have_trait_in_dir(unit(profession,builder),innocent,0,-1,2)')).toBe(
      '2 #PROFS:builder have an innocent directly above them',
    );
  });
  it('n_t_in_unit_have_trait_in_dir', () => {
    expect(r('n_t_in_unit_have_trait_in_dir(unit(row,2),criminal,criminal,0,1,2)')).toBe(
      'Exactly 2 criminals in row 2 have a criminal directly below them',
    );
    // Ground truth (docs/superpowers/specs/2026-08-29-clue-templates.txt,
    // n_t_in_unit_have_trait_in_dir section) anonymizes numbers, but cross-referencing real
    // archive occurrences shows 3 of 4 n=1 cases use "Only one X in UNIT has ..."
    // (puzzles/2026-08-02.json col case, puzzles/2026-08-20.json and puzzles/2026-08-27.json
    // row/col cases) while only 1 of 4 (puzzles/2026-07-21.json, the exact args used here)
    // drops "Only". The brief's step-1 test expected the bare "One criminal ..." form (the
    // minority variant); ground truth's dominant phrasing — also the convention used
    // everywhere else in this file for n=1 subjects — wins per task instructions.
    expect(r('n_t_in_unit_have_trait_in_dir(unit(row,2),criminal,innocent,1,0,1)')).toBe(
      'Only one criminal in row 2 has an innocent directly to the right of them',
    );
  });
  it('n_professions_have_trait_in_dir', () => {
    expect(r('n_professions_have_trait_in_dir(painter,innocent,1,0,2)')).toBe(
      '2 #PROFS:painter have an innocent directly to the right of them',
    );
    expect(r('n_professions_have_trait_in_dir(cook,innocent,-1,0,1)')).toBe(
      'Exactly 1 #PROF:cook has an innocent directly to the left of them',
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
