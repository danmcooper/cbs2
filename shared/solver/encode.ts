/**
 * Clues to CNF.
 *
 * Every predicate in `predicates.ts` is a Boolean function of the criminal
 * assignment alone — units, professions and geometry are all fixed before a
 * single card is decided, which is exactly why `unitMembers` can memoise. So
 * each clue becomes a constraint over one Boolean per card, and the board stops
 * being the thing that sets the cost.
 *
 * This covers the counting half of the predicate set: a count over one fixed
 * set of cards, optionally with a literal attached. Measured over the 685 clues
 * in the real archive that is a little over half of them, which is enough to
 * settle whether the approach is sound and fast before the rest is written. The
 * families still to do are the two-count comparisons, the reified
 * `only_one_*` group, and the small-unit structural clues.
 */
import { type Known, type Shape } from './enumerate';
import { atLeast, exactly, parityOdd } from './cardinality';
import { offsetIndex } from './grid';
import type { Hint, HintArg, Trait, Unit } from './hint';
import { type Board, makeBoard, unitMembers } from './predicates';
import { Cnf } from './sat';

export class UnsupportedPredicateError extends Error {}

/** The predicates this encoder handles. Anything else throws rather than lies. */
export const SUPPORTED: ReadonlySet<string> = new Set([
  'has_trait',
  'number_of_traits',
  'number_of_traits_in_unit',
  'min_number_of_traits_in_unit',
  'odd_number_of_traits_in_unit',
  'is_one_of_n_traits_in_unit',
  'is_not_only_trait_in_unit',
  'units_share_n_traits',
  'units_share_odd_n_traits',
  'n_in_unit_have_trait_in_dir',
  'n_professions_have_trait_in_dir',
]);

export function supports(hint: Hint): boolean {
  return SUPPORTED.has(hint.pred);
}

function argUnit(a: HintArg[], k: number): Unit {
  const x = a[k];
  if (x.t !== 'unit') throw new UnsupportedPredicateError(`arg ${k} is not a unit`);
  return x.unit;
}
function argTrait(a: HintArg[], k: number): Trait {
  const x = a[k];
  if (x.t !== 'trait') throw new UnsupportedPredicateError(`arg ${k} is not a trait`);
  return x.trait;
}
function argNum(a: HintArg[], k: number): number {
  const x = a[k];
  if (x.t !== 'num') throw new UnsupportedPredicateError(`arg ${k} is not a number`);
  return x.n;
}
function argIndex(a: HintArg[], k: number): number {
  const x = a[k];
  if (x.t !== 'index') throw new UnsupportedPredicateError(`arg ${k} is not an index`);
  return x.i;
}
function argProfession(a: HintArg[], k: number): string {
  const x = a[k];
  if (x.t !== 'profession') throw new UnsupportedPredicateError(`arg ${k} is not a profession`);
  return x.name;
}

export interface Encoded {
  cnf: Cnf;
  /** `vars[i]` is true exactly when card `i` is criminal. */
  vars: number[];
}

export function encode(shape: Shape, hints: Hint[], known: Known): Encoded {
  const cnf = new Cnf();
  const size = shape.grid.size;
  const vars = Array.from({ length: size }, () => cnf.newVar());
  const board = makeBoard(shape.grid, shape.professions, new Array(size).fill(false));

  for (let i = 0; i < size; i++) {
    if (known[i] === true) cnf.addUnit(vars[i]);
    else if (known[i] === false) cnf.addUnit(-vars[i]);
  }
  for (const hint of hints) encodeHint(cnf, board, shape, vars, hint);
  return { cnf, vars };
}

function encodeHint(cnf: Cnf, board: Board, shape: Shape, vars: number[], hint: Hint): void {
  const a = hint.args;
  // An innocent card is the same variable read the other way up, so a trait is a
  // choice of polarity rather than a second set of variables.
  const lit = (i: number, t: Trait) => (t === 'criminal' ? vars[i] : -vars[i]);
  const litsOf = (members: number[], t: Trait) => members.map((i) => lit(i, t));

  /** The cards `dx,dy` away from `members`, dropping those that fall off. */
  const shifted = (members: number[], dx: number, dy: number) =>
    members
      .map((i) => offsetIndex(shape.grid, i, dx, dy))
      .filter((j): j is number => j !== null);

  switch (hint.pred) {
    case 'has_trait':
      cnf.addUnit(lit(argIndex(a, 0), argTrait(a, 1)));
      return;

    case 'number_of_traits': {
      const all = [...Array(shape.grid.size).keys()];
      exactly(cnf, litsOf(all, argTrait(a, 0)), argNum(a, 1));
      return;
    }

    case 'number_of_traits_in_unit':
      exactly(cnf, litsOf(unitMembers(board, argUnit(a, 0)), argTrait(a, 1)), argNum(a, 2));
      return;

    case 'min_number_of_traits_in_unit':
      atLeast(cnf, litsOf(unitMembers(board, argUnit(a, 0)), argTrait(a, 1)), argNum(a, 2));
      return;

    case 'odd_number_of_traits_in_unit':
      parityOdd(cnf, litsOf(unitMembers(board, argUnit(a, 0)), argTrait(a, 1)));
      return;

    case 'is_one_of_n_traits_in_unit': {
      const members = unitMembers(board, argUnit(a, 0));
      const i = argIndex(a, 1);
      const t = argTrait(a, 2);
      // Membership is fixed by the grid, so a clue naming a card outside its own
      // unit is false outright rather than false for some assignments.
      if (!members.includes(i)) {
        cnf.add([]);
        return;
      }
      cnf.addUnit(lit(i, t));
      exactly(cnf, litsOf(members, t), argNum(a, 3));
      return;
    }

    case 'is_not_only_trait_in_unit': {
      const members = unitMembers(board, argUnit(a, 0));
      const i = argIndex(a, 1);
      const t = argTrait(a, 2);
      if (!members.includes(i)) {
        cnf.add([]);
        return;
      }
      cnf.addUnit(lit(i, t));
      atLeast(cnf, litsOf(members, t), 2);
      return;
    }

    case 'units_share_n_traits':
    case 'units_share_odd_n_traits': {
      const first = new Set(unitMembers(board, argUnit(a, 0)));
      const both = unitMembers(board, argUnit(a, 1)).filter((i) => first.has(i));
      const t = argTrait(a, 2);
      if (hint.pred === 'units_share_n_traits') exactly(cnf, litsOf(both, t), argNum(a, 3));
      else parityOdd(cnf, litsOf(both, t));
      return;
    }

    case 'n_in_unit_have_trait_in_dir': {
      const members = unitMembers(board, argUnit(a, 0));
      const targets = shifted(members, argNum(a, 2), argNum(a, 3));
      exactly(cnf, litsOf(targets, argTrait(a, 1)), argNum(a, 4));
      return;
    }

    case 'n_professions_have_trait_in_dir': {
      const members = unitMembers(board, { kind: 'profession', name: argProfession(a, 0) });
      const targets = shifted(members, argNum(a, 2), argNum(a, 3));
      exactly(cnf, litsOf(targets, argTrait(a, 1)), argNum(a, 4));
      return;
    }
  }
  throw new UnsupportedPredicateError(hint.pred);
}
