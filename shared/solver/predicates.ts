import {
  type Grid,
  colMembers,
  cornerMembers,
  edgeMembers,
  isConnected,
  neighbors,
  offsetIndex,
  rowMembers,
  segment,
} from './grid';
import type { Hint, HintArg, Trait, Unit, UnitKind } from './hint';

export interface Board {
  grid: Grid;
  professions: string[];
  criminal: boolean[];
  /** Memoises unit membership; safe because membership depends only on grid and
   * professions, never on `criminal`. */
  cache?: Map<string, number[]>;
}

export class UnknownPredicateError extends Error {}

function computeUnitMembers(b: Board, u: Unit): number[] {
  switch (u.kind) {
    case 'row':
      return rowMembers(b.grid, u.n);
    case 'col':
      return colMembers(b.grid, u.n);
    case 'neighbor':
      return neighbors(b.grid, u.i);
    case 'between':
      return segment(b.grid, u.a, u.b);
    case 'profession':
      return b.professions.flatMap((p, i) => (p === u.name ? [i] : []));
    case 'edge':
      return edgeMembers(b.grid);
    case 'corner':
      return cornerMembers(b.grid);
  }
}

export function makeBoard(grid: Grid, professions: string[], criminal: boolean[]): Board {
  return { grid, professions, criminal, cache: new Map() };
}

export function unitMembers(b: Board, u: Unit): number[] {
  if (!b.cache) return computeUnitMembers(b, u);
  const key = JSON.stringify(u);
  let members = b.cache.get(key);
  if (!members) {
    members = computeUnitMembers(b, u);
    b.cache.set(key, members);
  }
  return members;
}

export function unitsOfKind(b: Board, kind: UnitKind): Unit[] {
  switch (kind) {
    case 'row':
      return Array.from({ length: b.grid.height }, (_, k) => ({ kind: 'row', n: k + 1 }));
    case 'col':
      return Array.from({ length: b.grid.width }, (_, k) => ({ kind: 'col', n: k + 1 }));
    case 'neighbor':
      return Array.from({ length: b.grid.size }, (_, i) => ({ kind: 'neighbor', i }));
    case 'between':
      return [];
    case 'profession':
      return [...new Set(b.professions)].sort().map((name) => ({ kind: 'profession', name }));
    case 'edge':
      return [{ kind: 'edge' }];
    case 'corner':
      return [{ kind: 'corner' }];
  }
}

export function hasTrait(b: Board, i: number, t: Trait): boolean {
  return t === 'criminal' ? b.criminal[i] : !b.criminal[i];
}

export function countTrait(b: Board, members: number[], t: Trait): number {
  let n = 0;
  for (const i of members) if (hasTrait(b, i, t)) n++;
  return n;
}

/**
 * The traits of a hint that generation matches against the archive: which unit
 * kinds it names, and which direction it looks in. Measured over the archive by
 * `archiveClueMix` and over the candidate pool by `orderPool`, which is why it
 * lives here rather than in either of them.
 *
 * A `between` unit carries its span length, because kind alone is too coarse to
 * describe it. Generation was already drawing `between` clues at the archive's
 * rate but drawing the wrong ones: two-card segments (a pair of adjacent cards,
 * the least a between clue can say) were 38% of ours against the archive's 13%,
 * while the archive puts 47% on four-card spans and 34% on whole rows or
 * columns. Splitting the key by length makes each length its own thing to match.
 *
 * Direction is a feature for the same reason at a smaller scale: the four
 * directions are near-even in the archive (8/14/16/11) and leaned left-and-up in
 * ours (28/23/15/14). The `_in_dir` families all take their dx, dy as the first
 * two numeric arguments, whatever else they carry.
 */
export function hintFeatures(b: Board, hint: Hint): string[] {
  const out: string[] = [];
  for (const arg of hint.args) {
    if (arg.t !== 'unit') continue;
    out.push(
      arg.unit.kind === 'between'
        ? `unit:between:${unitMembers(b, arg.unit).length}`
        : `unit:${arg.unit.kind}`,
    );
  }
  if (hint.pred.endsWith('_in_dir')) {
    const nums = hint.args.filter((a) => a.t === 'num');
    out.push(`dir:${argNum(nums, 0)},${argNum(nums, 1)}`);
  }
  // How far a clue's two units overlap decides whether the second one is doing
  // any work. At an overlap of one card, "only 1 of the 3 criminals neighbouring
  // Jonas is in row 2" says no more than "that one shared card is criminal" —
  // the row is scaffolding, and a player who has already resolved it learns
  // nothing from the mention. The archive centres on overlaps of two or three
  // and holds one-card overlaps to 14%; the pool is mostly near-disjoint pairs,
  // so without this the generator ran at nearly three times that. Bucketed at 4
  // because beyond that the distinction stops mattering and the counts thin out.
  const units = hint.args.filter((a) => a.t === 'unit');
  if (units.length === 2 && units[0].t === 'unit' && units[1].t === 'unit') {
    const first = new Set(unitMembers(b, units[0].unit));
    const shared = unitMembers(b, units[1].unit).filter((i) => first.has(i)).length;
    out.push(`overlap:${Math.min(shared, 4)}`);
  }
  return out;
}

function argUnit(a: HintArg[], k: number): Unit {
  const x = a[k];
  if (x.t !== 'unit') throw new UnknownPredicateError(`arg ${k} is not a unit`);
  return x.unit;
}
function argKind(a: HintArg[], k: number): UnitKind {
  const x = a[k];
  if (x.t !== 'kind') throw new UnknownPredicateError(`arg ${k} is not a kind`);
  return x.kind;
}
function argTrait(a: HintArg[], k: number): Trait {
  const x = a[k];
  if (x.t !== 'trait') throw new UnknownPredicateError(`arg ${k} is not a trait`);
  return x.trait;
}
function argNum(a: HintArg[], k: number): number {
  const x = a[k];
  if (x.t !== 'num') throw new UnknownPredicateError(`arg ${k} is not a number`);
  return x.n;
}
function argIndex(a: HintArg[], k: number): number {
  const x = a[k];
  if (x.t !== 'index') throw new UnknownPredicateError(`arg ${k} is not an index`);
  return x.i;
}
function argProfession(a: HintArg[], k: number): string {
  const x = a[k];
  if (x.t !== 'profession') throw new UnknownPredicateError(`arg ${k} is not a profession`);
  return x.name;
}

/** count of `t` in unit at arg position k */
function cnt(b: Board, a: HintArg[], k: number, t: Trait): number {
  return countTrait(b, unitMembers(b, argUnit(a, k)), t);
}

function sameUnit(a: Unit, b: Unit): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shared(b: Board, a: HintArg[], t: Trait): number {
  const first = new Set(unitMembers(b, argUnit(a, 0)));
  return unitMembers(b, argUnit(a, 1)).filter((i) => first.has(i) && hasTrait(b, i, t)).length;
}

function traitNeighborCount(b: Board, i: number, t: Trait): number {
  return countTrait(b, neighbors(b.grid, i), t);
}

function inDirCount(b: Board, members: number[], t: Trait, dx: number, dy: number): number {
  let n = 0;
  for (const i of members) {
    const j = offsetIndex(b.grid, i, dx, dy);
    if (j !== null && hasTrait(b, j, t)) n++;
  }
  return n;
}

function traitMembers(b: Board, u: Unit, t: Trait): number[] {
  return unitMembers(b, u).filter((i) => hasTrait(b, i, t));
}

export const EVALUATORS: Record<string, (b: Board, a: HintArg[]) => boolean> = {
  has_trait: (b, a) => hasTrait(b, argIndex(a, 0), argTrait(a, 1)),

  number_of_traits: (b, a) =>
    countTrait(b, [...b.criminal.keys()], argTrait(a, 0)) === argNum(a, 1),

  number_of_traits_in_unit: (b, a) => cnt(b, a, 0, argTrait(a, 1)) === argNum(a, 2),

  min_number_of_traits_in_unit: (b, a) => cnt(b, a, 0, argTrait(a, 1)) >= argNum(a, 2),

  odd_number_of_traits_in_unit: (b, a) => cnt(b, a, 0, argTrait(a, 1)) % 2 === 1,

  is_one_of_n_traits_in_unit: (b, a) => {
    const members = unitMembers(b, argUnit(a, 0));
    const i = argIndex(a, 1);
    const t = argTrait(a, 2);
    return members.includes(i) && hasTrait(b, i, t) && countTrait(b, members, t) === argNum(a, 3);
  },

  is_not_only_trait_in_unit: (b, a) => {
    const members = unitMembers(b, argUnit(a, 0));
    const i = argIndex(a, 1);
    const t = argTrait(a, 2);
    return members.includes(i) && hasTrait(b, i, t) && countTrait(b, members, t) >= 2;
  },

  all_units_have_at_least_n_traits: (b, a) => {
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    return unitsOfKind(b, argKind(a, 0)).every((u) => countTrait(b, unitMembers(b, u), t) >= n);
  },

  only_one_unit_has_exactly_n_traits: (b, a) => {
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    const units = unitsOfKind(b, argKind(a, 0));
    return units.filter((u) => countTrait(b, unitMembers(b, u), t) === n).length === 1;
  },

  more_traits_in_unit_than_unit: (b, a) => {
    const t = argTrait(a, 2);
    return cnt(b, a, 0, t) > cnt(b, a, 1, t);
  },

  equal_number_of_traits_in_units: (b, a) => {
    const t = argTrait(a, 2);
    return cnt(b, a, 0, t) === cnt(b, a, 1, t);
  },

  more_traits_than_traits_in_unit: (b, a) => {
    const members = unitMembers(b, argUnit(a, 0));
    return countTrait(b, members, argTrait(a, 1)) > countTrait(b, members, argTrait(a, 2));
  },

  equal_traits_and_traits_in_unit: (b, a) => {
    const members = unitMembers(b, argUnit(a, 0));
    return countTrait(b, members, argTrait(a, 1)) === countTrait(b, members, argTrait(a, 2));
  },

  // The two above each hold one thing fixed: same trait across two units, or two
  // traits inside one unit. These vary both. The source never phrases a clue this
  // way, which is a fact about the source rather than about the game — "there are
  // as many innocent cooks as criminal cops" is an ordinary deduction, and holding
  // it back leaves the generator repeating the eight shapes it does have.
  more_traits_in_unit_than_traits_in_unit: (b, a) =>
    countTrait(b, unitMembers(b, argUnit(a, 0)), argTrait(a, 1)) >
    countTrait(b, unitMembers(b, argUnit(a, 2)), argTrait(a, 3)),

  equal_traits_in_unit_and_traits_in_unit: (b, a) =>
    countTrait(b, unitMembers(b, argUnit(a, 0)), argTrait(a, 1)) ===
    countTrait(b, unitMembers(b, argUnit(a, 2)), argTrait(a, 3)),

  has_most_traits: (b, a) => {
    const u = argUnit(a, 0);
    const t = argTrait(a, 1);
    const mine = countTrait(b, unitMembers(b, u), t);
    return unitsOfKind(b, u.kind).every(
      (other) => sameUnit(other, u) || countTrait(b, unitMembers(b, other), t) < mine,
    );
  },

  only_unit_has_exactly_n_traits: (b, a) => {
    const u = argUnit(a, 0);
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    if (countTrait(b, unitMembers(b, u), t) !== n) return false;
    return unitsOfKind(b, u.kind).every(
      (other) => sameUnit(other, u) || countTrait(b, unitMembers(b, other), t) !== n,
    );
  },

  units_share_n_traits: (b, a) => shared(b, a, argTrait(a, 2)) === argNum(a, 3),

  units_share_odd_n_traits: (b, a) => shared(b, a, argTrait(a, 2)) % 2 === 1,

  unit_shares_n_out_of_n_traits_with_unit: (b, a) => {
    const t = argTrait(a, 2);
    return cnt(b, a, 0, t) === argNum(a, 4) && shared(b, a, t) === argNum(a, 3);
  },

  max_number_of_traits_in_neighbors_in_unit: (b, a) => {
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    return unitMembers(b, argUnit(a, 0)).every((i) => traitNeighborCount(b, i, t) <= n);
  },

  both_traits_in_unit_are_in_unit: (b, a) => {
    const t = argTrait(a, 2);
    const mine = traitMembers(b, argUnit(a, 0), t);
    const other = new Set(unitMembers(b, argUnit(a, 1)));
    return mine.length === 2 && mine.every((i) => other.has(i));
  },

  only_trait_in_unit_is_in_unit: (b, a) => {
    const t = argTrait(a, 2);
    const mine = traitMembers(b, argUnit(a, 0), t);
    const other = new Set(unitMembers(b, argUnit(a, 1)));
    return mine.length === 1 && other.has(mine[0]);
  },

  both_traits_are_neighbors_in_unit: (b, a) => {
    const mine = traitMembers(b, argUnit(a, 0), argTrait(a, 1));
    return mine.length === 2 && neighbors(b.grid, mine[0]).includes(mine[1]);
  },

  all_traits_are_neighbors_in_unit: (b, a) =>
    isConnected(b.grid, traitMembers(b, argUnit(a, 0), argTrait(a, 1))),

  only_one_person_in_unit_has_exactly_n_trait_neighbors: (b, a) => {
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    return (
      unitMembers(b, argUnit(a, 0)).filter((i) => traitNeighborCount(b, i, t) === n).length === 1
    );
  },

  n_in_unit_have_trait_in_dir: (b, a) =>
    inDirCount(b, unitMembers(b, argUnit(a, 0)), argTrait(a, 1), argNum(a, 2), argNum(a, 3)) ===
    argNum(a, 4),

  n_t_in_unit_have_trait_in_dir: (b, a) =>
    inDirCount(
      b,
      traitMembers(b, argUnit(a, 0), argTrait(a, 1)),
      argTrait(a, 2),
      argNum(a, 3),
      argNum(a, 4),
    ) === argNum(a, 5),

  n_professions_have_trait_in_dir: (b, a) =>
    inDirCount(
      b,
      unitMembers(b, { kind: 'profession', name: argProfession(a, 0) }),
      argTrait(a, 1),
      argNum(a, 2),
      argNum(a, 3),
    ) === argNum(a, 4),
};

export function evaluate(b: Board, h: Hint): boolean {
  const fn = EVALUATORS[h.pred];
  if (!fn) throw new UnknownPredicateError(h.pred);
  return fn(b, h.args);
}
