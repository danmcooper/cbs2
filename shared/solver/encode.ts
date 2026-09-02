/**
 * Clues to CNF.
 *
 * Every predicate in `predicates.ts` is a Boolean function of the criminal
 * assignment alone — units, professions and geometry are all fixed before a
 * single card is decided, which is exactly why `unitMembers` can memoise. So
 * each clue becomes a constraint over one Boolean per card, and the board stops
 * being the thing that sets the cost.
 *
 * Twenty-nine predicates, but not twenty-nine encodings: measured over the 685
 * clues in the real archive they fall into six shapes. A count over one fixed
 * set of cards is 39% of them, two counts compared is 14%, a count with a
 * literal attached 11%, two counts conjoined 12%, a reified count fed into a
 * second count 13%, and the small structural clues the remaining 9%. A
 * totalizer, a parity chain and Tseitin reification carry all but the last.
 */
import { type Known, type Shape } from './enumerate';
import {
  atLeast,
  atMost,
  counter,
  eqCount,
  exactly,
  gtCount,
  parityOdd,
  reifyExactly,
} from './cardinality';
import { isConnected, neighbors, offsetIndex } from './grid';
import type { Hint, HintArg, Trait, Unit, UnitKind } from './hint';
import { type Board, makeBoard, unitMembers, unitsOfKind } from './predicates';
import { Cnf } from './sat';

export class UnsupportedPredicateError extends Error {}

/**
 * Structural clues are encoded by walking their unit's own subsets, which is
 * exponential in the unit and so needs a ceiling. In the real archive the
 * largest unit any of them lands on is eight cards, and rows and columns of a
 * 5x6 board are five and six; the ceiling exists for the units that are not
 * shaped like that — a 5x6 board's edge is eighteen cards — so that an
 * unencodable clue is refused rather than silently mis-encoded.
 */
export const MAX_ENUMERATED_UNIT = 16;

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
  'unit_shares_n_out_of_n_traits_with_unit',
  'n_in_unit_have_trait_in_dir',
  'n_t_in_unit_have_trait_in_dir',
  'n_professions_have_trait_in_dir',
  'more_traits_in_unit_than_unit',
  'equal_number_of_traits_in_units',
  'more_traits_than_traits_in_unit',
  'equal_traits_and_traits_in_unit',
  'more_traits_in_unit_than_traits_in_unit',
  'equal_traits_in_unit_and_traits_in_unit',
  'all_units_have_at_least_n_traits',
  'only_one_unit_has_exactly_n_traits',
  'only_unit_has_exactly_n_traits',
  'has_most_traits',
  'max_number_of_traits_in_neighbors_in_unit',
  'only_one_person_in_unit_has_exactly_n_trait_neighbors',
  'both_traits_in_unit_are_in_unit',
  'only_trait_in_unit_is_in_unit',
  'both_traits_are_neighbors_in_unit',
  'all_traits_are_neighbors_in_unit',
]);

export function supports(hint: Hint): boolean {
  return SUPPORTED.has(hint.pred);
}

function argUnit(a: HintArg[], k: number): Unit {
  const x = a[k];
  if (x.t !== 'unit') throw new UnsupportedPredicateError(`arg ${k} is not a unit`);
  return x.unit;
}
function argKind(a: HintArg[], k: number): UnitKind {
  const x = a[k];
  if (x.t !== 'kind') throw new UnsupportedPredicateError(`arg ${k} is not a kind`);
  return x.kind;
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

const sameUnit = (a: Unit, b: Unit): boolean => JSON.stringify(a) === JSON.stringify(b);

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
  const grid = shape.grid;
  // An innocent card is the same variable read the other way up, so a trait is a
  // choice of polarity rather than a second set of variables.
  const lit = (i: number, t: Trait) => (t === 'criminal' ? vars[i] : -vars[i]);
  const litsOf = (members: number[], t: Trait) => members.map((i) => lit(i, t));
  const members = (u: Unit) => unitMembers(board, u);
  const countOf = (u: Unit, t: Trait) => counter(cnf, litsOf(members(u), t));

  /** The cards `dx,dy` away from `from`, dropping those that fall off the grid. */
  const shifted = (from: number[], dx: number, dy: number) =>
    from.map((i) => offsetIndex(grid, i, dx, dy)).filter((j): j is number => j !== null);

  /** `flag` is true exactly when both literals are. */
  const reifyAnd = (flag: number, x: number, y: number) => {
    cnf.add([-flag, x]);
    cnf.add([-flag, y]);
    cnf.add([flag, -x, -y]);
  };

  switch (hint.pred) {
    // ---- a count over one fixed set of cards ----
    case 'has_trait':
      cnf.addUnit(lit(argIndex(a, 0), argTrait(a, 1)));
      return;

    case 'number_of_traits':
      exactly(cnf, litsOf([...Array(grid.size).keys()], argTrait(a, 0)), argNum(a, 1));
      return;

    case 'number_of_traits_in_unit':
      exactly(cnf, litsOf(members(argUnit(a, 0)), argTrait(a, 1)), argNum(a, 2));
      return;

    case 'min_number_of_traits_in_unit':
      atLeast(cnf, litsOf(members(argUnit(a, 0)), argTrait(a, 1)), argNum(a, 2));
      return;

    case 'odd_number_of_traits_in_unit':
      parityOdd(cnf, litsOf(members(argUnit(a, 0)), argTrait(a, 1)));
      return;

    // ---- a count with a literal attached ----
    case 'is_one_of_n_traits_in_unit':
    case 'is_not_only_trait_in_unit': {
      const mem = members(argUnit(a, 0));
      const i = argIndex(a, 1);
      const t = argTrait(a, 2);
      // Membership is fixed by the grid, so a clue naming a card outside its own
      // unit is false outright rather than false for some assignments.
      if (!mem.includes(i)) {
        cnf.add([]);
        return;
      }
      cnf.addUnit(lit(i, t));
      if (hint.pred === 'is_one_of_n_traits_in_unit') exactly(cnf, litsOf(mem, t), argNum(a, 3));
      else atLeast(cnf, litsOf(mem, t), 2);
      return;
    }

    // ---- counts over the overlap of two units ----
    case 'units_share_n_traits':
    case 'units_share_odd_n_traits': {
      const first = new Set(members(argUnit(a, 0)));
      const both = members(argUnit(a, 1)).filter((i) => first.has(i));
      const t = argTrait(a, 2);
      if (hint.pred === 'units_share_n_traits') exactly(cnf, litsOf(both, t), argNum(a, 3));
      else parityOdd(cnf, litsOf(both, t));
      return;
    }

    case 'unit_shares_n_out_of_n_traits_with_unit': {
      const mine = members(argUnit(a, 0));
      const first = new Set(mine);
      const both = members(argUnit(a, 1)).filter((i) => first.has(i));
      const t = argTrait(a, 2);
      exactly(cnf, litsOf(mine, t), argNum(a, 4));
      exactly(cnf, litsOf(both, t), argNum(a, 3));
      return;
    }

    // ---- counts over a direction offset ----
    case 'n_in_unit_have_trait_in_dir':
      exactly(
        cnf,
        litsOf(shifted(members(argUnit(a, 0)), argNum(a, 2), argNum(a, 3)), argTrait(a, 1)),
        argNum(a, 4),
      );
      return;

    case 'n_professions_have_trait_in_dir':
      exactly(
        cnf,
        litsOf(
          shifted(
            members({ kind: 'profession', name: argProfession(a, 0) }),
            argNum(a, 2),
            argNum(a, 3),
          ),
          argTrait(a, 1),
        ),
        argNum(a, 4),
      );
      return;

    case 'n_t_in_unit_have_trait_in_dir': {
      // The set being counted is itself assignment-dependent: the cards in the
      // unit that carry the first trait *and* whose neighbour in the direction
      // carries the second. So each card gets a flag for the conjunction, and
      // the count runs over the flags.
      const t1 = argTrait(a, 1);
      const t2 = argTrait(a, 2);
      const dx = argNum(a, 3);
      const dy = argNum(a, 4);
      const flags: number[] = [];
      for (const i of members(argUnit(a, 0))) {
        const j = offsetIndex(grid, i, dx, dy);
        if (j === null) continue; // falls off the grid, so it can never count
        const flag = cnf.newVar();
        reifyAnd(flag, lit(i, t1), lit(j, t2));
        flags.push(flag);
      }
      exactly(cnf, flags, argNum(a, 5));
      return;
    }

    // ---- two counts compared ----
    case 'more_traits_in_unit_than_unit':
      gtCount(cnf, countOf(argUnit(a, 0), argTrait(a, 2)), countOf(argUnit(a, 1), argTrait(a, 2)));
      return;

    case 'equal_number_of_traits_in_units':
      eqCount(cnf, countOf(argUnit(a, 0), argTrait(a, 2)), countOf(argUnit(a, 1), argTrait(a, 2)));
      return;

    case 'more_traits_than_traits_in_unit':
      gtCount(cnf, countOf(argUnit(a, 0), argTrait(a, 1)), countOf(argUnit(a, 0), argTrait(a, 2)));
      return;

    case 'equal_traits_and_traits_in_unit':
      eqCount(cnf, countOf(argUnit(a, 0), argTrait(a, 1)), countOf(argUnit(a, 0), argTrait(a, 2)));
      return;

    case 'more_traits_in_unit_than_traits_in_unit':
      gtCount(cnf, countOf(argUnit(a, 0), argTrait(a, 1)), countOf(argUnit(a, 2), argTrait(a, 3)));
      return;

    case 'equal_traits_in_unit_and_traits_in_unit':
      eqCount(cnf, countOf(argUnit(a, 0), argTrait(a, 1)), countOf(argUnit(a, 2), argTrait(a, 3)));
      return;

    // ---- a count quantified over every unit of a kind ----
    case 'all_units_have_at_least_n_traits': {
      const t = argTrait(a, 1);
      const n = argNum(a, 2);
      for (const u of unitsOfKind(board, argKind(a, 0))) atLeast(cnf, litsOf(members(u), t), n);
      return;
    }

    case 'only_one_unit_has_exactly_n_traits': {
      const t = argTrait(a, 1);
      const n = argNum(a, 2);
      const flags = unitsOfKind(board, argKind(a, 0)).map((u) => {
        const flag = cnf.newVar();
        reifyExactly(cnf, litsOf(members(u), t), n, flag);
        return flag;
      });
      exactly(cnf, flags, 1);
      return;
    }

    case 'only_unit_has_exactly_n_traits': {
      const u = argUnit(a, 0);
      const t = argTrait(a, 1);
      const n = argNum(a, 2);
      exactly(cnf, litsOf(members(u), t), n);
      for (const other of unitsOfKind(board, u.kind)) {
        if (sameUnit(other, u)) continue;
        const flag = cnf.newVar();
        reifyExactly(cnf, litsOf(members(other), t), n, flag);
        cnf.addUnit(-flag); // no other unit of this kind may match
      }
      return;
    }

    case 'has_most_traits': {
      const u = argUnit(a, 0);
      const t = argTrait(a, 1);
      const mine = countOf(u, t);
      for (const other of unitsOfKind(board, u.kind)) {
        if (sameUnit(other, u)) continue;
        gtCount(cnf, mine, countOf(other, t));
      }
      return;
    }

    // ---- counts over each card's neighbourhood ----
    case 'max_number_of_traits_in_neighbors_in_unit': {
      const t = argTrait(a, 1);
      const n = argNum(a, 2);
      for (const i of members(argUnit(a, 0))) atMost(cnf, litsOf(neighbors(grid, i), t), n);
      return;
    }

    case 'only_one_person_in_unit_has_exactly_n_trait_neighbors': {
      const t = argTrait(a, 1);
      const n = argNum(a, 2);
      const flags = members(argUnit(a, 0)).map((i) => {
        const flag = cnf.newVar();
        reifyExactly(cnf, litsOf(neighbors(grid, i), t), n, flag);
        return flag;
      });
      exactly(cnf, flags, 1);
      return;
    }

    // ---- structural clues about where a unit's carriers sit ----
    case 'both_traits_in_unit_are_in_unit':
    case 'only_trait_in_unit_is_in_unit': {
      const mine = members(argUnit(a, 0));
      const other = new Set(members(argUnit(a, 1)));
      const t = argTrait(a, 2);
      exactly(cnf, litsOf(mine, t), hint.pred === 'both_traits_in_unit_are_in_unit' ? 2 : 1);
      // Whichever cards carry the trait must be the ones inside the second unit,
      // which is the same as saying none outside it may carry it.
      for (const i of mine) if (!other.has(i)) cnf.addUnit(-lit(i, t));
      return;
    }

    case 'both_traits_are_neighbors_in_unit': {
      const mem = members(argUnit(a, 0));
      const t = argTrait(a, 1);
      exactly(cnf, litsOf(mem, t), 2);
      // Exactly two carry it, so forbidding every non-adjacent pair leaves only
      // adjacent pairs standing.
      for (let x = 0; x < mem.length; x++) {
        for (let y = x + 1; y < mem.length; y++) {
          if (neighbors(grid, mem[x]).includes(mem[y])) continue;
          cnf.add([-lit(mem[x], t), -lit(mem[y], t)]);
        }
      }
      return;
    }

    case 'all_traits_are_neighbors_in_unit': {
      // Connectivity of a set that is itself being decided. There is no compact
      // clause form for it, but the unit is small — the largest any structural
      // clue lands on in the archive is eight cards — so walk its subsets and
      // forbid each disconnected one outright.
      const mem = members(argUnit(a, 0));
      const t = argTrait(a, 1);
      if (mem.length > MAX_ENUMERATED_UNIT) {
        throw new UnsupportedPredicateError(
          `${hint.pred} over ${mem.length} cards exceeds the ${MAX_ENUMERATED_UNIT}-card ceiling`,
        );
      }
      for (let subset = 0; subset < 1 << mem.length; subset++) {
        const chosen = mem.filter((_, k) => (subset >> k) & 1);
        if (isConnected(grid, chosen)) continue;
        cnf.add(mem.map((i, k) => ((subset >> k) & 1 ? -lit(i, t) : lit(i, t))));
      }
      return;
    }
  }
  throw new UnsupportedPredicateError(hint.pred);
}
