import type { Hint, HintArg, Trait, Unit, UnitKind } from './hint';

export class UnsupportedShapeError extends Error {}

const name = (i: number) => `#NAME:${i}`;
const names = (i: number) => `#NAMES:${i}`;
const prof = (p: string) => `#PROF:${p}`;
const profs = (p: string) => `#PROFS:${p}`;
const col = (n: number) => `#C:${n}`;
const between = (a: number, b: number) => `#BETWEEN:pair(${a},${b})`;

/**
 * Non-breaking space. The archive glues "row"/"column" to the number or #C:
 * token that immediately follows it with a U+00A0 rather than a regular
 * space — but only in locative ("in row 3", "Row 3 is the only …") and
 * comparative ("row 3 than row 5") phrasings. The bare-noun ("Only one row
 * has …") and "Row 3 has more …" / "rows 3 and 5" phrasings use a plain
 * space instead. Confirmed against every row/column+number occurrence in
 * puzzles/*.json — corpus.test.ts's renderer-fidelity test pins this.
 */
const NBSP = ' ';

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
      return `in row${NBSP}${u.n}`;
    case 'col':
      return `in column${NBSP}${col(u.n)}`;
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

function pairOfSameKind<U extends Unit>(u1: U, u2: Unit): asserts u2 is U {
  if (u1.kind !== u2.kind) {
    throw new UnsupportedShapeError(`mixed unit kinds ${u1.kind}/${u2.kind}`);
  }
}

/** Subject phrase for direction clues: "3 persons on the edges" / "2 #PROFS:cook". */
function dirSubject(u: Unit, n: number): string {
  if (u.kind === 'profession') {
    return n === 1 ? `Only one ${prof(u.name)}` : `${n} ${profs(u.name)}`;
  }
  return n === 1 ? `Only one person ${wherePerson(u)}` : `${n} persons ${wherePerson(u)}`;
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
    switch (u1.kind) {
      case 'neighbor':
        pairOfSameKind(u1, u2);
        return `${name(u1.i)} has more ${t} neighbors than ${name(u2.i)}`;
      case 'row':
        pairOfSameKind(u1, u2);
        return `There are more ${t}s in row${NBSP}${u1.n} than row${NBSP}${u2.n}`;
      case 'col':
        pairOfSameKind(u1, u2);
        return `There are more ${t}s in column${NBSP}${col(u1.n)} than column${NBSP}${col(u2.n)}`;
      case 'profession':
        pairOfSameKind(u1, u2);
        return `There are more ${t} ${profs(u1.name)} than ${t} ${profs(u2.name)}`;
      default:
        throw new UnsupportedShapeError(`more_traits_in_unit_than_unit over ${u1.kind}`);
    }
  },

  equal_number_of_traits_in_units: (a) => {
    const u1 = argUnit(a, 0);
    const u2 = argUnit(a, 1);
    const t = argTrait(a, 2);
    switch (u1.kind) {
      case 'neighbor':
        pairOfSameKind(u1, u2);
        return `${name(u1.i)} and ${name(u2.i)} have an equal number of ${t} neighbors`;
      case 'row':
        pairOfSameKind(u1, u2);
        return `There's an equal number of ${t}s in rows ${u1.n} and ${u2.n}`;
      case 'col':
        pairOfSameKind(u1, u2);
        return `There's an equal number of ${t}s in columns ${col(u1.n)} and ${col(u2.n)}`;
      case 'profession':
        pairOfSameKind(u1, u2);
        return `There are as many ${t} ${profs(u1.name)} as there are ${t} ${profs(u2.name)}`;
      default:
        throw new UnsupportedShapeError(`equal_number_of_traits_in_units over ${u1.kind}`);
    }
  },

  more_traits_in_unit_than_traits_in_unit: (a) => {
    const u1 = argUnit(a, 0);
    const t1 = argTrait(a, 1);
    const u2 = argUnit(a, 2);
    const t2 = argTrait(a, 3);
    switch (u1.kind) {
      case 'neighbor':
        pairOfSameKind(u1, u2);
        return `${name(u1.i)} has more ${t1} neighbors than ${name(u2.i)} has ${t2} ones`;
      case 'row':
        pairOfSameKind(u1, u2);
        return `There are more ${t1}s in row${NBSP}${u1.n} than ${t2}s in row${NBSP}${u2.n}`;
      case 'col':
        pairOfSameKind(u1, u2);
        return `There are more ${t1}s in column${NBSP}${col(u1.n)} than ${t2}s in column${NBSP}${col(u2.n)}`;
      case 'profession':
        pairOfSameKind(u1, u2);
        return `There are more ${t1} ${profs(u1.name)} than ${t2} ${profs(u2.name)}`;
      default:
        throw new UnsupportedShapeError(`more_traits_in_unit_than_traits_in_unit over ${u1.kind}`);
    }
  },

  equal_traits_in_unit_and_traits_in_unit: (a) => {
    const u1 = argUnit(a, 0);
    const t1 = argTrait(a, 1);
    const u2 = argUnit(a, 2);
    const t2 = argTrait(a, 3);
    switch (u1.kind) {
      case 'neighbor':
        pairOfSameKind(u1, u2);
        return `${name(u1.i)} has as many ${t1} neighbors as ${name(u2.i)} has ${t2} ones`;
      case 'row':
        pairOfSameKind(u1, u2);
        return `There are as many ${t1}s in row${NBSP}${u1.n} as ${t2}s in row${NBSP}${u2.n}`;
      case 'col':
        pairOfSameKind(u1, u2);
        return `There are as many ${t1}s in column${NBSP}${col(u1.n)} as ${t2}s in column${NBSP}${col(u2.n)}`;
      case 'profession':
        pairOfSameKind(u1, u2);
        return `There are as many ${t1} ${profs(u1.name)} as there are ${t2} ${profs(u2.name)}`;
      default:
        throw new UnsupportedShapeError(`equal_traits_in_unit_and_traits_in_unit over ${u1.kind}`);
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
    if (u.kind === 'row') return `Row${NBSP}${u.n} is the only row with ${tail}`;
    if (u.kind === 'col') return `Column${NBSP}${col(u.n)} is the only column with ${tail}`;
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
      // The archive's ten instances of this shape all count 1 or more, so the
      // zero wording is ours: spell it "no", as every other zero-count branch of
      // this predicate does. "have 0 criminal neighbors in common" is not a
      // sentence the source would write.
      const q =
        n === 0 ? `no ${t} neighbors` : n === 1 ? `only one ${t} neighbor` : `${n} ${t} neighbors`;
      return `${name(u1.i)} and ${name(u2.i)} have ${q} in common`;
    }
    if (u1.kind === 'neighbor' && u2.kind !== 'neighbor') {
      // Real archive occurrences of this shape (u1 = neighbor, u2 = non-neighbor) use at
      // least three mutually incompatible sentence structures (puzzles/2026-08-26.json,
      // puzzles/2026-08-18.json, puzzles/2026-07-26.json) — one even needs a total-count
      // number that isn't among this predicate's stored args. There's no way to pick the
      // right phrasing from the hint AST alone, so fail closed per the project's binding
      // constraint instead of emitting a plausible-but-wrong sentence.
      throw new UnsupportedShapeError('units_share_n_traits with neighbor unit first');
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
    if (u1.kind === 'neighbor' && u2.kind === 'neighbor' && n !== 1) {
      // Derived from real archive data (puzzles/2026-07-12.json, puzzles/2026-08-28.json,
      // puzzles/2026-08-18.json), not the anonymized ground-truth dump alone (which can't
      // show actual numeric values) — see fix-round-1 report for detail. All three real
      // n!==1 occurrences are n=2 (m in {3,4,5}); unverified for n>=3.
      return `Exactly ${n} of ${names(u1.i)} ${m} ${t} neighbors also neighbor ${name(u2.i)}`;
    }
    const head = n === 1 ? `Only 1 of the ${m} ${t}s` : `Exactly ${n} of the ${m} ${t}s`;
    const verb = n === 1 ? 'is' : 'are';
    return `${head} ${where(u1)} ${verb} ${predicateTail(u2, n === 1)}`;
  },

  max_number_of_traits_in_neighbors_in_unit: (a) => {
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    const tail = n === 1 ? `one ${t} neighbor` : `${n} ${t} neighbors`;
    return `No one ${where(argUnit(a, 0))} has more than ${tail}`;
  },

  both_traits_in_unit_are_in_unit: (a) =>
    `Both ${argTrait(a, 2)}s ${where(argUnit(a, 0))} are ${predicateTail(argUnit(a, 1), false)}`,

  only_trait_in_unit_is_in_unit: (a) =>
    `The only ${argTrait(a, 2)} ${where(argUnit(a, 0))} is ${predicateTail(argUnit(a, 1), true)}`,

  both_traits_are_neighbors_in_unit: (a) =>
    `Both ${argTrait(a, 1)}s ${where(argUnit(a, 0))} are connected`,

  all_traits_are_neighbors_in_unit: (a) =>
    `All ${argTrait(a, 1)}s ${where(argUnit(a, 0))} are connected`,

  only_one_person_in_unit_has_exactly_n_trait_neighbors: (a) => {
    const u = argUnit(a, 0);
    const t = argTrait(a, 1);
    const n = argNum(a, 2);
    const head = u.kind === 'profession' ? `Only one ${prof(u.name)}` : `Only one person ${wherePerson(u)}`;
    const tail =
      n === 0 ? `no ${t} neighbors` : n === 1 ? `exactly one ${t} neighbor` : `exactly ${n} ${t} neighbors`;
    return `${head} has ${tail}`;
  },

  n_in_unit_have_trait_in_dir: (a) => {
    const u = argUnit(a, 0);
    const t = argTrait(a, 1);
    const n = argNum(a, 4);
    const verb = n === 1 ? 'has' : 'have';
    return `${dirSubject(u, n)} ${verb} ${article(t)} ${dirPhrase(argNum(a, 2), argNum(a, 3))}`;
  },

  n_t_in_unit_have_trait_in_dir: (a) => {
    const u = argUnit(a, 0);
    const t1 = argTrait(a, 1);
    const t2 = argTrait(a, 2);
    const n = argNum(a, 5);
    // Ground truth (docs/superpowers/specs/2026-08-29-clue-templates.txt,
    // n_t_in_unit_have_trait_in_dir section) anonymizes numbers, but cross-referencing real
    // archive occurrences of n=1 shows the dominant phrasing is "Only one X in UNIT has ..."
    // (3 of 4 real occurrences, e.g. puzzles/2026-08-02.json, puzzles/2026-08-20.json,
    // puzzles/2026-08-27.json) — matching this file's convention of always saying "Only one"
    // for a singular subject elsewhere. The brief's bare "One X ..." matched only the minority
    // instance (puzzles/2026-07-21.json); ground truth's dominant form wins per task instructions.
    const head = n === 1 ? `Only one ${t1}` : `Exactly ${n} ${t1}s`;
    const verb = n === 1 ? 'has' : 'have';
    return `${head} ${where(u)} ${verb} ${article(t2)} ${dirPhrase(argNum(a, 3), argNum(a, 4))}`;
  },

  n_professions_have_trait_in_dir: (a) => {
    const p = argProfession(a, 0);
    const t = argTrait(a, 1);
    const n = argNum(a, 4);
    const head = n === 1 ? `Exactly 1 ${prof(p)} has` : `${n} ${profs(p)} have`;
    return `${head} ${article(t)} ${dirPhrase(argNum(a, 2), argNum(a, 3))}`;
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
