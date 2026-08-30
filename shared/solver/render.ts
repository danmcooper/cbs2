import type { Hint, HintArg, Trait, Unit, UnitKind } from './hint';

export class UnsupportedShapeError extends Error {}

const name = (i: number) => `#NAME:${i}`;
const names = (i: number) => `#NAMES:${i}`;
const prof = (p: string) => `#PROF:${p}`;
const profs = (p: string) => `#PROFS:${p}`;
const col = (n: number) => `#C:${n}`;
const between = (a: number, b: number) => `#BETWEEN:pair(${a},${b})`;

export function plural(t: Trait, n: number): string {
  return n === 1 ? t : `${t}s`;
}

const article = (t: Trait) => (t === 'innocent' ? 'an innocent' : 'a criminal');

/**
 * "no criminals" / "only one criminal" / "exactly 3 criminals".
 *
 * Pass `bare: true` to drop the "exactly" for n >= 2 — ground truth
 * (docs/superpowers/specs/2026-08-29-clue-templates.txt, number_of_traits_in_unit
 * section) attests only "There are N innocents on the edges", never "... exactly N ...",
 * for the edge unit, unlike every other unit kind in that family.
 */
function quantity(n: number, t: Trait, bare = false): string {
  if (n === 0) return `no ${t}s`;
  if (n === 1) return `only one ${t}`;
  return bare ? `${n} ${t}s` : `exactly ${n} ${t}s`;
}

/** "no criminals" / "one criminal" / "3 criminals" — for "with exactly …" contexts */
function bareQuantity(n: number, t: Trait): string {
  if (n === 0) return `no ${t}s`;
  if (n === 1) return `one ${t}`;
  return `${n} ${t}s`;
}

/** Locative phrase: where the members of this unit are. */
export function where(u: Unit): string {
  switch (u.kind) {
    case 'row':
      return `in row ${u.n}`;
    case 'col':
      return `in column ${col(u.n)}`;
    case 'neighbor':
      return `neighboring ${name(u.i)}`;
    case 'between':
      return between(u.a, u.b);
    case 'edge':
      return 'on the edges';
    case 'corner':
      return 'in the corners';
    case 'profession':
      throw new UnsupportedShapeError('profession has no locative phrase');
  }
}

/** Locative phrase used after "Only one person …": corners read "in a corner". */
export function wherePerson(u: Unit): string {
  return u.kind === 'corner' ? 'in a corner' : where(u);
}

export function dirPhrase(dx: number, dy: number): string {
  if (dx === 1 && dy === 0) return 'directly to the right of them';
  if (dx === -1 && dy === 0) return 'directly to the left of them';
  if (dx === 0 && dy === -1) return 'directly above them';
  if (dx === 0 && dy === 1) return 'directly below them';
  throw new UnsupportedShapeError(`no phrase for direction (${dx},${dy})`);
}

function kindWord(k: UnitKind): string {
  if (k === 'row') return 'row';
  if (k === 'col') return 'column';
  throw new UnsupportedShapeError(`no noun for kind ${k}`);
}

function argUnit(a: HintArg[], k: number): Unit {
  const x = a[k];
  if (x.t !== 'unit') throw new UnsupportedShapeError(`arg ${k} is not a unit`);
  return x.unit;
}
function argKind(a: HintArg[], k: number): UnitKind {
  const x = a[k];
  if (x.t !== 'kind') throw new UnsupportedShapeError(`arg ${k} is not a kind`);
  return x.kind;
}
function argTrait(a: HintArg[], k: number): Trait {
  const x = a[k];
  if (x.t !== 'trait') throw new UnsupportedShapeError(`arg ${k} is not a trait`);
  return x.trait;
}
function argNum(a: HintArg[], k: number): number {
  const x = a[k];
  if (x.t !== 'num') throw new UnsupportedShapeError(`arg ${k} is not a number`);
  return x.n;
}
function argIndex(a: HintArg[], k: number): number {
  const x = a[k];
  if (x.t !== 'index') throw new UnsupportedShapeError(`arg ${k} is not an index`);
  return x.i;
}
function argProfession(a: HintArg[], k: number): string {
  const x = a[k];
  if (x.t !== 'profession') throw new UnsupportedShapeError(`arg ${k} is not a profession`);
  return x.name;
}

/** The "…is/are X" side of a two-unit clue. */
function predicateTail(u: Unit, singular: boolean): string {
  if (u.kind === 'neighbor') return `${names(u.i)} neighbor${singular ? '' : 's'}`;
  return where(u);
}

function pairOfSameKind(u1: Unit, u2: Unit): UnitKind {
  if (u1.kind !== u2.kind) {
    throw new UnsupportedShapeError(`mixed unit kinds ${u1.kind}/${u2.kind}`);
  }
  return u1.kind;
}

export const RENDERERS: Record<string, (a: HintArg[]) => string> = {
  has_trait: (a) => {
    const t = argTrait(a, 1);
    return `${name(argIndex(a, 0))} is ${t === 'innocent' ? 'innocent' : 'a criminal'}`;
  },

  number_of_traits: (a) => `There are ${argNum(a, 1)} ${argTrait(a, 0)}s in total`,

  number_of_traits_in_unit: (a) => {
    const u = argUnit(a, 0);
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    if (u.kind === 'neighbor') {
      const q = n === 0 ? `no ${t} neighbors` : n === 1 ? `only one ${t} neighbor` : `exactly ${n} ${t} neighbors`;
      return `${name(u.i)} has ${q}`;
    }
    const verb = n === 1 ? 'There is' : 'There are';
    const bare = u.kind === 'edge';
    return `${verb} ${quantity(n, t, bare)} ${where(u)}`;
  },

  min_number_of_traits_in_unit: (a) => {
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    const verb = n === 1 ? 'There is' : 'There are';
    return `${verb} at least ${bareQuantity(n, t)} ${where(argUnit(a, 0))}`;
  },

  odd_number_of_traits_in_unit: (a) => {
    const u = argUnit(a, 0);
    const t = argTrait(a, 1);
    if (u.kind === 'profession') return `There's an odd number of ${t} ${profs(u.name)}`;
    return `There's an odd number of ${t}s ${where(u)}`;
  },

  is_one_of_n_traits_in_unit: (a) => {
    const u = argUnit(a, 0);
    const i = argIndex(a, 1);
    const t = argTrait(a, 2);
    const n = argNum(a, 3);
    if (u.kind === 'neighbor') {
      return `${name(i)} is one of ${names(u.i)} ${n} ${t} neighbors`;
    }
    return `${name(i)} is one of ${n} ${t}s ${where(u)}`;
  },

  is_not_only_trait_in_unit: (a) =>
    `${name(argIndex(a, 1))} is one of two or more ${argTrait(a, 2)}s ${where(argUnit(a, 0))}`,

  all_units_have_at_least_n_traits: (a) => {
    const k = argKind(a, 0);
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    if (k === 'profession') {
      if (n !== 1) throw new UnsupportedShapeError('profession form only attested for n=1');
      return `There is at least one ${t} among all professions`;
    }
    if (k === 'neighbor') return `Everyone has at least ${n} ${t} neighbors`;
    return `Each ${kindWord(k)} has at least ${bareQuantity(n, t)}`;
  },

  only_one_unit_has_exactly_n_traits: (a) => {
    const k = argKind(a, 0);
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    const tail = n === 0 ? `no ${t}s` : `exactly ${bareQuantity(n, t)}`;
    return `Only one ${kindWord(k)} has ${tail}`;
  },

  more_traits_in_unit_than_unit: (a) => {
    const u1 = argUnit(a, 0);
    const u2 = argUnit(a, 1);
    const t = argTrait(a, 2);
    switch (pairOfSameKind(u1, u2)) {
      case 'neighbor':
        return `${name((u1 as { i: number }).i)} has more ${t} neighbors than ${name((u2 as { i: number }).i)}`;
      case 'row':
        return `There are more ${t}s in row ${(u1 as { n: number }).n} than row ${(u2 as { n: number }).n}`;
      case 'col':
        return `There are more ${t}s in column ${col((u1 as { n: number }).n)} than column ${col((u2 as { n: number }).n)}`;
      case 'profession':
        return `There are more ${t} ${profs((u1 as { name: string }).name)} than ${t} ${profs((u2 as { name: string }).name)}`;
      default:
        throw new UnsupportedShapeError(`more_traits_in_unit_than_unit over ${u1.kind}`);
    }
  },

  equal_number_of_traits_in_units: (a) => {
    const u1 = argUnit(a, 0);
    const u2 = argUnit(a, 1);
    const t = argTrait(a, 2);
    switch (pairOfSameKind(u1, u2)) {
      case 'neighbor':
        return `${name((u1 as { i: number }).i)} and ${name((u2 as { i: number }).i)} have an equal number of ${t} neighbors`;
      case 'row':
        return `There's an equal number of ${t}s in rows ${(u1 as { n: number }).n} and ${(u2 as { n: number }).n}`;
      case 'col':
        return `There's an equal number of ${t}s in columns ${col((u1 as { n: number }).n)} and ${col((u2 as { n: number }).n)}`;
      case 'profession':
        return `There are as many ${t} ${profs((u1 as { name: string }).name)} as there are ${t} ${profs((u2 as { name: string }).name)}`;
      default:
        throw new UnsupportedShapeError(`equal_number_of_traits_in_units over ${u1.kind}`);
    }
  },

  more_traits_than_traits_in_unit: (a) => {
    const u = argUnit(a, 0);
    const t1 = argTrait(a, 1);
    const t2 = argTrait(a, 2);
    if (u.kind === 'neighbor') return `${name(u.i)} has more ${t1} than ${t2} neighbors`;
    return `There are more ${t1}s than ${t2}s ${where(u)}`;
  },

  equal_traits_and_traits_in_unit: (a) => {
    const u = argUnit(a, 0);
    const t1 = argTrait(a, 1);
    const t2 = argTrait(a, 2);
    if (u.kind === 'profession') {
      return `There's an equal number of ${t1} and ${t2} ${profs(u.name)}`;
    }
    return `There are as many ${t1}s as ${t2}s ${where(u)}`;
  },

  has_most_traits: (a) => {
    const u = argUnit(a, 0);
    const t = argTrait(a, 1);
    switch (u.kind) {
      case 'row':
        return `Row ${u.n} has more ${t}s than any other row`;
      case 'col':
        return `Column ${col(u.n)} has more ${t}s than any other column`;
      case 'neighbor':
        return `${name(u.i)} has the most ${t} neighbors`;
      default:
        throw new UnsupportedShapeError(`has_most_traits over ${u.kind}`);
    }
  },

  only_unit_has_exactly_n_traits: (a) => {
    const u = argUnit(a, 0);
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    const tail = n === 0 ? `no ${t}s` : `exactly ${bareQuantity(n, t)}`;
    if (u.kind === 'row') return `Row ${u.n} is the only row with ${tail}`;
    if (u.kind === 'col') return `Column ${col(u.n)} is the only column with ${tail}`;
    if (u.kind === 'neighbor') {
      // Ground truth (only_unit_has_exactly_n_traits, line 214) attests a neighbor-shaped
      // clue: "NAME is the only one with exactly N criminal neighbor" — singular "neighbor"
      // verbatim regardless of n. The brief's step-1 test expected this shape to throw;
      // ground truth wins per task instructions, so we render it (bug-for-bug) instead.
      return `${name(u.i)} is the only one with exactly ${n} ${t} neighbor`;
    }
    throw new UnsupportedShapeError(`only_unit_has_exactly_n_traits over ${u.kind}`);
  },

  units_share_n_traits: (a) => {
    const u1 = argUnit(a, 0);
    const u2 = argUnit(a, 1);
    const t = argTrait(a, 2);
    const n = argNum(a, 3);
    if (u1.kind === 'neighbor' && u2.kind === 'neighbor') {
      const q = n === 1 ? `only one ${t} neighbor` : `${n} ${t} neighbors`;
      return `${name(u1.i)} and ${name(u2.i)} have ${q} in common`;
    }
    if (n === 0 && u2.kind === 'neighbor') {
      // Ground truth (units_share_n_traits, line 60) attests a distinct zero-count phrasing
      // for a neighbor target: "There are no innocents BTW who neighbor NAME" — not the
      // generic "No X ... is neighboring NAME" the brief's fallback would otherwise produce.
      return `There are no ${t}s ${where(u1)} who neighbor ${name(u2.i)}`;
    }
    const tail = u2.kind === 'neighbor' ? `neighboring ${name(u2.i)}` : where(u2);
    if (n === 0) return `No ${t} ${where(u1)} is ${tail}`;
    const verb = n === 1 ? 'is' : 'are';
    return `Exactly ${n} ${plural(t, n)} ${where(u1)} ${verb} ${tail}`;
  },

  units_share_odd_n_traits: (a) => {
    const u1 = argUnit(a, 0);
    const u2 = argUnit(a, 1);
    const t = argTrait(a, 2);
    const nbr = u1.kind === 'neighbor' ? u1 : u2.kind === 'neighbor' ? u2 : null;
    if (nbr === null) throw new UnsupportedShapeError('units_share_odd_n_traits needs a neighbor unit');
    const other = nbr === u1 ? u2 : u1;
    if (other.kind === 'neighbor') {
      throw new UnsupportedShapeError('units_share_odd_n_traits over two neighbor units');
    }
    return `An odd number of ${t}s ${where(other)} neighbor ${name(nbr.i)}`;
  },

  unit_shares_n_out_of_n_traits_with_unit: (a) => {
    const u1 = argUnit(a, 0);
    const u2 = argUnit(a, 1);
    const t = argTrait(a, 2);
    const n = argNum(a, 3);
    const m = argNum(a, 4);
    const head = n === 1 ? `Only 1 of the ${m} ${t}s` : `Exactly ${n} of the ${m} ${t}s`;
    const verb = n === 1 ? 'is' : 'are';
    return `${head} ${where(u1)} ${verb} ${predicateTail(u2, n === 1)}`;
  },
};

export function render(h: Hint): string {
  const fn = RENDERERS[h.pred];
  if (!fn) throw new UnsupportedShapeError(h.pred);
  return fn(h.args);
}

export function canRender(h: Hint): boolean {
  try {
    render(h);
    return true;
  } catch (e) {
    if (e instanceof UnsupportedShapeError) return false;
    throw e;
  }
}
