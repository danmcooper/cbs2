export type Trait = 'criminal' | 'innocent';
export type UnitKind = 'row' | 'col' | 'neighbor' | 'between' | 'profession' | 'edge' | 'corner';

export type Unit =
  | { kind: 'row'; n: number }
  | { kind: 'col'; n: number }
  | { kind: 'neighbor'; i: number }
  | { kind: 'between'; a: number; b: number }
  | { kind: 'profession'; name: string }
  | { kind: 'edge' }
  | { kind: 'corner' };

export type ArgKind = 'unit' | 'kind' | 'trait' | 'num' | 'index' | 'profession';

export type HintArg =
  | { t: 'unit'; unit: Unit }
  | { t: 'kind'; kind: UnitKind }
  | { t: 'trait'; trait: Trait }
  | { t: 'num'; n: number }
  | { t: 'index'; i: number }
  | { t: 'profession'; name: string };

export interface Hint {
  pred: string;
  args: HintArg[];
}

export class HintParseError extends Error {}

const U = 'unit' as const;
const T = 'trait' as const;
const N = 'num' as const;
const I = 'index' as const;
const K = 'kind' as const;
const P = 'profession' as const;

export const ARG_KINDS: Record<string, ArgKind[]> = {
  has_trait: [I, T],
  number_of_traits: [T, N],
  number_of_traits_in_unit: [U, T, N],
  min_number_of_traits_in_unit: [U, T, N],
  max_number_of_traits_in_neighbors_in_unit: [U, T, N],
  odd_number_of_traits_in_unit: [U, T],
  more_traits_in_unit_than_unit: [U, U, T],
  equal_number_of_traits_in_units: [U, U, T],
  more_traits_than_traits_in_unit: [U, T, T],
  equal_traits_and_traits_in_unit: [U, T, T],
  has_most_traits: [U, T],
  only_unit_has_exactly_n_traits: [U, T, N],
  only_one_unit_has_exactly_n_traits: [K, T, N],
  all_units_have_at_least_n_traits: [K, T, N],
  is_one_of_n_traits_in_unit: [U, I, T, N],
  is_not_only_trait_in_unit: [U, I, T],
  units_share_n_traits: [U, U, T, N],
  units_share_odd_n_traits: [U, U, T],
  unit_shares_n_out_of_n_traits_with_unit: [U, U, T, N, N],
  both_traits_in_unit_are_in_unit: [U, U, T],
  only_trait_in_unit_is_in_unit: [U, U, T],
  both_traits_are_neighbors_in_unit: [U, T],
  all_traits_are_neighbors_in_unit: [U, T],
  only_one_person_in_unit_has_exactly_n_trait_neighbors: [U, T, N],
  n_in_unit_have_trait_in_dir: [U, T, N, N, N],
  n_t_in_unit_have_trait_in_dir: [U, T, T, N, N, N],
  n_professions_have_trait_in_dir: [P, T, N, N, N],
};

/** Split on top-level commas, ignoring commas nested inside parentheses. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (s.length > 0) out.push(s.slice(start));
  return out;
}

function parseUnit(s: string): Unit {
  const m = /^unit\((\w+),(.*)\)$/.exec(s);
  if (!m) throw new HintParseError(`not a unit: ${s}`);
  const [, kind, arg] = m;
  switch (kind) {
    case 'row':
    case 'col':
      return { kind, n: Number(arg) };
    case 'neighbor':
      return { kind, i: Number(arg) };
    case 'between': {
      const pm = /^pair\((\d+),(\d+)\)$/.exec(arg);
      if (!pm) throw new HintParseError(`bad between arg: ${arg}`);
      return { kind, a: Number(pm[1]), b: Number(pm[2]) };
    }
    case 'profession':
      return { kind, name: arg };
    case 'edge':
    case 'corner':
      return { kind };
    default:
      throw new HintParseError(`unknown unit kind: ${kind}`);
  }
}

function parseArg(raw: string, want: ArgKind): HintArg {
  const s = raw.trim();
  switch (want) {
    case 'unit':
      return { t: 'unit', unit: parseUnit(s) };
    case 'kind':
      return { t: 'kind', kind: s as UnitKind };
    case 'trait':
      if (s !== 'criminal' && s !== 'innocent') throw new HintParseError(`bad trait: ${s}`);
      return { t: 'trait', trait: s };
    case 'num':
      return { t: 'num', n: Number(s) };
    case 'index':
      return { t: 'index', i: Number(s) };
    case 'profession':
      return { t: 'profession', name: s };
  }
}

export function parseHint(s: string): Hint {
  const m = /^([a-z_]+)\((.*)\)$/s.exec(s.trim());
  if (!m) throw new HintParseError(`not a hint: ${s}`);
  const pred = m[1];
  const want = ARG_KINDS[pred];
  if (!want) throw new HintParseError(`unknown predicate: ${pred}`);
  const raw = splitArgs(m[2]);
  if (raw.length !== want.length) {
    throw new HintParseError(`${pred}: expected ${want.length} args, got ${raw.length}`);
  }
  return { pred, args: raw.map((r, i) => parseArg(r, want[i])) };
}

function formatUnit(u: Unit): string {
  switch (u.kind) {
    case 'row':
    case 'col':
      return `unit(${u.kind},${u.n})`;
    case 'neighbor':
      return `unit(neighbor,${u.i})`;
    case 'between':
      return `unit(between,pair(${u.a},${u.b}))`;
    case 'profession':
      return `unit(profession,${u.name})`;
    default:
      return `unit(${u.kind},void)`;
  }
}

function formatArg(a: HintArg): string {
  switch (a.t) {
    case 'unit':
      return formatUnit(a.unit);
    case 'kind':
      return a.kind;
    case 'trait':
      return a.trait;
    case 'num':
      return String(a.n);
    case 'index':
      return String(a.i);
    case 'profession':
      return a.name;
  }
}

export function formatHint(h: Hint): string {
  return `${h.pred}(${h.args.map(formatArg).join(',')})`;
}
