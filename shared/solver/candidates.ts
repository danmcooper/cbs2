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

/**
 * True when no member of `members` has a valid cell in direction (dx, dy) — e.g. every
 * member of the unit is already in the grid's topmost row and dy = -1 ("above"). Since
 * offset validity depends only on grid position, never on the criminal/innocent
 * assignment, this makes `dirCount` structurally 0 for every conceivable board, not just
 * the actual one — the exact same failure mode as the has_most_traits gate above, just
 * discovered via the exhaustive 3x3 regression rather than archive comparison. Detected
 * on the 4x5 test board too: e.g. row 1 (topmost) asking "how many have a trait above
 * them" is always 0, and likewise for the bottom row + below, leftmost col + left,
 * rightmost col + right, and any `between` segment confined to one of those edges.
 */
const dirIsStructurallyEmpty = (b: Board, members: number[], dx: number, dy: number): boolean =>
  members.every((i) => offsetIndex(b.grid, i, dx, dy) === null);

/**
 * True when every pair of `members` is mutually adjacent (a complete graph under 8-way
 * adjacency) — vacuously true when there are 0 or 1 members. In that case ANY subset is
 * automatically fully connected, so `all_traits_are_neighbors_in_unit` (isConnected over
 * the trait-bearing subset) is true regardless of which cards actually carry the trait —
 * again structurally, for every conceivable assignment. Two shapes in the candidate pool
 * hit this: a corner cell's 3-member neighbor unit (the two edge-adjacent cells and the
 * diagonal cell are always mutually adjacent to each other, for any grid >= 2x2), and a
 * `between` segment of exactly two immediately-adjacent cells (its only two members are
 * adjacent to each other by construction).
 */
const isCompleteAdjacencyGraph = (b: Board, members: number[]): boolean => {
  for (let x = 0; x < members.length; x++) {
    for (let y = x + 1; y < members.length; y++) {
      if (!neighbors(b.grid, members[x]).includes(members[y])) return false;
    }
  }
  return true;
};

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
  /**
   * Whether u1 and u2's raw memberships (trait-independent) actually overlap. Membership
   * is fixed once the board's grid and profession assignment are fixed — it never depends
   * on the criminal/innocent assignment — so when this is false, `overlap(u1, u2, trait)`
   * is 0 for every conceivable criminal assignment on this board, not just the actual one.
   * `units_share_n_traits(u1, u2, trait, 0)` in that case is a structural tautology: true
   * regardless of the board, exactly the failure mode the has_most_traits gate above
   * exists to avoid. The archive does use n=0 for this predicate (confirmed: all 10 real
   * instances have intersecting memberships), so n=0 stays legitimate whenever the units
   * actually overlap — only the disjoint case is dropped.
   */
  const membersIntersect = (u1: Unit, u2: Unit) => {
    const first = new Set(unitMembers(b, u1));
    return unitMembers(b, u2).some((i) => first.has(i));
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
      // "min_number_of_traits_in_unit(u, t, 0)" ("at least 0 Ts") is true of every
      // conceivable board — counts are never negative. Archive confirms n>=1 always
      // (all 4 real instances). Only push when the threshold is >= 1.
      if (c >= 1) push('min_number_of_traits_in_unit', [u(unit), t(trait), n(c)]);
      if (c >= 2) push('min_number_of_traits_in_unit', [u(unit), t(trait), n(c - 1)]);
      push('odd_number_of_traits_in_unit', [u(unit), t(trait)]);
      if (hasMultipleUnitsOfKind(b, unit)) {
        push('has_most_traits', [u(unit), t(trait)]);
        push('only_unit_has_exactly_n_traits', [u(unit), t(trait), n(c)]);
      }
      push('both_traits_are_neighbors_in_unit', [u(unit), t(trait)]);
      // Skip when the unit's full membership is a complete adjacency graph — see
      // isCompleteAdjacencyGraph above. Computed inside the trait loop but doesn't
      // depend on trait; cheap enough (unit sizes are small) not to hoist.
      if (!isCompleteAdjacencyGraph(b, members)) {
        push('all_traits_are_neighbors_in_unit', [u(unit), t(trait)]);
      }

      const nbrCounts = members.map((i) => countTrait(b, neighbors(b.grid, i), trait));
      if (nbrCounts.length > 0) {
        const maxCount = Math.max(...nbrCounts);
        // A cell's trait-neighbor count can never exceed its own degree
        // (neighbors(grid, i).length), which depends only on grid position, never on the
        // assignment. So whenever the pushed threshold is >= the largest degree among the
        // unit's members, "no one has more than N trait neighbors" is true of every
        // conceivable board — e.g. every corner cell has exactly 3 neighbors, so
        // "no one in the corners has more than 3 innocent neighbors" is always true.
        // Only push when the threshold is still below that structural ceiling.
        const maxDegree = Math.max(...members.map((i) => neighbors(b.grid, i).length));
        if (maxCount < maxDegree) {
          push('max_number_of_traits_in_neighbors_in_unit', [u(unit), t(trait), n(maxCount)]);
        }
      }
      for (const value of new Set(nbrCounts)) {
        push('only_one_person_in_unit_has_exactly_n_trait_neighbors', [u(unit), t(trait), n(value)]);
      }

      for (const i of members) {
        push('is_one_of_n_traits_in_unit', [u(unit), idx(i), t(trait), n(c)]);
        push('is_not_only_trait_in_unit', [u(unit), idx(i), t(trait)]);
      }

      for (const [dx, dy] of DIRS) {
        // Skip when no member of the unit even has a cell in this direction (e.g. the
        // whole unit sits in the grid's topmost row and dy = -1) — dirCount would be
        // structurally 0 for every conceivable assignment. sources below is always a
        // subset of members, so this same structural check covers both predicates.
        if (dirIsStructurallyEmpty(b, members, dx, dy)) continue;
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
      const minCount = Math.min(...counts);
      // Same "at least 0" tautology as above: if every unit in the group has at least 0
      // of the trait, that's true of every board, not a real constraint. Archive confirms
      // n>=1 always (all 17 real instances).
      if (minCount >= 1) push('all_units_have_at_least_n_traits', [k(kind), t(trait), n(minCount)]);
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
      const cross = isCross(u1, u2);
      // Trait-independent, so compute once per unit pair rather than once per (pair, trait).
      const intersects = cross && membersIntersect(u1, u2);
      for (const trait of TRAITS) {
        if (u1.kind === u2.kind) {
          push('more_traits_in_unit_than_unit', [u(u1), u(u2), t(trait)]);
          push('equal_number_of_traits_in_units', [u(u1), u(u2), t(trait)]);
        }
        if (!cross) continue;
        const ov = overlap(u1, u2, trait);
        // Drop when u1/u2 are structurally disjoint (see membersIntersect above) — that
        // shape is always shares-0 regardless of the board, a tautology. Keep n=0 when
        // the units do intersect: "they share none of this trait" is then a real,
        // contingent fact, matching the archive's 10 real n=0 instances (all intersecting).
        if (intersects) push('units_share_n_traits', [u(u1), u(u2), t(trait), n(ov)]);
        push('units_share_odd_n_traits', [u(u1), u(u2), t(trait)]);
        // Archive never emits a shared count of 0 for this predicate (52 instances at
        // shared=1, 24 at shared=2, 2 at shared=3, none at 0). The trailing "out of m"
        // argument keeps a shared=0 instance from being a strict tautology (m is still a
        // real, falsifiable count), but the source never phrases it that way and "shares 0
        // out of m" reads as if the 0 were meaningful when it's often structurally
        // guaranteed — so drop shared=0 here regardless of intersection.
        if (ov > 0) {
          push('unit_shares_n_out_of_n_traits_with_unit', [
            u(u1), u(u2), t(trait), n(ov), n(count(u1, trait)),
          ]);
        }
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
        // Same structural boundary check as above: profession membership is fixed given
        // the board (independent of the criminal assignment), so if every card of this
        // profession structurally lacks a cell in this direction, the count is always 0.
        if (dirIsStructurallyEmpty(b, members, dx, dy)) continue;
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
