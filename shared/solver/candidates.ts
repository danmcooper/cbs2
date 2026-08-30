import { neighbors, offsetIndex } from './grid';
import { type Hint, type HintArg, type Trait, type Unit, formatHint } from './hint';
import { type Board, countTrait, evaluate, hasTrait, unitMembers, unitsOfKind } from './predicates';
import { canRender } from './render';

const TRAITS: Trait[] = ['criminal', 'innocent'];
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
];

const u = (unit: Unit): HintArg => ({ t: 'unit', unit });
const t = (trait: Trait): HintArg => ({ t: 'trait', trait });
const n = (value: number): HintArg => ({ t: 'num', n: value });
const idx = (i: number): HintArg => ({ t: 'index', i });
const k = (kind: Unit['kind']): HintArg => ({ t: 'kind', kind });
const pr = (name: string): HintArg => ({ t: 'profession', name });

export function candidateUnits(b: Board): Unit[] {
  const units: Unit[] = [
    ...unitsOfKind(b, 'row'),
    ...unitsOfKind(b, 'col'),
    ...unitsOfKind(b, 'neighbor'),
    ...unitsOfKind(b, 'profession'),
    ...unitsOfKind(b, 'edge'),
    ...unitsOfKind(b, 'corner'),
  ];
  const { width, height } = b.grid;
  for (let row = 0; row < height; row++) {
    for (let x1 = 0; x1 < width; x1++) {
      for (let x2 = x1 + 1; x2 < width; x2++) {
        units.push({ kind: 'between', a: row * width + x1, b: row * width + x2 });
      }
    }
  }
  for (let col = 0; col < width; col++) {
    for (let y1 = 0; y1 < height; y1++) {
      for (let y2 = y1 + 1; y2 < height; y2++) {
        units.push({ kind: 'between', a: y1 * width + col, b: y2 * width + col });
      }
    }
  }
  return units;
}

const isCross = (a: Unit, c: Unit) =>
  a.kind === 'neighbor' || a.kind === 'between' || c.kind === 'neighbor' || c.kind === 'between';

/**
 * `has_most_traits` and `only_unit_has_exactly_n_traits` are implemented in predicates.ts
 * as `unitsOfKind(b, u.kind).every(other => sameUnit(other, u) || ...)`. When a unit kind
 * has fewer than two units (edge and corner always have exactly one; between always has
 * zero, since unitsOfKind returns [] for it), that `.every()` only ever compares the unit
 * to itself and is satisfied trivially, regardless of the board's assignment. Such a clue
 * constrains nothing, so it must never be emitted even though it would evaluate to `true`
 * and render into confident-sounding English. Restrict these two predicates to unit kinds
 * with at least two units — a genuine check against unitsOfKind(...).length, not a
 * hardcoded kind allowlist, so it stays correct if grid dimensions ever change.
 */
const hasMultipleUnitsOfKind = (b: Board, unit: Unit): boolean => unitsOfKind(b, unit.kind).length >= 2;

export function candidateHints(b: Board): Hint[] {
  const units = candidateUnits(b);
  const seen = new Set<string>();
  const out: Hint[] = [];

  const push = (pred: string, args: HintArg[]) => {
    const hint: Hint = { pred, args };
    const key = formatHint(hint);
    if (seen.has(key)) return;
    if (!canRender(hint)) return;
    if (!evaluate(b, hint)) return;
    seen.add(key);
    out.push(hint);
  };

  const count = (unit: Unit, trait: Trait) => countTrait(b, unitMembers(b, unit), trait);
  const overlap = (u1: Unit, u2: Unit, trait: Trait) => {
    const first = new Set(unitMembers(b, u1));
    return unitMembers(b, u2).filter((i) => first.has(i) && hasTrait(b, i, trait)).length;
  };
  const dirCount = (members: number[], trait: Trait, dx: number, dy: number) =>
    members.filter((i) => {
      const j = offsetIndex(b.grid, i, dx, dy);
      return j !== null && hasTrait(b, j, trait);
    }).length;

  for (let i = 0; i < b.grid.size; i++) {
    for (const trait of TRAITS) push('has_trait', [idx(i), t(trait)]);
  }
  for (const trait of TRAITS) {
    push('number_of_traits', [t(trait), n(countTrait(b, [...b.criminal.keys()], trait))]);
  }

  for (const unit of units) {
    const members = unitMembers(b, unit);
    for (const trait of TRAITS) {
      const c = count(unit, trait);
      push('number_of_traits_in_unit', [u(unit), t(trait), n(c)]);
      push('min_number_of_traits_in_unit', [u(unit), t(trait), n(c)]);
      if (c >= 1) push('min_number_of_traits_in_unit', [u(unit), t(trait), n(c - 1)]);
      push('odd_number_of_traits_in_unit', [u(unit), t(trait)]);
      if (hasMultipleUnitsOfKind(b, unit)) {
        push('has_most_traits', [u(unit), t(trait)]);
        push('only_unit_has_exactly_n_traits', [u(unit), t(trait), n(c)]);
      }
      push('both_traits_are_neighbors_in_unit', [u(unit), t(trait)]);
      push('all_traits_are_neighbors_in_unit', [u(unit), t(trait)]);

      const nbrCounts = members.map((i) => countTrait(b, neighbors(b.grid, i), trait));
      if (nbrCounts.length > 0) {
        push('max_number_of_traits_in_neighbors_in_unit', [u(unit), t(trait), n(Math.max(...nbrCounts))]);
      }
      for (const value of new Set(nbrCounts)) {
        push('only_one_person_in_unit_has_exactly_n_trait_neighbors', [u(unit), t(trait), n(value)]);
      }

      for (const i of members) {
        push('is_one_of_n_traits_in_unit', [u(unit), idx(i), t(trait), n(c)]);
        push('is_not_only_trait_in_unit', [u(unit), idx(i), t(trait)]);
      }

      for (const [dx, dy] of DIRS) {
        push('n_in_unit_have_trait_in_dir', [
          u(unit), t(trait), n(dx), n(dy), n(dirCount(members, trait, dx, dy)),
        ]);
        for (const other of TRAITS) {
          const sources = members.filter((i) => hasTrait(b, i, other));
          push('n_t_in_unit_have_trait_in_dir', [
            u(unit), t(other), t(trait), n(dx), n(dy), n(dirCount(sources, trait, dx, dy)),
          ]);
        }
      }
    }
    for (const [t1, t2] of [
      ['criminal', 'innocent'],
      ['innocent', 'criminal'],
    ] as [Trait, Trait][]) {
      push('more_traits_than_traits_in_unit', [u(unit), t(t1), t(t2)]);
      push('equal_traits_and_traits_in_unit', [u(unit), t(t1), t(t2)]);
    }
  }

  for (const kind of ['row', 'col', 'profession', 'neighbor'] as const) {
    const group = unitsOfKind(b, kind);
    if (group.length === 0) continue;
    for (const trait of TRAITS) {
      const counts = group.map((unit) => count(unit, trait));
      push('all_units_have_at_least_n_traits', [k(kind), t(trait), n(Math.min(...counts))]);
      if (kind === 'row' || kind === 'col') {
        for (const value of new Set(counts)) {
          push('only_one_unit_has_exactly_n_traits', [k(kind), t(trait), n(value)]);
        }
      }
    }
  }

  for (const u1 of units) {
    for (const u2 of units) {
      if (u1 === u2) continue;
      for (const trait of TRAITS) {
        if (u1.kind === u2.kind) {
          push('more_traits_in_unit_than_unit', [u(u1), u(u2), t(trait)]);
          push('equal_number_of_traits_in_units', [u(u1), u(u2), t(trait)]);
        }
        if (!isCross(u1, u2)) continue;
        push('units_share_n_traits', [u(u1), u(u2), t(trait), n(overlap(u1, u2, trait))]);
        push('units_share_odd_n_traits', [u(u1), u(u2), t(trait)]);
        push('unit_shares_n_out_of_n_traits_with_unit', [
          u(u1), u(u2), t(trait), n(overlap(u1, u2, trait)), n(count(u1, trait)),
        ]);
        push('both_traits_in_unit_are_in_unit', [u(u1), u(u2), t(trait)]);
        push('only_trait_in_unit_is_in_unit', [u(u1), u(u2), t(trait)]);
      }
    }
  }

  for (const unit of unitsOfKind(b, 'profession')) {
    const name = (unit as { name: string }).name;
    const members = unitMembers(b, unit);
    for (const trait of TRAITS) {
      for (const [dx, dy] of DIRS) {
        push('n_professions_have_trait_in_dir', [
          pr(name), t(trait), n(dx), n(dy), n(dirCount(members, trait, dx, dy)),
        ]);
      }
    }
  }

  return out;
}

export function referencedCards(b: Board, h: Hint): Set<number> {
  const cards = new Set<number>();
  for (const arg of h.args) {
    if (arg.t === 'unit') for (const i of unitMembers(b, arg.unit)) cards.add(i);
    else if (arg.t === 'index') cards.add(arg.i);
    else if (arg.t === 'profession') {
      for (const i of unitMembers(b, { kind: 'profession', name: arg.name })) cards.add(i);
    }
  }
  return cards;
}
