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
