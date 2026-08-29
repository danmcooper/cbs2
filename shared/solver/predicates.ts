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
}

export class UnknownPredicateError extends Error {}

export function unitMembers(b: Board, u: Unit): number[] {
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
};

export function evaluate(b: Board, h: Hint): boolean {
  const fn = EVALUATORS[h.pred];
  if (!fn) throw new UnknownPredicateError(h.pred);
  return fn(b, h.args);
}
