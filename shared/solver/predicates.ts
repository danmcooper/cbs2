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
