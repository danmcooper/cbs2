# Dan Puzzle Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a solver and generator for Clues-by-Sam-format puzzles so every archived date ships a second, original "Dan" puzzle at the same difficulty label as the real one.

**Architecture:** A pure-TypeScript solver under `shared/solver/` — grid geometry, an `origHint` parser, 27 predicate evaluators, a clue renderer, and an exhaustive enumerator over the 2^20 assignment space — verified against the 53-puzzle archive used as a test corpus. On top of it, a generator that samples an assignment, enumerates every true clue, and builds a forcing chain, then re-verifies from scratch with the generic solver. Node scripts calibrate difficulty bands from the archive and emit `puzzles/<date>-dan.json`; the site gains a `variant` field and a Real/Dan archive toggle.

**Tech Stack:** TypeScript (strict), Node 22 + `tsx` for `.mts` scripts, Vitest, React 19 + Vite for the site.

**Spec:** `docs/superpowers/specs/2026-08-29-dan-puzzle-generator-design.md`
**Clue template ground truth:** `docs/superpowers/specs/2026-08-29-clue-templates.txt`

## Global Constraints

- Grids are **4 wide × 5 high**, 20 cards, indices 0–19, row-major. The solver may accept other sizes but nothing needs to work beyond 4×5.
- **Neighbours are 8-way** (king move) and exclude the person themselves.
- **Rows and columns in `origHint` are 1-based.** `unit(row,1)` is the top row; `unit(col,1)` is the leftmost column and renders as "A".
- **`unit(between,pair(a,b))` is the inclusive line segment** from `a` to `b`: a contiguous row-run when the endpoints share a row, a column-run stepping by `width` when they share a column. It is **not** the inclusive index range.
- Direction offsets are `(dx,dy)`: `(1,0)` right, `(-1,0)` left, `(0,-1)` above, `(0,1)` below.
- **No scraped title or flavour text is ever copied into a generated puzzle.** Generated titles and flavour lines come only from `shared/solver/vocab.ts`. Names and professions may be reused (they come from the shipped profession→emoji face map).
- `formatVersion` stays `1`. `variant?: 'dan'` is **additive and optional**; absent means a real puzzle. Every existing `puzzles/*.json` must still validate unchanged.
- **Every generated clue must round-trip exactly:** `render(parseHint(h))` equals the stored `clue` string. Candidate clues whose rendering is unsupported are dropped, not approximated.
- **A clue card must never be a member of any unit its own clue references.** This avoids the source's first-person phrasings ("in my row", "the only innocent guard"), which `ClueText`'s prepass does not generate.
- Generated puzzles must pass `validatePuzzle` and the from-scratch solver check before any file is written.
- Tests are Vitest, colocated next to the module (`foo.ts` → `foo.test.ts`). `vitest.config.ts` already collects `shared/**/*.test.ts`, `scripts/**/*.test.mts`, `site/src/**/*.test.{ts,tsx}`.
- Run the whole suite with `npx vitest run`; a single file with `npx vitest run <path>`.

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `shared/solver/grid.ts` | Geometry: dimensions, 8-way neighbours, the 7 unit kinds, connectivity |
| `shared/solver/hint.ts` | `origHint` string ⇄ typed `Hint` AST; argument signature table |
| `shared/solver/predicates.ts` | The 27 evaluators over a complete assignment |
| `shared/solver/render.ts` | `Hint` → the `clue` markup string |
| `shared/solver/enumerate.ts` | Survivor bitmask filtering; forced-card queries |
| `shared/solver/solve.ts` | Unique solvability, forcing closure, `paths`, `hints` |
| `shared/solver/difficulty.ts` | Metrics from a solved puzzle; band membership |
| `shared/solver/vocab.ts` | Original names, professions, titles, flavour lines |
| `shared/solver/candidates.ts` | Enumerate every clue true of a given assignment |
| `shared/solver/generate.ts` | Sample → chain → verify; produces a `Puzzle` |
| `shared/solver/corpus.ts` | Loads the archive as a test corpus |
| `shared/solver/corpus.test.ts` | The three archive-wide tests |
| `scripts/calibrate.mts` | Archive → `config/difficulty.json` |
| `scripts/generate.mts` | CLI: write `puzzles/<date>-dan.json` |
| `config/difficulty.json` | Checked-in per-label bands |

**Modify:**

| File | Change |
|---|---|
| `shared/puzzle.ts` | `variant?: 'dan'` and its validation |
| `scripts/manifest.mts` | `-dan` filename regex; `slug` and `variant` on `ManifestEntry` |
| `site/src/router.ts` | Route carries a slug, not a date |
| `site/src/App.tsx` | Passes the slug to `Game` |
| `site/src/screens/Game.tsx` | Fetches by slug; labels Dan puzzles |
| `site/src/screens/archiveData.ts` | `variant` filter |
| `site/src/screens/Archive.tsx` | Real/Dan toggle; links by slug |
| `site/src/styles.css` | Toggle styling |
| `package.json` | `calibrate` and `generate` scripts |
| `.github/workflows/scrape-daily.yml` | Generate after each scrape |

---

### Task 1: Grid geometry and units

**Files:**
- Create: `shared/solver/grid.ts`
- Test: `shared/solver/grid.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Grid { width: number; height: number; size: number }`
  - `makeGrid(width: number, height: number): Grid`
  - `rowOf(g, i): number` / `colOf(g, i): number` — **0-based**
  - `neighbors(g, i): number[]` — 8-way, ascending, excludes `i`
  - `segment(g, a, b): number[]` — inclusive line segment, ascending; `[]` if `a` and `b` share neither row nor column
  - `rowMembers(g, n): number[]` / `colMembers(g, n): number[]` — **`n` is 1-based**
  - `edgeMembers(g): number[]` / `cornerMembers(g): number[]`
  - `offsetIndex(g, i, dx, dy): number | null` — `null` if off-grid
  - `isConnected(g, members: number[]): boolean` — 8-way connectivity of the given set

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/grid.test.ts
import { describe, expect, it } from 'vitest';
import {
  cornerMembers, colMembers, edgeMembers, isConnected, makeGrid,
  neighbors, offsetIndex, rowMembers, segment,
} from './grid';

const g = makeGrid(4, 5);

describe('neighbors', () => {
  it('gives 8 neighbours for an interior card', () => {
    expect(neighbors(g, 5)).toEqual([0, 1, 2, 4, 6, 8, 9, 10]);
  });
  it('gives 3 neighbours for a corner and never wraps rows', () => {
    expect(neighbors(g, 0)).toEqual([1, 4, 5]);
    expect(neighbors(g, 3)).toEqual([2, 6, 7]);
    expect(neighbors(g, 4)).toEqual([0, 1, 5, 8, 9]);
  });
});

describe('segment', () => {
  it('walks a row run inclusively', () => {
    expect(segment(g, 4, 7)).toEqual([4, 5, 6, 7]);
    expect(segment(g, 7, 4)).toEqual([4, 5, 6, 7]);
  });
  it('walks a column run by width, not by index range', () => {
    expect(segment(g, 1, 13)).toEqual([1, 5, 9, 13]);
  });
  it('is empty for endpoints sharing neither row nor column', () => {
    expect(segment(g, 0, 5)).toEqual([]);
  });
});

describe('units', () => {
  it('indexes rows and columns 1-based', () => {
    expect(rowMembers(g, 1)).toEqual([0, 1, 2, 3]);
    expect(colMembers(g, 1)).toEqual([0, 4, 8, 12, 16]);
    expect(colMembers(g, 4)).toEqual([3, 7, 11, 15, 19]);
  });
  it('lists the perimeter and the four corners', () => {
    expect(edgeMembers(g)).toEqual([0, 1, 2, 3, 4, 7, 8, 11, 12, 15, 16, 17, 18, 19]);
    expect(cornerMembers(g)).toEqual([0, 3, 16, 19]);
  });
});

describe('offsetIndex', () => {
  it('applies dx/dy with y growing downward', () => {
    expect(offsetIndex(g, 5, 1, 0)).toBe(6);
    expect(offsetIndex(g, 5, 0, -1)).toBe(1);
    expect(offsetIndex(g, 5, 0, 1)).toBe(9);
  });
  it('returns null off-grid instead of wrapping', () => {
    expect(offsetIndex(g, 3, 1, 0)).toBeNull();
    expect(offsetIndex(g, 0, 0, -1)).toBeNull();
  });
});

describe('isConnected', () => {
  it('accepts a diagonal chain and the empty/singleton sets', () => {
    expect(isConnected(g, [0, 5, 10])).toBe(true);
    expect(isConnected(g, [])).toBe(true);
    expect(isConnected(g, [7])).toBe(true);
  });
  it('rejects two separated clumps', () => {
    expect(isConnected(g, [0, 1, 19])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/grid.test.ts`
Expected: FAIL — cannot resolve `./grid`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/grid.ts
export interface Grid {
  width: number;
  height: number;
  size: number;
}

export function makeGrid(width: number, height: number): Grid {
  return { width, height, size: width * height };
}

export function rowOf(g: Grid, i: number): number {
  return Math.floor(i / g.width);
}

export function colOf(g: Grid, i: number): number {
  return i % g.width;
}

export function offsetIndex(g: Grid, i: number, dx: number, dy: number): number | null {
  const x = colOf(g, i) + dx;
  const y = rowOf(g, i) + dy;
  if (x < 0 || x >= g.width || y < 0 || y >= g.height) return null;
  return y * g.width + x;
}

export function neighbors(g: Grid, i: number): number[] {
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const j = offsetIndex(g, i, dx, dy);
      if (j !== null) out.push(j);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Inclusive line segment from a to b. Row-run when they share a row, column-run
 * stepping by width when they share a column, [] otherwise. */
export function segment(g: Grid, a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const step = rowOf(g, a) === rowOf(g, b) ? 1 : colOf(g, a) === colOf(g, b) ? g.width : 0;
  if (step === 0) return [];
  const out: number[] = [];
  for (let i = lo; i <= hi; i += step) out.push(i);
  return out;
}

/** n is 1-based. */
export function rowMembers(g: Grid, n: number): number[] {
  const start = (n - 1) * g.width;
  return Array.from({ length: g.width }, (_, k) => start + k);
}

/** n is 1-based. */
export function colMembers(g: Grid, n: number): number[] {
  return Array.from({ length: g.height }, (_, k) => k * g.width + (n - 1));
}

export function edgeMembers(g: Grid): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.size; i++) {
    const x = colOf(g, i);
    const y = rowOf(g, i);
    if (x === 0 || y === 0 || x === g.width - 1 || y === g.height - 1) out.push(i);
  }
  return out;
}

export function cornerMembers(g: Grid): number[] {
  return [0, g.width - 1, g.size - g.width, g.size - 1].sort((a, b) => a - b);
}

export function isConnected(g: Grid, members: number[]): boolean {
  if (members.length <= 1) return true;
  const set = new Set(members);
  const seen = new Set<number>([members[0]]);
  const queue = [members[0]];
  while (queue.length > 0) {
    const i = queue.pop() as number;
    for (const j of neighbors(g, i)) {
      if (set.has(j) && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen.size === set.size;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/grid.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add shared/solver/grid.ts shared/solver/grid.test.ts
git commit -m "feat(solver): grid geometry, 8-way neighbours, and unit membership"
```

---

### Task 2: origHint parser and formatter

**Files:**
- Create: `shared/solver/hint.ts`
- Test: `shared/solver/hint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Trait = 'criminal' | 'innocent'`
  - `type UnitKind = 'row' | 'col' | 'neighbor' | 'between' | 'profession' | 'edge' | 'corner'`
  - `type Unit = { kind: 'row' | 'col'; n: number } | { kind: 'neighbor'; i: number } | { kind: 'between'; a: number; b: number } | { kind: 'profession'; name: string } | { kind: 'edge' } | { kind: 'corner' }`
  - `type HintArg = { t: 'unit'; unit: Unit } | { t: 'kind'; kind: UnitKind } | { t: 'trait'; trait: Trait } | { t: 'num'; n: number } | { t: 'index'; i: number } | { t: 'profession'; name: string }`
  - `interface Hint { pred: string; args: HintArg[] }`
  - `ARG_KINDS: Record<string, ArgKind[]>` where `type ArgKind = 'unit' | 'kind' | 'trait' | 'num' | 'index' | 'profession'` — the signature of every one of the 27 predicates
  - `parseHint(s: string): Hint` — throws `HintParseError` on an unknown predicate or wrong arity
  - `formatHint(h: Hint): string` — inverse of `parseHint`
  - `class HintParseError extends Error`

The signature table is read off the archive's normalized argument shapes. `num` vs `index` matters only for readability — both are integers — but keeping them distinct documents which positions are card indices.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/hint.test.ts
import { describe, expect, it } from 'vitest';
import { ARG_KINDS, formatHint, HintParseError, parseHint } from './hint';

describe('parseHint', () => {
  it('parses a unit with a pair argument', () => {
    expect(parseHint('all_traits_are_neighbors_in_unit(unit(between,pair(0,3)),criminal)')).toEqual({
      pred: 'all_traits_are_neighbors_in_unit',
      args: [
        { t: 'unit', unit: { kind: 'between', a: 0, b: 3 } },
        { t: 'trait', trait: 'criminal' },
      ],
    });
  });

  it('parses bare kinds, numbers and negative direction offsets', () => {
    expect(parseHint('all_units_have_at_least_n_traits(col,innocent,1)').args[0]).toEqual({
      t: 'kind',
      kind: 'col',
    });
    expect(parseHint('n_professions_have_trait_in_dir(cook,innocent,0,-1,1)').args).toEqual([
      { t: 'profession', name: 'cook' },
      { t: 'trait', trait: 'innocent' },
      { t: 'num', n: 0 },
      { t: 'num', n: -1 },
      { t: 'num', n: 1 },
    ]);
  });

  it('parses void-argument units and person indices', () => {
    expect(parseHint('is_one_of_n_traits_in_unit(unit(edge,void),7,innocent,3)').args).toEqual([
      { t: 'unit', unit: { kind: 'edge' } },
      { t: 'index', i: 7 },
      { t: 'trait', trait: 'innocent' },
      { t: 'num', n: 3 },
    ]);
  });

  it('rejects unknown predicates and wrong arity', () => {
    expect(() => parseHint('no_such_predicate(criminal)')).toThrow(HintParseError);
    expect(() => parseHint('number_of_traits(criminal)')).toThrow(HintParseError);
  });
});

describe('formatHint', () => {
  it('round-trips every signature shape', () => {
    for (const s of [
      'has_trait(11,innocent)',
      'number_of_traits(criminal,6)',
      'number_of_traits_in_unit(unit(between,pair(4,7)),innocent,2)',
      'odd_number_of_traits_in_unit(unit(neighbor,12),criminal)',
      'only_one_unit_has_exactly_n_traits(row,criminal,2)',
      'unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,5),unit(row,3),criminal,1,2)',
      'n_t_in_unit_have_trait_in_dir(unit(edge,void),innocent,innocent,1,0,2)',
      'equal_number_of_traits_in_units(unit(profession,cook),unit(profession,cop),innocent)',
    ]) {
      expect(formatHint(parseHint(s))).toBe(s);
    }
  });
});

describe('ARG_KINDS', () => {
  it('covers all 27 predicates', () => {
    expect(Object.keys(ARG_KINDS)).toHaveLength(27);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/hint.test.ts`
Expected: FAIL — cannot resolve `./hint`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/hint.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/hint.test.ts`
Expected: PASS.

- [ ] **Step 5: Add an archive-wide round-trip check and run it**

```ts
// append to shared/solver/hint.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PUZZLES = path.join(process.cwd(), 'puzzles');
const files = readdirSync(PUZZLES).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));

describe('archive round-trip', () => {
  it('parses and re-formats every origHint in the archive identically', () => {
    let count = 0;
    for (const file of files) {
      const puzzle = JSON.parse(readFileSync(path.join(PUZZLES, file), 'utf8'));
      for (const person of puzzle.people) {
        if (!person.origHint) continue;
        expect(formatHint(parseHint(person.origHint)), `${file}: ${person.origHint}`).toBe(
          person.origHint,
        );
        count++;
      }
    }
    expect(count).toBeGreaterThan(600);
  });
});
```

Run: `npx vitest run shared/solver/hint.test.ts`
Expected: PASS with the archive case parsing 640 hints.

- [ ] **Step 6: Commit**

```bash
git add shared/solver/hint.ts shared/solver/hint.test.ts
git commit -m "feat(solver): origHint parser, formatter, and predicate signature table"
```

---

### Task 3: Board model, unit resolution, and the counting predicates

**Files:**
- Create: `shared/solver/predicates.ts`
- Test: `shared/solver/predicates.test.ts`

**Interfaces:**
- Consumes: `Grid`, `makeGrid`, `neighbors`, `segment`, `rowMembers`, `colMembers`, `edgeMembers`, `cornerMembers`, `isConnected`, `offsetIndex` from `./grid`; `Hint`, `HintArg`, `Unit`, `UnitKind`, `Trait` from `./hint`.
- Produces:
  - `interface Board { grid: Grid; professions: string[]; criminal: boolean[] }`
  - `unitMembers(b: Board, u: Unit): number[]` — ascending; `neighbor` excludes its own index
  - `unitsOfKind(b: Board, kind: UnitKind): Unit[]` — every instance of that kind on this board
  - `hasTrait(b: Board, i: number, t: Trait): boolean`
  - `countTrait(b: Board, members: number[], t: Trait): number`
  - `evaluate(b: Board, h: Hint): boolean` — throws `UnknownPredicateError` for a predicate with no evaluator
  - `class UnknownPredicateError extends Error`
  - `EVALUATORS: Record<string, (b: Board, a: HintArg[]) => boolean>` — filled across Tasks 3–5

Tasks 4 and 5 add entries to `EVALUATORS` in this same file and reuse the private arg accessors `argUnit`, `argTrait`, `argNum`, `argIndex`, `argKind`, `argProfession` defined here.

This task implements 9 evaluators: `has_trait`, `number_of_traits`, `number_of_traits_in_unit`, `min_number_of_traits_in_unit`, `odd_number_of_traits_in_unit`, `is_one_of_n_traits_in_unit`, `is_not_only_trait_in_unit`, `all_units_have_at_least_n_traits`, `only_one_unit_has_exactly_n_traits`.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/predicates.test.ts
import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import { type Board, countTrait, evaluate, unitMembers, unitsOfKind } from './predicates';

// 4x5. Criminals at 0, 1, 6, 13, 19.
const CRIMINALS = [0, 1, 6, 13, 19];
const PROFS = [
  'cook', 'cook', 'cop', 'cop',
  'cook', 'cop', 'pilot', 'pilot',
  'pilot', 'pilot', 'cook', 'cop',
  'cook', 'cook', 'cop', 'cop',
  'pilot', 'pilot', 'pilot', 'cook',
];
const board: Board = {
  grid: makeGrid(4, 5),
  professions: PROFS,
  criminal: Array.from({ length: 20 }, (_, i) => CRIMINALS.includes(i)),
};

const ok = (s: string) => evaluate(board, parseHint(s));

describe('unitMembers', () => {
  it('resolves every unit kind', () => {
    expect(unitMembers(board, { kind: 'row', n: 2 })).toEqual([4, 5, 6, 7]);
    expect(unitMembers(board, { kind: 'col', n: 3 })).toEqual([2, 6, 10, 14, 18]);
    expect(unitMembers(board, { kind: 'neighbor', i: 5 })).toEqual([0, 1, 2, 4, 6, 8, 9, 10]);
    expect(unitMembers(board, { kind: 'between', a: 2, b: 14 })).toEqual([2, 6, 10, 14]);
    expect(unitMembers(board, { kind: 'corner' })).toEqual([0, 3, 16, 19]);
    expect(unitMembers(board, { kind: 'profession', name: 'cop' })).toEqual([2, 3, 5, 11, 14, 15]);
  });
});

describe('unitsOfKind', () => {
  it('enumerates instances', () => {
    expect(unitsOfKind(board, 'row')).toHaveLength(5);
    expect(unitsOfKind(board, 'col')).toHaveLength(4);
    expect(unitsOfKind(board, 'neighbor')).toHaveLength(20);
    expect(unitsOfKind(board, 'edge')).toEqual([{ kind: 'edge' }]);
    expect(unitsOfKind(board, 'profession').map((u) => (u as { name: string }).name).sort()).toEqual(
      ['cook', 'cop', 'pilot'],
    );
  });
});

describe('countTrait', () => {
  it('counts both traits over a member list', () => {
    expect(countTrait(board, [0, 1, 2, 3], 'criminal')).toBe(2);
    expect(countTrait(board, [0, 1, 2, 3], 'innocent')).toBe(2);
  });
});

describe('counting predicates', () => {
  it('has_trait', () => {
    expect(ok('has_trait(0,criminal)')).toBe(true);
    expect(ok('has_trait(0,innocent)')).toBe(false);
    expect(ok('has_trait(2,innocent)')).toBe(true);
  });
  it('number_of_traits', () => {
    expect(ok('number_of_traits(criminal,5)')).toBe(true);
    expect(ok('number_of_traits(innocent,15)')).toBe(true);
    expect(ok('number_of_traits(criminal,4)')).toBe(false);
  });
  it('number_of_traits_in_unit', () => {
    expect(ok('number_of_traits_in_unit(unit(row,1),criminal,2)')).toBe(true);
    expect(ok('number_of_traits_in_unit(unit(corner,void),criminal,2)')).toBe(true);
    expect(ok('number_of_traits_in_unit(unit(between,pair(4,7)),criminal,1)')).toBe(true);
  });
  it('min_number_of_traits_in_unit is >=', () => {
    expect(ok('min_number_of_traits_in_unit(unit(row,1),criminal,2)')).toBe(true);
    expect(ok('min_number_of_traits_in_unit(unit(row,1),criminal,1)')).toBe(true);
    expect(ok('min_number_of_traits_in_unit(unit(row,1),criminal,3)')).toBe(false);
  });
  it('odd_number_of_traits_in_unit', () => {
    expect(ok('odd_number_of_traits_in_unit(unit(row,1),criminal)')).toBe(false);
    expect(ok('odd_number_of_traits_in_unit(unit(row,2),criminal)')).toBe(true);
  });
  it('is_one_of_n_traits_in_unit requires membership and the trait', () => {
    expect(ok('is_one_of_n_traits_in_unit(unit(row,1),0,criminal,2)')).toBe(true);
    expect(ok('is_one_of_n_traits_in_unit(unit(row,1),2,criminal,2)')).toBe(false);
    expect(ok('is_one_of_n_traits_in_unit(unit(row,2),0,criminal,2)')).toBe(false);
  });
  it('is_not_only_trait_in_unit', () => {
    expect(ok('is_not_only_trait_in_unit(unit(row,1),0,criminal)')).toBe(true);
    expect(ok('is_not_only_trait_in_unit(unit(row,2),6,criminal)')).toBe(false);
  });
  it('all_units_have_at_least_n_traits ranges over a bare kind', () => {
    expect(ok('all_units_have_at_least_n_traits(row,innocent,2)')).toBe(true);
    expect(ok('all_units_have_at_least_n_traits(row,criminal,1)')).toBe(false);
    expect(ok('all_units_have_at_least_n_traits(col,innocent,2)')).toBe(true);
  });
  it('only_one_unit_has_exactly_n_traits', () => {
    expect(ok('only_one_unit_has_exactly_n_traits(row,criminal,2)')).toBe(true);
    expect(ok('only_one_unit_has_exactly_n_traits(row,criminal,1)')).toBe(false);
    expect(ok('only_one_unit_has_exactly_n_traits(row,criminal,0)')).toBe(true);
  });
});
```

Row criminal counts for this board are `[2, 1, 0, 1, 1]` and column counts are `[1, 2, 1, 1]` — check any new assertion against those.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/predicates.test.ts`
Expected: FAIL — cannot resolve `./predicates`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/predicates.ts
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
```

`isConnected` and `offsetIndex` are imported now and used in Task 5; leave the imports in place.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/predicates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/predicates.ts shared/solver/predicates.test.ts
git commit -m "feat(solver): board model, unit resolution, and counting predicates"
```

---

### Task 4: Unit-comparison predicates

**Files:**
- Modify: `shared/solver/predicates.ts` (add 9 entries to `EVALUATORS`)
- Test: `shared/solver/predicates.test.ts` (add a describe block)

**Interfaces:**
- Consumes: everything Task 3 produced, including the private `argUnit`/`argTrait`/`argNum`/`cnt` helpers in the same file.
- Produces: nine more `EVALUATORS` entries — `more_traits_in_unit_than_unit`, `equal_number_of_traits_in_units`, `more_traits_than_traits_in_unit`, `equal_traits_and_traits_in_unit`, `has_most_traits`, `only_unit_has_exactly_n_traits`, `units_share_n_traits`, `units_share_odd_n_traits`, `unit_shares_n_out_of_n_traits_with_unit`. No new exports.

"Other units of the same kind" for `has_most_traits` and `only_unit_has_exactly_n_traits` means every unit returned by `unitsOfKind(b, u.kind)` that is not equal to `u` — compared by `formatUnit`-style identity, so use `JSON.stringify` on the unit object for equality.

- [ ] **Step 1: Write the failing test**

```ts
// append to shared/solver/predicates.test.ts
describe('comparison predicates', () => {
  it('more_traits_in_unit_than_unit is strict', () => {
    expect(ok('more_traits_in_unit_than_unit(unit(row,1),unit(row,2),criminal)')).toBe(true);
    expect(ok('more_traits_in_unit_than_unit(unit(row,2),unit(row,1),criminal)')).toBe(false);
    expect(ok('more_traits_in_unit_than_unit(unit(row,2),unit(row,4),criminal)')).toBe(false);
  });
  it('equal_number_of_traits_in_units', () => {
    expect(ok('equal_number_of_traits_in_units(unit(row,2),unit(row,4),criminal)')).toBe(true);
    expect(ok('equal_number_of_traits_in_units(unit(row,1),unit(row,2),criminal)')).toBe(false);
  });
  it('more_traits_than_traits_in_unit compares two traits inside one unit', () => {
    expect(ok('more_traits_than_traits_in_unit(unit(row,1),criminal,innocent)')).toBe(false);
    expect(ok('more_traits_than_traits_in_unit(unit(row,3),innocent,criminal)')).toBe(true);
  });
  it('equal_traits_and_traits_in_unit', () => {
    expect(ok('equal_traits_and_traits_in_unit(unit(row,1),criminal,innocent)')).toBe(true);
    expect(ok('equal_traits_and_traits_in_unit(unit(row,2),criminal,innocent)')).toBe(false);
  });
  it('has_most_traits is a strict maximum over the same kind', () => {
    expect(ok('has_most_traits(unit(row,1),criminal)')).toBe(true);
    expect(ok('has_most_traits(unit(row,2),criminal)')).toBe(false);
    expect(ok('has_most_traits(unit(col,2),criminal)')).toBe(true);
  });
  it('only_unit_has_exactly_n_traits', () => {
    expect(ok('only_unit_has_exactly_n_traits(unit(row,1),criminal,2)')).toBe(true);
    expect(ok('only_unit_has_exactly_n_traits(unit(row,2),criminal,1)')).toBe(false);
  });
  it('units_share_n_traits counts the intersection', () => {
    expect(ok('units_share_n_traits(unit(row,1),unit(col,1),criminal,1)')).toBe(true);
    expect(ok('units_share_n_traits(unit(row,1),unit(row,2),criminal,0)')).toBe(true);
  });
  it('units_share_odd_n_traits', () => {
    expect(ok('units_share_odd_n_traits(unit(row,1),unit(col,1),criminal)')).toBe(true);
    expect(ok('units_share_odd_n_traits(unit(row,1),unit(row,2),criminal)')).toBe(false);
  });
  it('unit_shares_n_out_of_n_traits_with_unit constrains total and overlap', () => {
    expect(ok('unit_shares_n_out_of_n_traits_with_unit(unit(row,1),unit(col,1),criminal,1,2)')).toBe(
      true,
    );
    expect(ok('unit_shares_n_out_of_n_traits_with_unit(unit(row,1),unit(col,1),criminal,1,1)')).toBe(
      false,
    );
    expect(ok('unit_shares_n_out_of_n_traits_with_unit(unit(row,1),unit(col,1),criminal,2,2)')).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/predicates.test.ts`
Expected: FAIL — `UnknownPredicateError: more_traits_in_unit_than_unit`.

- [ ] **Step 3: Write the implementation**

Add to the `EVALUATORS` object literal in `shared/solver/predicates.ts`, and add these two helpers above it:

```ts
function sameUnit(a: Unit, b: Unit): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shared(b: Board, a: HintArg[], t: Trait): number {
  const first = new Set(unitMembers(b, argUnit(a, 0)));
  return unitMembers(b, argUnit(a, 1)).filter((i) => first.has(i) && hasTrait(b, i, t)).length;
}
```

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/predicates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/predicates.ts shared/solver/predicates.test.ts
git commit -m "feat(solver): unit-comparison predicates"
```

---

### Task 5: Adjacency and direction predicates

**Files:**
- Modify: `shared/solver/predicates.ts` (add the last 9 `EVALUATORS` entries)
- Test: `shared/solver/predicates.test.ts` (add a describe block)

**Interfaces:**
- Consumes: Task 3's helpers plus `isConnected`, `neighbors`, `offsetIndex` from `./grid`.
- Produces: `max_number_of_traits_in_neighbors_in_unit`, `both_traits_in_unit_are_in_unit`, `only_trait_in_unit_is_in_unit`, `both_traits_are_neighbors_in_unit`, `all_traits_are_neighbors_in_unit`, `only_one_person_in_unit_has_exactly_n_trait_neighbors`, `n_in_unit_have_trait_in_dir`, `n_t_in_unit_have_trait_in_dir`, `n_professions_have_trait_in_dir`. After this task `Object.keys(EVALUATORS)` has 27 entries.

Direction predicates count only people whose offset cell is **on the grid**; an off-grid offset never counts as a match.

- [ ] **Step 1: Write the failing test**

```ts
// append to shared/solver/predicates.test.ts
import { ARG_KINDS } from './hint';
import { EVALUATORS } from './predicates';

describe('adjacency and direction predicates', () => {
  it('covers every predicate in the signature table', () => {
    expect(Object.keys(EVALUATORS).sort()).toEqual(Object.keys(ARG_KINDS).sort());
  });
  it('max_number_of_traits_in_neighbors_in_unit caps every member', () => {
    // row 5 is 16..19; criminal neighbours: 16->0, 17->0, 18->1 (19), 19->1 (nbrs 14,15,18)
    expect(ok('max_number_of_traits_in_neighbors_in_unit(unit(row,5),criminal,1)')).toBe(true);
    expect(ok('max_number_of_traits_in_neighbors_in_unit(unit(row,5),criminal,0)')).toBe(false);
  });
  it('both_traits_are_neighbors_in_unit needs exactly two, adjacent', () => {
    expect(ok('both_traits_are_neighbors_in_unit(unit(row,1),criminal)')).toBe(true);
    expect(ok('both_traits_are_neighbors_in_unit(unit(col,1),criminal)')).toBe(false);
    expect(ok('both_traits_are_neighbors_in_unit(unit(between,pair(0,2)),criminal)')).toBe(true);
  });
  it('all_traits_are_neighbors_in_unit is 8-way connectivity', () => {
    expect(ok('all_traits_are_neighbors_in_unit(unit(row,1),criminal)')).toBe(true);
    expect(ok('all_traits_are_neighbors_in_unit(unit(col,2),criminal)')).toBe(true); // 1 and 13? no
  });
  it('both_traits_in_unit_are_in_unit', () => {
    expect(ok('both_traits_in_unit_are_in_unit(unit(row,1),unit(col,1),criminal)')).toBe(false);
    expect(ok('both_traits_in_unit_are_in_unit(unit(row,1),unit(row,1),criminal)')).toBe(true);
  });
  it('only_trait_in_unit_is_in_unit', () => {
    expect(ok('only_trait_in_unit_is_in_unit(unit(row,2),unit(col,3),criminal)')).toBe(true);
    expect(ok('only_trait_in_unit_is_in_unit(unit(row,1),unit(col,3),criminal)')).toBe(false);
  });
  it('only_one_person_in_unit_has_exactly_n_trait_neighbors', () => {
    // row 1 members 0..3, criminal-neighbour counts: 0->1(1), 1->1(0), 2->1(6), 3->1(6)
    expect(ok('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(row,1),criminal,1)')).toBe(
      false,
    );
    expect(ok('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(row,3),criminal,3)')).toBe(
      false,
    );
  });
  it('n_in_unit_have_trait_in_dir counts on-grid offsets only', () => {
    // corners 0,3,16,19 with an innocent directly to the right: 0->1 criminal (no),
    // 3 off-grid, 16->17 innocent (yes), 19 off-grid.
    expect(ok('n_in_unit_have_trait_in_dir(unit(corner,void),innocent,1,0,1)')).toBe(true);
    expect(ok('n_in_unit_have_trait_in_dir(unit(corner,void),innocent,1,0,2)')).toBe(false);
  });
  it('n_t_in_unit_have_trait_in_dir filters the source by trait too', () => {
    // criminals in row 1 are 0 and 1; to the right: 1 (criminal), 2 (innocent).
    expect(ok('n_t_in_unit_have_trait_in_dir(unit(row,1),criminal,innocent,1,0,1)')).toBe(true);
    expect(ok('n_t_in_unit_have_trait_in_dir(unit(row,1),criminal,criminal,1,0,1)')).toBe(true);
  });
  it('n_professions_have_trait_in_dir ranges over a profession', () => {
    // cooks are 0,1,4,10,12,13,19; directly below each: 4,5,8,14,16,17,off-grid.
    // innocent among those: 4(y),5(y),8(y),14(y),16(y),17(y) -> 6
    expect(ok('n_professions_have_trait_in_dir(cook,innocent,0,1,6)')).toBe(true);
    expect(ok('n_professions_have_trait_in_dir(cook,innocent,0,1,7)')).toBe(false);
  });
});
```

Before writing the implementation, compute each expectation by hand against the fixture board (criminals 0, 1, 6, 13, 19) and fix any assertion that disagrees — the assertions are the specification, so they must be right.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/predicates.test.ts`
Expected: FAIL — `UnknownPredicateError: max_number_of_traits_in_neighbors_in_unit`.

- [ ] **Step 3: Write the implementation**

Add above `EVALUATORS`:

```ts
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
```

Add to `EVALUATORS`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/predicates.test.ts`
Expected: PASS, including the 27-key coverage assertion.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/predicates.ts shared/solver/predicates.test.ts
git commit -m "feat(solver): adjacency and direction predicates; all 27 evaluators"
```

---

### Task 6: Corpus test — evaluator soundness

**Files:**
- Create: `shared/solver/corpus.ts` (archive loading helper)
- Create: `shared/solver/corpus.test.ts`

**Interfaces:**
- Consumes: `Board` from `./predicates`, `validatePuzzle`/`Puzzle` from `../puzzle`.
- Produces:
  - `interface ArchivePuzzle { file: string; puzzle: Puzzle; board: Board }`
  - `loadArchive(): ArchivePuzzle[]` — every `puzzles/YYYY-MM-DD.json`, real puzzles only, boards built from the true solution
  - `isSelfReferential(p: Puzzle, index: number): boolean` — true when card `index`'s own `origHint` references a unit that contains `index` (used by Task 9 to exclude first-person phrasings)

This is the first of the three corpus tests. It fails loudly and specifically if any predicate above was misread.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/corpus.test.ts
import { describe, expect, it } from 'vitest';
import { parseHint } from './hint';
import { evaluate } from './predicates';
import { loadArchive } from './corpus';

const archive = loadArchive();

describe('archive', () => {
  it('loads every real puzzle', () => {
    expect(archive.length).toBeGreaterThanOrEqual(53);
    for (const { file, puzzle } of archive) {
      expect(puzzle.width, file).toBe(4);
      expect(puzzle.height, file).toBe(5);
    }
  });
});

describe('evaluator soundness', () => {
  it('every stored origHint is true of its own puzzle solution', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { file, puzzle, board } of archive) {
      puzzle.people.forEach((person, i) => {
        if (!person.origHint) return;
        checked++;
        if (!evaluate(board, parseHint(person.origHint))) {
          failures.push(`${file} people[${i}]: ${person.origHint}`);
        }
      });
    }
    expect(checked).toBeGreaterThan(600);
    expect(failures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/corpus.test.ts`
Expected: FAIL — cannot resolve `./corpus`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/corpus.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Puzzle, validatePuzzle } from '../puzzle';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import { type Board, unitMembers } from './predicates';

export interface ArchivePuzzle {
  file: string;
  puzzle: Puzzle;
  board: Board;
}

const PUZZLES_DIR = path.join(process.cwd(), 'puzzles');

export function boardFor(puzzle: Puzzle): Board {
  return {
    grid: makeGrid(puzzle.width, puzzle.height),
    professions: puzzle.people.map((p) => p.profession),
    criminal: puzzle.people.map((p) => p.criminal),
  };
}

/** Real (non-Dan) archived puzzles, in date order. */
export function loadArchive(dir: string = PUZZLES_DIR): ArchivePuzzle[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((file) => {
      const puzzle = validatePuzzle(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
      return { file, puzzle, board: boardFor(puzzle) };
    });
}

/** True when card `index` is a member of a unit its own clue talks about — the
 * source phrases these in the first person ("in my row"), which our renderer
 * deliberately does not produce. */
export function isSelfReferential(puzzle: Puzzle, index: number): boolean {
  const origHint = puzzle.people[index].origHint;
  if (!origHint) return false;
  const board = boardFor(puzzle);
  return parseHint(origHint).args.some(
    (a) => a.t === 'unit' && unitMembers(board, a.unit).includes(index),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/corpus.test.ts`
Expected: PASS — 640 hints checked, zero failures.

If any hint evaluates false, that predicate's semantics were misread. Print the failing hints, work out the intended reading from the corresponding `clue` string in `docs/superpowers/specs/2026-08-29-clue-templates.txt`, fix the evaluator in `predicates.ts`, and add a unit test for the corrected reading in `predicates.test.ts` before moving on.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/corpus.ts shared/solver/corpus.test.ts
git commit -m "test(solver): archive corpus proves all 27 evaluators sound"
```

---

### Task 7: Renderer core and the counting-clue templates

**Files:**
- Create: `shared/solver/render.ts`
- Test: `shared/solver/render.test.ts`

**Interfaces:**
- Consumes: `Hint`, `HintArg`, `Trait`, `Unit`, `UnitKind` from `./hint`.
- Produces:
  - `render(h: Hint): string` — the `clue` markup a player sees
  - `class UnsupportedShapeError extends Error` — thrown for a (predicate, unit-kind) combination with no attested template. Candidate enumeration (Task 16) catches this and drops the clue.
  - `RENDERERS: Record<string, (a: HintArg[]) => string>` — filled across Tasks 7–9
  - `canRender(h: Hint): boolean` — `true` iff `render` succeeds

Templates are transcribed from `docs/superpowers/specs/2026-08-29-clue-templates.txt`. Where the source uses several phrasings for one shape, take the **most frequent**; the rest are the known fidelity residue measured in Task 10.

Number and plural rules, systematic across the corpus:
- `n === 0` → "no criminals" (never "exactly 0"; `ClueText`'s prepass rewrites " exactly 0 " to " no ", so emitting "no" directly is what the player sees either way)
- `n === 1` → "only one criminal" / singular verb / singular noun, except in the "Exactly 1 innocent BTW is …" family where the literal numeral is kept
- `n >= 2` → "exactly N criminals" + plural verb

Markup tokens: `#NAME:i`, `#NAMES:i` (possessive), `#PROF:x` (singular), `#PROFS:x` (plural), `#C:n` (1-based column letter), `#BETWEEN:pair(a,b)`.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/render.test.ts
import { describe, expect, it } from 'vitest';
import { parseHint } from './hint';
import { canRender, render, UnsupportedShapeError } from './render';

const r = (s: string) => render(parseHint(s));

describe('counting clue templates', () => {
  it('has_trait', () => {
    expect(r('has_trait(11,innocent)')).toBe('#NAME:11 is innocent');
    expect(r('has_trait(11,criminal)')).toBe('#NAME:11 is a criminal');
  });
  it('number_of_traits', () => {
    expect(r('number_of_traits(criminal,6)')).toBe('There are 6 criminals in total');
  });
  it('number_of_traits_in_unit over a between segment', () => {
    expect(r('number_of_traits_in_unit(unit(between,pair(4,7)),innocent,1)')).toBe(
      'There is only one innocent #BETWEEN:pair(4,7)',
    );
    expect(r('number_of_traits_in_unit(unit(between,pair(4,7)),innocent,3)')).toBe(
      'There are exactly 3 innocents #BETWEEN:pair(4,7)',
    );
    expect(r('number_of_traits_in_unit(unit(between,pair(4,7)),criminal,0)')).toBe(
      'There are no criminals #BETWEEN:pair(4,7)',
    );
  });
  it('number_of_traits_in_unit over neighbours, rows, columns, edges, corners', () => {
    expect(r('number_of_traits_in_unit(unit(neighbor,5),criminal,2)')).toBe(
      '#NAME:5 has exactly 2 criminal neighbors',
    );
    expect(r('number_of_traits_in_unit(unit(neighbor,5),innocent,1)')).toBe(
      '#NAME:5 has only one innocent neighbor',
    );
    expect(r('number_of_traits_in_unit(unit(neighbor,5),criminal,0)')).toBe(
      '#NAME:5 has no criminal neighbors',
    );
    expect(r('number_of_traits_in_unit(unit(row,3),innocent,2)')).toBe(
      'There are exactly 2 innocents in row 3',
    );
    expect(r('number_of_traits_in_unit(unit(col,2),criminal,1)')).toBe(
      'There is only one criminal in column #C:2',
    );
    expect(r('number_of_traits_in_unit(unit(edge,void),innocent,7)')).toBe(
      'There are exactly 7 innocents on the edges',
    );
    expect(r('number_of_traits_in_unit(unit(corner,void),innocent,3)')).toBe(
      'There are exactly 3 innocents in the corners',
    );
  });
  it('min_number_of_traits_in_unit', () => {
    expect(r('min_number_of_traits_in_unit(unit(col,2),innocent,3)')).toBe(
      'There are at least 3 innocents in column #C:2',
    );
    expect(r('min_number_of_traits_in_unit(unit(between,pair(0,3)),innocent,1)')).toBe(
      'There is at least one innocent #BETWEEN:pair(0,3)',
    );
  });
  it('odd_number_of_traits_in_unit', () => {
    expect(r('odd_number_of_traits_in_unit(unit(neighbor,12),innocent)')).toBe(
      "There's an odd number of innocents neighboring #NAME:12",
    );
    expect(r('odd_number_of_traits_in_unit(unit(col,3),criminal)')).toBe(
      "There's an odd number of criminals in column #C:3",
    );
    expect(r('odd_number_of_traits_in_unit(unit(profession,singer),criminal)')).toBe(
      "There's an odd number of criminal #PROFS:singer",
    );
  });
  it('is_one_of_n_traits_in_unit', () => {
    expect(r('is_one_of_n_traits_in_unit(unit(neighbor,9),4,innocent,3)')).toBe(
      '#NAME:4 is one of #NAMES:9 3 innocent neighbors',
    );
    expect(r('is_one_of_n_traits_in_unit(unit(between,pair(0,3)),1,criminal,2)')).toBe(
      '#NAME:1 is one of 2 criminals #BETWEEN:pair(0,3)',
    );
    expect(r('is_one_of_n_traits_in_unit(unit(edge,void),7,innocent,5)')).toBe(
      '#NAME:7 is one of 5 innocents on the edges',
    );
  });
  it('is_not_only_trait_in_unit', () => {
    expect(r('is_not_only_trait_in_unit(unit(row,2),5,innocent)')).toBe(
      '#NAME:5 is one of two or more innocents in row 2',
    );
  });
  it('all_units_have_at_least_n_traits', () => {
    expect(r('all_units_have_at_least_n_traits(col,innocent,2)')).toBe(
      'Each column has at least 2 innocents',
    );
    expect(r('all_units_have_at_least_n_traits(row,innocent,1)')).toBe(
      'Each row has at least one innocent',
    );
    expect(r('all_units_have_at_least_n_traits(profession,criminal,1)')).toBe(
      'There is at least one criminal among all professions',
    );
    expect(r('all_units_have_at_least_n_traits(neighbor,criminal,2)')).toBe(
      'Everyone has at least 2 criminal neighbors',
    );
  });
  it('only_one_unit_has_exactly_n_traits', () => {
    expect(r('only_one_unit_has_exactly_n_traits(row,criminal,2)')).toBe(
      'Only one row has exactly 2 criminals',
    );
    expect(r('only_one_unit_has_exactly_n_traits(col,innocent,1)')).toBe(
      'Only one column has exactly one innocent',
    );
    expect(r('only_one_unit_has_exactly_n_traits(col,criminal,0)')).toBe(
      'Only one column has no criminals',
    );
  });
});

describe('unsupported shapes', () => {
  it('throws rather than inventing a phrasing', () => {
    expect(() => r('number_of_traits_in_unit(unit(profession,cook),innocent,2)')).toThrow(
      UnsupportedShapeError,
    );
    expect(canRender(parseHint('number_of_traits_in_unit(unit(profession,cook),innocent,2)'))).toBe(
      false,
    );
    expect(canRender(parseHint('number_of_traits_in_unit(unit(row,1),innocent,2)'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/render.test.ts`
Expected: FAIL — cannot resolve `./render`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/render.ts
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

/** "no criminals" / "only one criminal" / "exactly 3 criminals" */
function quantity(n: number, t: Trait): string {
  if (n === 0) return `no ${t}s`;
  if (n === 1) return `only one ${t}`;
  return `exactly ${n} ${t}s`;
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
    return `${verb} ${quantity(n, t)} ${where(u)}`;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/render.ts shared/solver/render.test.ts
git commit -m "feat(solver): clue renderer core and counting templates"
```

---

### Task 8: Comparison-clue templates

**Files:**
- Modify: `shared/solver/render.ts` (add 9 entries to `RENDERERS`)
- Test: `shared/solver/render.test.ts` (add a describe block)

**Interfaces:**
- Consumes: everything Task 7 produced, including the private `where`, `quantity`, `bareQuantity`, and arg accessors in the same file.
- Produces: templates for `more_traits_in_unit_than_unit`, `equal_number_of_traits_in_units`, `more_traits_than_traits_in_unit`, `equal_traits_and_traits_in_unit`, `has_most_traits`, `only_unit_has_exactly_n_traits`, `units_share_n_traits`, `units_share_odd_n_traits`, `unit_shares_n_out_of_n_traits_with_unit`. Also produces two new module-private helpers, `predicateTail(u, singular)` and `pairOfSameKind(u1, u2)`.

`predicateTail(u, singular)` is the "…is/are X" side of a two-unit clue: a `neighbor` unit reads possessively (`#NAMES:9 neighbor` / `#NAMES:9 neighbors`), every other kind reuses its locative phrase.

- [ ] **Step 1: Write the failing test**

```ts
// append to shared/solver/render.test.ts
describe('comparison clue templates', () => {
  it('more_traits_in_unit_than_unit', () => {
    expect(r('more_traits_in_unit_than_unit(unit(neighbor,3),unit(neighbor,9),criminal)')).toBe(
      '#NAME:3 has more criminal neighbors than #NAME:9',
    );
    expect(r('more_traits_in_unit_than_unit(unit(row,1),unit(row,4),innocent)')).toBe(
      'There are more innocents in row 1 than row 4',
    );
    expect(r('more_traits_in_unit_than_unit(unit(col,1),unit(col,3),criminal)')).toBe(
      'There are more criminals in column #C:1 than column #C:3',
    );
    expect(
      r('more_traits_in_unit_than_unit(unit(profession,cook),unit(profession,cop),criminal)'),
    ).toBe('There are more criminal #PROFS:cook than criminal #PROFS:cop');
  });
  it('equal_number_of_traits_in_units', () => {
    expect(r('equal_number_of_traits_in_units(unit(neighbor,3),unit(neighbor,9),criminal)')).toBe(
      '#NAME:3 and #NAME:9 have an equal number of criminal neighbors',
    );
    expect(r('equal_number_of_traits_in_units(unit(row,1),unit(row,4),innocent)')).toBe(
      "There's an equal number of innocents in rows 1 and 4",
    );
    expect(r('equal_number_of_traits_in_units(unit(col,1),unit(col,3),criminal)')).toBe(
      "There's an equal number of criminals in columns #C:1 and #C:3",
    );
    expect(
      r('equal_number_of_traits_in_units(unit(profession,cook),unit(profession,cop),innocent)'),
    ).toBe('There are as many innocent #PROFS:cook as there are innocent #PROFS:cop');
  });
  it('more_traits_than_traits_in_unit', () => {
    expect(r('more_traits_than_traits_in_unit(unit(between,pair(0,3)),innocent,criminal)')).toBe(
      'There are more innocents than criminals #BETWEEN:pair(0,3)',
    );
    expect(r('more_traits_than_traits_in_unit(unit(neighbor,5),criminal,innocent)')).toBe(
      '#NAME:5 has more criminal than innocent neighbors',
    );
  });
  it('equal_traits_and_traits_in_unit', () => {
    expect(r('equal_traits_and_traits_in_unit(unit(between,pair(0,3)),criminal,innocent)')).toBe(
      'There are as many criminals as innocents #BETWEEN:pair(0,3)',
    );
    expect(r('equal_traits_and_traits_in_unit(unit(profession,cop),innocent,criminal)')).toBe(
      "There's an equal number of innocent and criminal #PROFS:cop",
    );
  });
  it('has_most_traits', () => {
    expect(r('has_most_traits(unit(col,2),criminal)')).toBe(
      'Column #C:2 has more criminals than any other column',
    );
    expect(r('has_most_traits(unit(row,3),innocent)')).toBe(
      'Row 3 has more innocents than any other row',
    );
    expect(r('has_most_traits(unit(neighbor,7),innocent)')).toBe(
      '#NAME:7 has the most innocent neighbors',
    );
  });
  it('only_unit_has_exactly_n_traits', () => {
    expect(r('only_unit_has_exactly_n_traits(unit(row,2),innocent,3)')).toBe(
      'Row 2 is the only row with exactly 3 innocents',
    );
    expect(r('only_unit_has_exactly_n_traits(unit(col,4),criminal,1)')).toBe(
      'Column #C:4 is the only column with exactly one criminal',
    );
    expect(() => r('only_unit_has_exactly_n_traits(unit(neighbor,4),criminal,1)')).toThrow(
      UnsupportedShapeError,
    );
  });
  it('units_share_n_traits', () => {
    expect(r('units_share_n_traits(unit(neighbor,3),unit(neighbor,9),innocent,1)')).toBe(
      '#NAME:3 and #NAME:9 have only one innocent neighbor in common',
    );
    expect(r('units_share_n_traits(unit(neighbor,3),unit(neighbor,9),innocent,2)')).toBe(
      '#NAME:3 and #NAME:9 have 2 innocent neighbors in common',
    );
    expect(r('units_share_n_traits(unit(between,pair(0,3)),unit(neighbor,9),innocent,1)')).toBe(
      'Exactly 1 innocent #BETWEEN:pair(0,3) is neighboring #NAME:9',
    );
    expect(r('units_share_n_traits(unit(between,pair(0,3)),unit(neighbor,9),innocent,2)')).toBe(
      'Exactly 2 innocents #BETWEEN:pair(0,3) are neighboring #NAME:9',
    );
    expect(r('units_share_n_traits(unit(between,pair(0,3)),unit(row,2),innocent,0)')).toBe(
      'No innocent #BETWEEN:pair(0,3) is in row 2',
    );
  });
  it('units_share_odd_n_traits', () => {
    expect(r('units_share_odd_n_traits(unit(between,pair(0,3)),unit(neighbor,9),innocent)')).toBe(
      'An odd number of innocents #BETWEEN:pair(0,3) neighbor #NAME:9',
    );
    expect(r('units_share_odd_n_traits(unit(neighbor,9),unit(row,2),innocent)')).toBe(
      'An odd number of innocents in row 2 neighbor #NAME:9',
    );
    expect(() => r('units_share_odd_n_traits(unit(row,1),unit(row,2),innocent)')).toThrow(
      UnsupportedShapeError,
    );
  });
  it('unit_shares_n_out_of_n_traits_with_unit', () => {
    expect(
      r('unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,5),unit(between,pair(0,3)),criminal,1,3)'),
    ).toBe('Only 1 of the 3 criminals neighboring #NAME:5 is #BETWEEN:pair(0,3)');
    expect(
      r('unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,5),unit(neighbor,9),criminal,1,2)'),
    ).toBe('Only 1 of the 2 criminals neighboring #NAME:5 is #NAMES:9 neighbor');
    expect(
      r('unit_shares_n_out_of_n_traits_with_unit(unit(edge,void),unit(neighbor,9),criminal,2,5)'),
    ).toBe('Exactly 2 of the 5 criminals on the edges are #NAMES:9 neighbors');
    expect(
      r('unit_shares_n_out_of_n_traits_with_unit(unit(neighbor,5),unit(row,3),criminal,2,4)'),
    ).toBe('Exactly 2 of the 4 criminals neighboring #NAME:5 are in row 3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/render.test.ts`
Expected: FAIL — `UnsupportedShapeError: more_traits_in_unit_than_unit`.

- [ ] **Step 3: Write the implementation**

Add these helpers above `RENDERERS` in `shared/solver/render.ts`:

```ts
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
```

Add to `RENDERERS`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/render.ts shared/solver/render.test.ts
git commit -m "feat(solver): comparison clue templates"
```

---

### Task 9: Adjacency and direction clue templates

**Files:**
- Modify: `shared/solver/render.ts` (add the last 9 `RENDERERS` entries)
- Test: `shared/solver/render.test.ts` (add a describe block)

**Interfaces:**
- Consumes: Task 7's `where`, `wherePerson`, `dirPhrase`, `article`, `predicateTail` from Task 8, and the arg accessors.
- Produces: templates for `max_number_of_traits_in_neighbors_in_unit`, `both_traits_in_unit_are_in_unit`, `only_trait_in_unit_is_in_unit`, `both_traits_are_neighbors_in_unit`, `all_traits_are_neighbors_in_unit`, `only_one_person_in_unit_has_exactly_n_trait_neighbors`, `n_in_unit_have_trait_in_dir`, `n_t_in_unit_have_trait_in_dir`, `n_professions_have_trait_in_dir`. After this task `Object.keys(RENDERERS)` has 27 entries.

- [ ] **Step 1: Write the failing test**

```ts
// append to shared/solver/render.test.ts
import { ARG_KINDS } from './hint';
import { RENDERERS } from './render';

describe('adjacency and direction clue templates', () => {
  it('covers every predicate', () => {
    expect(Object.keys(RENDERERS).sort()).toEqual(Object.keys(ARG_KINDS).sort());
  });
  it('max_number_of_traits_in_neighbors_in_unit', () => {
    expect(r('max_number_of_traits_in_neighbors_in_unit(unit(row,2),innocent,3)')).toBe(
      'No one in row 2 has more than 3 innocent neighbors',
    );
    expect(r('max_number_of_traits_in_neighbors_in_unit(unit(corner,void),innocent,1)')).toBe(
      'No one in the corners has more than one innocent neighbor',
    );
  });
  it('both_traits_in_unit_are_in_unit', () => {
    expect(
      r('both_traits_in_unit_are_in_unit(unit(between,pair(0,3)),unit(neighbor,9),criminal)'),
    ).toBe('Both criminals #BETWEEN:pair(0,3) are #NAMES:9 neighbors');
    expect(
      r('both_traits_in_unit_are_in_unit(unit(neighbor,5),unit(neighbor,9),innocent)'),
    ).toBe('Both innocents neighboring #NAME:5 are #NAMES:9 neighbors');
  });
  it('only_trait_in_unit_is_in_unit', () => {
    expect(r('only_trait_in_unit_is_in_unit(unit(row,2),unit(neighbor,9),criminal)')).toBe(
      'The only criminal in row 2 is #NAMES:9 neighbor',
    );
    expect(
      r('only_trait_in_unit_is_in_unit(unit(between,pair(0,3)),unit(between,pair(4,7)),criminal)'),
    ).toBe('The only criminal #BETWEEN:pair(0,3) is #BETWEEN:pair(4,7)');
  });
  it('both_traits_are_neighbors_in_unit and all_traits_are_neighbors_in_unit', () => {
    expect(r('both_traits_are_neighbors_in_unit(unit(between,pair(0,3)),innocent)')).toBe(
      'Both innocents #BETWEEN:pair(0,3) are connected',
    );
    expect(r('all_traits_are_neighbors_in_unit(unit(between,pair(0,3)),criminal)')).toBe(
      'All criminals #BETWEEN:pair(0,3) are connected',
    );
  });
  it('only_one_person_in_unit_has_exactly_n_trait_neighbors', () => {
    expect(r('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(row,2),innocent,3)')).toBe(
      'Only one person in row 2 has exactly 3 innocent neighbors',
    );
    expect(
      r('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(corner,void),criminal,0)'),
    ).toBe('Only one person in a corner has no criminal neighbors');
    expect(
      r('only_one_person_in_unit_has_exactly_n_trait_neighbors(unit(profession,mech),criminal,2)'),
    ).toBe('Only one #PROF:mech has exactly 2 criminal neighbors');
  });
  it('n_in_unit_have_trait_in_dir', () => {
    expect(r('n_in_unit_have_trait_in_dir(unit(profession,cook),criminal,1,0,1)')).toBe(
      'Only one #PROF:cook has a criminal directly to the right of them',
    );
    expect(r('n_in_unit_have_trait_in_dir(unit(corner,void),criminal,0,1,2)')).toBe(
      '2 persons in a corner have a criminal directly below them',
    );
    expect(r('n_in_unit_have_trait_in_dir(unit(edge,void),criminal,0,-1,3)')).toBe(
      '3 persons on the edges have a criminal directly above them',
    );
    expect(r('n_in_unit_have_trait_in_dir(unit(profession,builder),innocent,0,-1,2)')).toBe(
      '2 #PROFS:builder have an innocent directly above them',
    );
  });
  it('n_t_in_unit_have_trait_in_dir', () => {
    expect(r('n_t_in_unit_have_trait_in_dir(unit(row,2),criminal,criminal,0,1,2)')).toBe(
      'Exactly 2 criminals in row 2 have a criminal directly below them',
    );
    expect(r('n_t_in_unit_have_trait_in_dir(unit(row,2),criminal,innocent,1,0,1)')).toBe(
      'One criminal in row 2 has an innocent directly to the right of them',
    );
  });
  it('n_professions_have_trait_in_dir', () => {
    expect(r('n_professions_have_trait_in_dir(painter,innocent,1,0,2)')).toBe(
      '2 #PROFS:painter have an innocent directly to the right of them',
    );
    expect(r('n_professions_have_trait_in_dir(cook,innocent,-1,0,1)')).toBe(
      'Exactly 1 #PROF:cook has an innocent directly to the left of them',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/render.test.ts`
Expected: FAIL — `UnsupportedShapeError: max_number_of_traits_in_neighbors_in_unit`.

- [ ] **Step 3: Write the implementation**

Add this helper above `RENDERERS`:

```ts
/** Subject phrase for direction clues: "3 persons on the edges" / "2 #PROFS:cook". */
function dirSubject(u: Unit, n: number): string {
  if (u.kind === 'profession') {
    return n === 1 ? `Only one ${prof(u.name)}` : `${n} ${profs(u.name)}`;
  }
  return n === 1 ? `Only one person ${wherePerson(u)}` : `${n} persons ${wherePerson(u)}`;
}
```

Add to `RENDERERS`:

```ts
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
    const head = n === 1 ? `One ${t1}` : `Exactly ${n} ${t1}s`;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/render.test.ts`
Expected: PASS, including the 27-key coverage assertion.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/render.ts shared/solver/render.test.ts
git commit -m "feat(solver): adjacency and direction clue templates; all 27 renderers"
```

---

### Task 10: Corpus test — renderer fidelity

**Files:**
- Modify: `shared/solver/corpus.test.ts` (add a describe block)
- Create: `shared/solver/__snapshots__/corpus.test.ts.snap` (generated by Vitest)

**Interfaces:**
- Consumes: `loadArchive`, `isSelfReferential` from `./corpus`; `render`, `canRender`, `UnsupportedShapeError` from `./render`; `parseHint` from `./hint`.
- Produces: no new exports. Establishes the measured fidelity number and pins the mismatch residue in a snapshot.

The source bakes first-person phrasings into some stored clues ("in my row", "I'm the only innocent guard"). Those clue cards are members of a unit their own clue references; `isSelfReferential` detects them and this test excludes them from the ratio. The generator is forbidden from producing that arrangement (Global Constraints), so exact round-tripping of generated clues is unaffected.

- [ ] **Step 1: Write the failing test**

```ts
// append to shared/solver/corpus.test.ts
import { isSelfReferential } from './corpus';
import { canRender, render } from './render';

describe('renderer fidelity', () => {
  it('reproduces at least 95% of non-self-referential archive clues exactly', () => {
    const mismatches: string[] = [];
    let comparable = 0;
    let selfReferential = 0;
    let unsupported = 0;

    for (const { file, puzzle } of archive) {
      puzzle.people.forEach((person, i) => {
        if (!person.origHint || !person.clue) return;
        if (isSelfReferential(puzzle, i)) {
          selfReferential++;
          return;
        }
        const hint = parseHint(person.origHint);
        if (!canRender(hint)) {
          unsupported++;
          return;
        }
        comparable++;
        const got = render(hint);
        if (got !== person.clue) {
          mismatches.push(`${file} [${i}] ${person.origHint}\n  want: ${person.clue}\n  got:  ${got}`);
        }
      });
    }

    const ratio = (comparable - mismatches.length) / comparable;
    console.log(
      `fidelity ${(ratio * 100).toFixed(1)}% of ${comparable} comparable ` +
        `(${selfReferential} self-referential, ${unsupported} unsupported shapes)`,
    );
    expect(ratio).toBeGreaterThanOrEqual(0.95);
    expect(mismatches.sort()).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test and read the numbers**

Run: `npx vitest run shared/solver/corpus.test.ts`
Expected: it prints the fidelity percentage and writes a snapshot on first run.

If the ratio is below 95%, group the mismatches by predicate and fix the templates that account for the most instances — the templates file lists the frequency of every phrasing, so switching a template to the more frequent variant is a mechanical fix. Re-run until the ratio clears 95%. Then `npx vitest run -u shared/solver/corpus.test.ts` to refresh the snapshot.

Do not lower the 0.95 threshold to make the test pass.

- [ ] **Step 3: Record the measured numbers in the plan's sibling spec**

Append a short "Measured fidelity" note to `docs/superpowers/specs/2026-08-29-dan-puzzle-generator-design.md` under "Verification strategy" with the actual percentage, comparable count, self-referential count, and unsupported-shape count printed by the test.

- [ ] **Step 4: Commit**

```bash
git add shared/solver/corpus.test.ts shared/solver/__snapshots__ docs/superpowers/specs/2026-08-29-dan-puzzle-generator-design.md
git commit -m "test(solver): measure renderer fidelity against the archive"
```

---

### Task 11: Assignment enumeration and forcing

**Files:**
- Create: `shared/solver/enumerate.ts`
- Modify: `shared/solver/predicates.ts` (add a unit-member cache to `Board`)
- Test: `shared/solver/enumerate.test.ts`

**Interfaces:**
- Consumes: `Grid` from `./grid`; `Board`, `evaluate` from `./predicates`; `Hint` from `./hint`.
- Produces:
  - `interface Shape { grid: Grid; professions: string[] }`
  - `type Known = (boolean | null)[]` — `null` = unknown, `true` = criminal
  - `maskOf(criminal: boolean[]): number` / `criminalOf(mask: number, size: number): boolean[]`
  - `allMasks(shape: Shape, known: Known): Uint32Array` — every assignment agreeing with `known`
  - `filterMasks(shape: Shape, masks: Uint32Array, hints: Hint[]): Uint32Array`
  - `survivors(shape: Shape, known: Known, hints: Hint[]): Uint32Array`
  - `forcedFromMasks(masks: Uint32Array, size: number): Known` — AND/OR reduction
  - `class ContradictionError extends Error` — thrown by `forcedFromMasks` on an empty survivor set
- Also modifies `Board` to `{ grid; professions; criminal; cache?: Map<string, number[]> }` and adds `makeBoard(grid, professions, criminal): Board`. The cache makes the 2^20 inner loop allocation-free for unit membership; without it a full enumeration pass takes tens of seconds.

An assignment is a 20-bit mask: bit `i` set means person `i` is a criminal.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/enumerate.test.ts
import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import {
  type Shape,
  ContradictionError,
  allMasks,
  criminalOf,
  filterMasks,
  forcedFromMasks,
  maskOf,
  survivors,
} from './enumerate';

const shape: Shape = {
  grid: makeGrid(4, 5),
  professions: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 'cook' : 'cop')),
};
const unknown = () => Array.from({ length: 20 }, () => null) as (boolean | null)[];

describe('mask conversion', () => {
  it('round-trips', () => {
    const criminal = Array.from({ length: 20 }, (_, i) => i === 0 || i === 19);
    expect(maskOf(criminal)).toBe((1 << 0) | (1 << 19));
    expect(criminalOf(maskOf(criminal), 20)).toEqual(criminal);
  });
});

describe('allMasks', () => {
  it('enumerates the whole space when nothing is known', () => {
    expect(allMasks(shape, unknown()).length).toBe(2 ** 20);
  });
  it('fixes known cards', () => {
    const known = unknown();
    known[0] = true;
    known[1] = false;
    const masks = allMasks(shape, known);
    expect(masks.length).toBe(2 ** 18);
    for (const m of masks) {
      expect(m & 1).toBe(1);
      expect(m & 2).toBe(0);
    }
  });
});

describe('filterMasks', () => {
  it('keeps only assignments satisfying every hint', () => {
    const hints = [parseHint('number_of_traits(criminal,20)')];
    const out = filterMasks(shape, allMasks(shape, unknown()), hints);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(2 ** 20 - 1);
  });
  it('runs a full-space pass in reasonable time', () => {
    const started = Date.now();
    const out = survivors(shape, unknown(), [parseHint('number_of_traits(criminal,5)')]);
    expect(out.length).toBe(15504); // C(20,5)
    expect(Date.now() - started).toBeLessThan(20000);
  });
});

describe('forcedFromMasks', () => {
  it('marks cards that agree across every survivor', () => {
    const known = unknown();
    const out = survivors(shape, known, [
      parseHint('number_of_traits_in_unit(unit(row,1),criminal,4)'),
      parseHint('number_of_traits_in_unit(unit(row,5),criminal,0)'),
    ]);
    const forced = forcedFromMasks(out, 20);
    expect(forced.slice(0, 4)).toEqual([true, true, true, true]);
    expect(forced.slice(16, 20)).toEqual([false, false, false, false]);
    expect(forced[8]).toBeNull();
  });
  it('throws on an unsatisfiable clue set', () => {
    const out = survivors(shape, unknown(), [
      parseHint('number_of_traits(criminal,3)'),
      parseHint('number_of_traits(criminal,4)'),
    ]);
    expect(() => forcedFromMasks(out, 20)).toThrow(ContradictionError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/enumerate.test.ts`
Expected: FAIL — cannot resolve `./enumerate`.

- [ ] **Step 3: Add the unit-member cache to `predicates.ts`**

Three edits to `shared/solver/predicates.ts`. First, add an optional cache to the `Board` interface, after `criminal`:

```ts
  /** Memoises unit membership; safe because membership depends only on grid and
   * professions, never on `criminal`. */
  cache?: Map<string, number[]>;
```

Second, rename the existing `export function unitMembers` to `function computeUnitMembers` — drop the `export`, change only the name, leave its body exactly as Task 3 wrote it.

Third, add a caching wrapper and a constructor beneath it:

```ts
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
```

Callers are unaffected: boards built as plain object literals (as every earlier test does) simply skip the cache.

Also update `boardFor` in `shared/solver/corpus.ts` to call `makeBoard`.

- [ ] **Step 4: Write `enumerate.ts`**

```ts
// shared/solver/enumerate.ts
import type { Grid } from './grid';
import type { Hint } from './hint';
import { type Board, evaluate, makeBoard } from './predicates';

export interface Shape {
  grid: Grid;
  professions: string[];
}

export type Known = (boolean | null)[];

export class ContradictionError extends Error {}

export function maskOf(criminal: boolean[]): number {
  let mask = 0;
  for (let i = 0; i < criminal.length; i++) if (criminal[i]) mask |= 1 << i;
  return mask;
}

export function criminalOf(mask: number, size: number): boolean[] {
  return Array.from({ length: size }, (_, i) => (mask & (1 << i)) !== 0);
}

export function allMasks(shape: Shape, known: Known): Uint32Array {
  const size = shape.grid.size;
  let base = 0;
  const free: number[] = [];
  for (let i = 0; i < size; i++) {
    if (known[i] === true) base |= 1 << i;
    else if (known[i] === null || known[i] === undefined) free.push(i);
  }
  const out = new Uint32Array(1 << free.length);
  for (let combo = 0; combo < out.length; combo++) {
    let mask = base;
    for (let k = 0; k < free.length; k++) if (combo & (1 << k)) mask |= 1 << free[k];
    out[combo] = mask;
  }
  return out;
}

export function filterMasks(shape: Shape, masks: Uint32Array, hints: Hint[]): Uint32Array {
  const size = shape.grid.size;
  const criminal = new Array<boolean>(size).fill(false);
  const board: Board = makeBoard(shape.grid, shape.professions, criminal);
  let current = masks;
  for (const hint of hints) {
    let write = 0;
    for (let read = 0; read < current.length; read++) {
      const mask = current[read];
      for (let i = 0; i < size; i++) criminal[i] = (mask & (1 << i)) !== 0;
      if (evaluate(board, hint)) current[write++] = mask;
    }
    current = current.subarray(0, write);
  }
  return current;
}

export function survivors(shape: Shape, known: Known, hints: Hint[]): Uint32Array {
  return filterMasks(shape, allMasks(shape, known), hints);
}

export function forcedFromMasks(masks: Uint32Array, size: number): Known {
  if (masks.length === 0) throw new ContradictionError('no assignment satisfies the clue set');
  let and = -1;
  let or = 0;
  for (let k = 0; k < masks.length; k++) {
    and &= masks[k];
    or |= masks[k];
  }
  return Array.from({ length: size }, (_, i) => {
    if (and & (1 << i)) return true;
    if (!(or & (1 << i))) return false;
    return null;
  });
}
```

`filterMasks` writes back into the array it was given, so callers must not hold on to the pre-filter view. `survivors` always allocates a fresh array via `allMasks`, so it is safe to call repeatedly.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run shared/solver/enumerate.test.ts shared/solver/predicates.test.ts shared/solver/corpus.test.ts`
Expected: PASS. Note the wall time of the full-space test; if it exceeds ~10s, the unit-member cache is not being used — check that `makeBoard` (not an object literal) builds the board in `filterMasks`.

- [ ] **Step 6: Commit**

```bash
git add shared/solver/enumerate.ts shared/solver/enumerate.test.ts shared/solver/predicates.ts shared/solver/corpus.ts
git commit -m "feat(solver): exhaustive assignment enumeration and forced-card queries"
```

---

### Task 12: Solve chain, unique solvability, and minimal paths

**Files:**
- Create: `shared/solver/solve.ts`
- Test: `shared/solver/solve.test.ts`

**Interfaces:**
- Consumes: `Shape`, `Known`, `survivors`, `forcedFromMasks`, `maskOf` from `./enumerate`; `Hint` from `./hint`; `HintStep` from `../puzzle`.
- Produces:
  - `type Clues = (Hint | null)[]` — indexed by card; `null` = a flavour card
  - `knownFrom(truth: boolean[], flipped: number[]): Known`
  - `activeHints(clues: Clues, flipped: number[]): Hint[]` — the clues on flipped cards
  - `forcedGiven(shape: Shape, clues: Clues, truth: boolean[], flipped: number[]): Known`
  - `isUniquelySolvable(shape: Shape, clues: Clues, truth: boolean[]): boolean` — one survivor under every clue, nothing else known
  - `interface Chain { steps: HintStep[]; solvedAll: boolean; revealedAt: (number | null)[] }` — `revealedAt[i]` is the step number at which card `i` became known, `null` if never
  - `solveChain(shape: Shape, clues: Clues, truth: boolean[], initialReveals: number[]): Chain`
  - `minimalPaths(shape: Shape, clues: Clues, truth: boolean[], index: number, flipped: number[], attempts?: number): number[][]` — distinct minimal sufficient subsets of `flipped` that still force `index`

Flipping a card reveals both its identity and its clue, so `flipped` drives `known` and `activeHints` together. `initialReveals` are already flipped at step 0.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/solve.test.ts
import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { type Shape } from './enumerate';
import { type Clues, parseClues, isUniquelySolvable, minimalPaths, solveChain } from './solve';
import { parseHint } from './hint';

const shape: Shape = {
  grid: makeGrid(4, 5),
  professions: Array.from({ length: 20 }, () => 'cook'),
};
// Truth: criminals at 0 and 1 only.
const truth = Array.from({ length: 20 }, (_, i) => i < 2);

function clues(entries: Record<number, string>): Clues {
  const out: Clues = Array.from({ length: 20 }, () => null);
  for (const [i, s] of Object.entries(entries)) out[Number(i)] = parseHint(s);
  return out;
}

describe('isUniquelySolvable', () => {
  it('is true when the clue set pins exactly one assignment', () => {
    const c = clues({
      0: 'number_of_traits(criminal,2)',
      2: 'number_of_traits_in_unit(unit(between,pair(0,1)),criminal,2)',
      3: 'number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)',
    });
    expect(isUniquelySolvable(shape, c, truth)).toBe(true);
  });
  it('is false when clues leave several assignments open', () => {
    expect(isUniquelySolvable(shape, clues({ 0: 'number_of_traits(criminal,2)' }), truth)).toBe(
      false,
    );
  });
});

describe('solveChain', () => {
  it('reveals cards step by step from the initial reveals', () => {
    const c = clues({
      0: 'number_of_traits_in_unit(unit(row,1),criminal,2)',
      1: 'number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)',
    });
    const chain = solveChain(shape, c, truth, [0]);
    expect(chain.steps.length).toBeGreaterThan(0);
    expect(chain.steps[0].flipped).toEqual([0]);
    expect(chain.solvedAll).toBe(false); // row-1 clue alone cannot finish the grid
    expect(chain.revealedAt[0]).toBe(0);
  });
  it('reports solvedAll when every card is reached', () => {
    const c = clues({
      0: 'number_of_traits(criminal,2)',
      1: 'number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)',
    });
    const chain = solveChain(shape, c, truth, [0]);
    expect(chain.solvedAll).toBe(true);
    expect(chain.revealedAt.every((s) => s !== null)).toBe(true);
  });
});

describe('minimalPaths', () => {
  it('drops flipped cards that were not needed', () => {
    const c = clues({
      0: 'number_of_traits(criminal,2)',
      1: 'number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)',
      2: 'number_of_traits_in_unit(unit(row,3),criminal,0)',
    });
    const paths = minimalPaths(shape, c, truth, 19, [0, 1, 2], 4);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toContain(1); // the clue on card 1 is what forces 19
      expect(path).not.toContain(2); // card 2's clue is irrelevant to card 19
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/solve.test.ts`
Expected: FAIL — cannot resolve `./solve`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/solve.ts
import type { HintStep } from '../puzzle';
import { type Known, type Shape, forcedFromMasks, survivors } from './enumerate';
import { type Hint, parseHint } from './hint';

export type Clues = (Hint | null)[];

/** Convenience for tests and scripts: origHint strings -> Clues. */
export function parseClues(origHints: (string | null)[]): Clues {
  return origHints.map((s) => (s === null ? null : parseHint(s)));
}

export function knownFrom(truth: boolean[], flipped: number[]): Known {
  const known: Known = truth.map(() => null);
  for (const i of flipped) known[i] = truth[i];
  return known;
}

export function activeHints(clues: Clues, flipped: number[]): Hint[] {
  const out: Hint[] = [];
  for (const i of flipped) {
    const hint = clues[i];
    if (hint) out.push(hint);
  }
  return out;
}

export function forcedGiven(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  flipped: number[],
): Known {
  const masks = survivors(shape, knownFrom(truth, flipped), activeHints(clues, flipped));
  return forcedFromMasks(masks, shape.grid.size);
}

export function isUniquelySolvable(shape: Shape, clues: Clues, truth: boolean[]): boolean {
  const all = clues.flatMap((h) => (h ? [h] : []));
  const masks = survivors(
    shape,
    truth.map(() => null),
    all,
  );
  return masks.length === 1;
}

export interface Chain {
  steps: HintStep[];
  solvedAll: boolean;
  revealedAt: (number | null)[];
}

export function solveChain(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  initialReveals: number[],
): Chain {
  const size = shape.grid.size;
  const revealedAt: (number | null)[] = truth.map(() => null);
  for (const i of initialReveals) revealedAt[i] = 0;
  let flipped = [...initialReveals].sort((a, b) => a - b);
  const steps: HintStep[] = [];

  for (let step = 1; flipped.length < size; step++) {
    const forced = forcedGiven(shape, clues, truth, flipped);
    const reveals: number[] = [];
    for (let i = 0; i < size; i++) {
      if (revealedAt[i] === null && forced[i] !== null) {
        reveals.push(i);
        revealedAt[i] = step;
      }
    }
    if (reveals.length === 0) break;
    steps.push({
      flipped: [...flipped],
      clues: flipped.filter((i) => clues[i] !== null),
      reveals,
    });
    flipped = [...flipped, ...reveals].sort((a, b) => a - b);
  }

  return { steps, solvedAll: flipped.length === size, revealedAt };
}

function forces(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  index: number,
  flipped: number[],
): boolean {
  if (flipped.includes(index)) return true;
  return forcedGiven(shape, clues, truth, flipped)[index] !== null;
}

/** Distinct minimal subsets of `flipped` that still force `index`. Greedy drop
 * over several shuffles; every result is genuinely sufficient. */
export function minimalPaths(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  index: number,
  flipped: number[],
  attempts = 3,
): number[][] {
  if (!forces(shape, clues, truth, index, flipped)) return [];
  const found = new Map<string, number[]>();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const order = [...flipped];
    // Deterministic per-attempt rotation instead of a random shuffle, so results
    // are reproducible without threading an RNG through the solver.
    for (let k = 0; k < attempt; k++) order.push(order.shift() as number);
    let current = [...flipped];
    for (const candidate of order) {
      const trial = current.filter((i) => i !== candidate);
      if (forces(shape, clues, truth, index, trial)) current = trial;
    }
    const path = [...current].sort((a, b) => a - b);
    found.set(path.join(','), path);
  }
  return [...found.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/solve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/solve.ts shared/solver/solve.test.ts
git commit -m "feat(solver): solve chain, unique solvability, and minimal paths"
```

---

### Task 13: Corpus test — solver agreement

**Files:**
- Modify: `shared/solver/corpus.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `loadArchive` from `./corpus`; `isUniquelySolvable`, `forcedGiven`, `parseClues` from `./solve`; `Shape` from `./enumerate`.
- Produces: nothing new. This is the fairness proof — if our notion of "forced" agrees with the source's on 53 real puzzles, generated puzzles inherit the guarantee.

This test enumerates 2^20 assignments per puzzle plus one enumeration per checked `paths` entry, so it is slow. Give it a generous per-test timeout and keep it in the same file as the other corpus tests.

- [ ] **Step 1: Write the failing test**

```ts
// append to shared/solver/corpus.test.ts
import type { Shape } from './enumerate';
import { forcedGiven, isUniquelySolvable, parseClues } from './solve';
import { makeGrid } from './grid';

function shapeOf(puzzle: (typeof archive)[number]['puzzle']): Shape {
  return {
    grid: makeGrid(puzzle.width, puzzle.height),
    professions: puzzle.people.map((p) => p.profession),
  };
}

describe('solver agreement', () => {
  it('every archived puzzle is uniquely solvable under its full clue set', { timeout: 600_000 }, () => {
    const failures: string[] = [];
    for (const { file, puzzle } of archive) {
      const clues = parseClues(puzzle.people.map((p) => p.origHint));
      const truth = puzzle.people.map((p) => p.criminal);
      if (!isUniquelySolvable(shapeOf(puzzle), clues, truth)) failures.push(file);
    }
    expect(failures).toEqual([]);
  });

  it('every stored path is genuinely sufficient', { timeout: 600_000 }, () => {
    const failures: string[] = [];
    for (const { file, puzzle } of archive) {
      const shape = shapeOf(puzzle);
      const clues = parseClues(puzzle.people.map((p) => p.origHint));
      const truth = puzzle.people.map((p) => p.criminal);
      puzzle.people.forEach((person, i) => {
        if (person.paths === null) return;
        for (const path of person.paths) {
          if (path.includes(i)) continue; // trivially known once flipped
          if (forcedGiven(shape, clues, truth, path)[i] === null) {
            failures.push(`${file} [${i}] path ${path.join(',')}`);
          }
        }
      });
    }
    expect(failures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run shared/solver/corpus.test.ts`
Expected: PASS, slowly (minutes).

If a puzzle is not uniquely solvable, the clue set is being under-constrained by a misread predicate — cross-check that puzzle's clues against `predicates.ts` and fix the evaluator. If a stored path is insufficient, our forcing notion is *stricter* than the source's; before weakening anything, print the failing case and check whether the source path relies on a card being flipped rather than deduced. Record whatever you find in the spec's "Verification strategy" section.

- [ ] **Step 3: Commit**

```bash
git add shared/solver/corpus.test.ts
git commit -m "test(solver): archive agreement on unique solvability and path sufficiency"
```

---

### Task 14: Difficulty metrics and archive calibration

**Files:**
- Create: `shared/solver/difficulty.ts`
- Create: `scripts/calibrate.mts`
- Create: `config/difficulty.json` (produced by running the script)
- Test: `shared/solver/difficulty.test.ts`

**Interfaces:**
- Consumes: `Shape` from `./enumerate`; `Clues`, `solveChain` from `./solve`; `loadArchive` from `./corpus`.
- Produces:
  - `interface Metrics { criminals: number; clueCards: number; chainLength: number; meanRevealsPerStep: number; maxRevealsPerStep: number; meanPathSize: number; maxPathSize: number; predicateMix: Record<string, number> }`
  - `measure(input: { shape: Shape; clues: Clues; truth: boolean[]; initialReveals: number[]; paths: (number[][] | null)[] }): Metrics`
  - `interface Band { min: number; max: number }`
  - `interface LabelBand { samples: number; criminals: Band; clueCards: Band; chainLength: Band; meanRevealsPerStep: Band; meanPathSize: Band }`
  - `type Bands = Record<string, LabelBand>`
  - `buildBands(samples: { label: string; metrics: Metrics }[], minSamples?: number): Bands` — default `minSamples` 3; throws `InsufficientSamplesError` when a label has fewer
  - `gatesPass(band: LabelBand, m: Metrics): boolean` — checks **only** `chainLength`, `meanRevealsPerStep`, `meanPathSize`. `criminals` and `clueCards` are sampled before generation, not gated after; `predicateMix` is reported and never gated.
  - `class InsufficientSamplesError extends Error`

Path size is measured as the **shortest** stored path per card, averaged over cards that have at least one non-empty path. Cards with `paths: null` (always deducible) and cards with `paths: []` (initial reveals) are skipped.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/difficulty.test.ts
import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import type { Clues } from './solve';
import {
  type Metrics,
  InsufficientSamplesError,
  buildBands,
  gatesPass,
  measure,
} from './difficulty';

const shape = { grid: makeGrid(4, 5), professions: Array.from({ length: 20 }, () => 'cook') };
const truth = Array.from({ length: 20 }, (_, i) => i < 2);
const clues: Clues = Array.from({ length: 20 }, () => null);
clues[0] = parseHint('number_of_traits(criminal,2)');
clues[1] = parseHint('number_of_traits_in_unit(unit(between,pair(2,19)),criminal,0)');

const paths: (number[][] | null)[] = Array.from({ length: 20 }, () => [[0, 1]]);
paths[0] = [];

describe('measure', () => {
  it('reports counts, chain shape, and predicate mix', () => {
    const m = measure({ shape, clues, truth, initialReveals: [0], paths });
    expect(m.criminals).toBe(2);
    expect(m.clueCards).toBe(2);
    expect(m.chainLength).toBeGreaterThan(0);
    expect(m.meanRevealsPerStep).toBeGreaterThan(0);
    expect(m.meanPathSize).toBe(2);
    expect(m.maxPathSize).toBe(2);
    expect(m.predicateMix).toEqual({
      number_of_traits: 1,
      number_of_traits_in_unit: 1,
    });
  });
});

const metrics = (over: Partial<Metrics>): Metrics => ({
  criminals: 5,
  clueCards: 8,
  chainLength: 6,
  meanRevealsPerStep: 2,
  maxRevealsPerStep: 4,
  meanPathSize: 3,
  maxPathSize: 5,
  predicateMix: {},
  ...over,
});

describe('buildBands', () => {
  it('takes min and max per label', () => {
    const bands = buildBands([
      { label: 'Easy', metrics: metrics({ chainLength: 4 }) },
      { label: 'Easy', metrics: metrics({ chainLength: 6 }) },
      { label: 'Easy', metrics: metrics({ chainLength: 9 }) },
    ]);
    expect(bands.Easy.samples).toBe(3);
    expect(bands.Easy.chainLength).toEqual({ min: 4, max: 9 });
    expect(bands.Easy.criminals).toEqual({ min: 5, max: 5 });
  });
  it('refuses to invent a band from too few samples', () => {
    expect(() => buildBands([{ label: 'Brutal', metrics: metrics({}) }])).toThrow(
      InsufficientSamplesError,
    );
  });
});

describe('gatesPass', () => {
  const band = buildBands([
    { label: 'Easy', metrics: metrics({ chainLength: 4, meanPathSize: 2 }) },
    { label: 'Easy', metrics: metrics({ chainLength: 6, meanPathSize: 3 }) },
    { label: 'Easy', metrics: metrics({ chainLength: 9, meanPathSize: 4 }) },
  ]).Easy;

  it('accepts in-band solve shape', () => {
    expect(gatesPass(band, metrics({ chainLength: 5, meanPathSize: 3 }))).toBe(true);
  });
  it('rejects out-of-band solve shape', () => {
    expect(gatesPass(band, metrics({ chainLength: 12 }))).toBe(false);
    expect(gatesPass(band, metrics({ meanPathSize: 9 }))).toBe(false);
  });
  it('ignores criminal count, which is sampled rather than gated', () => {
    expect(gatesPass(band, metrics({ criminals: 99 }))).toBe(true);
    expect(gatesPass(band, metrics({ clueCards: 99 }))).toBe(false);
  });
});

describe('loadBands', () => {
  const band = buildBands([
    { label: 'Easy', metrics: metrics({}) },
    { label: 'Easy', metrics: metrics({}) },
    { label: 'Easy', metrics: metrics({}) },
  ]).Easy;

  it('accepts a well-formed bands object', () => {
    expect(loadBands({ Easy: band })).toEqual({ Easy: band });
  });
  it('rejects a band missing a metric or with a reversed range', () => {
    const { meanPathSize, ...missing } = band;
    expect(() => loadBands({ Easy: missing })).toThrow(/meanPathSize/);
    expect(() => loadBands({ Easy: { ...band, chainLength: { min: 9, max: 2 } } })).toThrow(
      /chainLength/,
    );
  });
});
```

Import `loadBands` alongside the others at the top of this test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/difficulty.test.ts`
Expected: FAIL — cannot resolve `./difficulty`.

- [ ] **Step 3: Write `difficulty.ts`**

```ts
// shared/solver/difficulty.ts
import type { Shape } from './enumerate';
import { type Clues, solveChain } from './solve';

export interface Metrics {
  criminals: number;
  clueCards: number;
  chainLength: number;
  meanRevealsPerStep: number;
  maxRevealsPerStep: number;
  meanPathSize: number;
  maxPathSize: number;
  predicateMix: Record<string, number>;
}

export interface MeasureInput {
  shape: Shape;
  clues: Clues;
  truth: boolean[];
  initialReveals: number[];
  paths: (number[][] | null)[];
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const max = (xs: number[]) => (xs.length === 0 ? 0 : Math.max(...xs));

export function measure(input: MeasureInput): Metrics {
  const chain = solveChain(input.shape, input.clues, input.truth, input.initialReveals);
  const revealCounts = chain.steps.map((s) => s.reveals.length);

  const shortest: number[] = [];
  for (const paths of input.paths) {
    if (paths === null) continue;
    const sizes = paths.filter((p) => p.length > 0).map((p) => p.length);
    if (sizes.length > 0) shortest.push(Math.min(...sizes));
  }

  const predicateMix: Record<string, number> = {};
  for (const hint of input.clues) {
    if (!hint) continue;
    predicateMix[hint.pred] = (predicateMix[hint.pred] ?? 0) + 1;
  }

  return {
    criminals: input.truth.filter(Boolean).length,
    clueCards: input.clues.filter((c) => c !== null).length,
    chainLength: chain.steps.length,
    meanRevealsPerStep: mean(revealCounts),
    maxRevealsPerStep: max(revealCounts),
    meanPathSize: mean(shortest),
    maxPathSize: max(shortest),
    predicateMix,
  };
}

export interface Band {
  min: number;
  max: number;
}

export interface LabelBand {
  samples: number;
  criminals: Band;
  clueCards: Band;
  chainLength: Band;
  meanRevealsPerStep: Band;
  meanPathSize: Band;
}

export type Bands = Record<string, LabelBand>;

export class InsufficientSamplesError extends Error {}

const BANDED = [
  'criminals',
  'clueCards',
  'chainLength',
  'meanRevealsPerStep',
  'meanPathSize',
] as const;

/** Metrics that gate a generated puzzle after the fact. The criminal count is
 * sampled from its band before generation, so it is not re-checked here. */
const GATED = ['clueCards', 'chainLength', 'meanRevealsPerStep', 'meanPathSize'] as const;

function bandOf(values: number[]): Band {
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function buildBands(
  samples: { label: string; metrics: Metrics }[],
  minSamples = 3,
): Bands {
  const byLabel = new Map<string, Metrics[]>();
  for (const { label, metrics } of samples) {
    const list = byLabel.get(label) ?? [];
    list.push(metrics);
    byLabel.set(label, list);
  }
  const bands: Bands = {};
  for (const [label, list] of byLabel) {
    if (list.length < minSamples) {
      throw new InsufficientSamplesError(
        `${label}: ${list.length} sample(s), need at least ${minSamples}`,
      );
    }
    const band = { samples: list.length } as LabelBand;
    for (const key of BANDED) band[key] = bandOf(list.map((m) => m[key]));
    bands[label] = band;
  }
  return bands;
}

export function gatesPass(band: LabelBand, m: Metrics): boolean {
  return GATED.every((key) => m[key] >= band[key].min && m[key] <= band[key].max);
}

export class BandsFormatError extends Error {}

/** Validate a parsed `config/difficulty.json` into `Bands`. */
export function loadBands(data: unknown): Bands {
  if (typeof data !== 'object' || data === null) throw new BandsFormatError('bands is not an object');
  const bands: Bands = {};
  for (const [label, raw] of Object.entries(data as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) throw new BandsFormatError(`${label}: not an object`);
    const r = raw as Record<string, unknown>;
    if (!Number.isInteger(r.samples)) throw new BandsFormatError(`${label}.samples must be an integer`);
    const band = { samples: r.samples as number } as LabelBand;
    for (const key of BANDED) {
      const b = r[key] as Band | undefined;
      if (!b || typeof b.min !== 'number' || typeof b.max !== 'number') {
        throw new BandsFormatError(`${label}.${key} must be {min, max}`);
      }
      if (b.min > b.max) throw new BandsFormatError(`${label}.${key} has min > max`);
      band[key] = { min: b.min, max: b.max };
    }
    bands[label] = band;
  }
  return bands;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/difficulty.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `scripts/calibrate.mts`**

```ts
// scripts/calibrate.mts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadArchive } from '../shared/solver/corpus.ts';
import { buildBands, measure } from '../shared/solver/difficulty.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { parseClues } from '../shared/solver/solve.ts';

const archive = loadArchive();
const samples: { label: string; metrics: ReturnType<typeof measure> }[] = [];

for (const { file, puzzle } of archive) {
  const metrics = measure({
    shape: { grid: makeGrid(puzzle.width, puzzle.height), professions: puzzle.people.map((p) => p.profession) },
    clues: parseClues(puzzle.people.map((p) => p.origHint)),
    truth: puzzle.people.map((p) => p.criminal),
    initialReveals: puzzle.initialReveals,
    paths: puzzle.people.map((p) => p.paths),
  });
  console.log(
    `${file} ${puzzle.difficulty}: chain=${metrics.chainLength} ` +
      `reveals/step=${metrics.meanRevealsPerStep.toFixed(2)} path=${metrics.meanPathSize.toFixed(2)}`,
  );
  samples.push({ label: puzzle.difficulty, metrics });
}

// A label with fewer than 3 archived puzzles gets no band at all. Dates carrying
// that label are reported as failures by scripts/generate.mts rather than being
// generated against a band invented from one or two samples.
const counts = new Map<string, number>();
for (const s of samples) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
const usable = samples.filter((s) => (counts.get(s.label) as number) >= 3);
for (const [label, n] of counts) {
  if (n < 3) console.warn(`skipping ${label}: only ${n} sample(s)`);
}

const bands = buildBands(usable);
const out = path.join(process.cwd(), 'config', 'difficulty.json');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(bands, null, 2) + '\n');
console.log(`wrote ${out} for ${Object.keys(bands).length} labels`);
```

- [ ] **Step 6: Run the calibration**

Run: `npx tsx scripts/calibrate.mts`
Expected: one line per archived puzzle, then `wrote .../config/difficulty.json`. This enumerates the assignment space once per solve step across 53 puzzles, so expect it to take tens of minutes. Let it finish; it runs once.

Read `config/difficulty.json` afterwards and sanity-check that harder labels have longer chains or larger path sizes than easier ones. If they do not, say so plainly in the commit message rather than adjusting the numbers.

- [ ] **Step 7: Add the npm script**

In `package.json`, after the `manifest` entry:

```json
    "calibrate": "tsx scripts/calibrate.mts"
```

- [ ] **Step 8: Commit**

```bash
git add shared/solver/difficulty.ts shared/solver/difficulty.test.ts scripts/calibrate.mts config/difficulty.json package.json
git commit -m "feat(solver): difficulty metrics and archive-calibrated bands"
```

---

### Task 15: Original vocabulary

**Files:**
- Create: `shared/solver/vocab.ts`
- Test: `shared/solver/vocab.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface VocabPerson { name: string; gender: 'male' | 'female' }`
  - `NAMES: VocabPerson[]` — at least 40 entries, all distinct
  - `interface VocabProfession { key: string; male: string; female: string }`
  - `PROFESSIONS: VocabProfession[]` — professions from the shipped face map, each pluralising with a plain `-s`
  - `TITLES: string[]` — at least 20 original puzzle titles
  - `FLAVOUR: string[]` — at least 30 original lines for cards with no clue
  - `faceOf(profession: string, gender: 'male' | 'female'): string`

`site/src/clue/ClueText.tsx` pluralises a profession as `word + 's'` (special-casing only `witch`), so every profession here must be regular. `site/src/faces.ts` prefers `person.face` when present, so generated people carry their emoji directly and `shared/` never imports from `site/`.

Titles and flavour lines are **written fresh for this repo**. Do not copy any string from `puzzles/*.json`.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/vocab.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAVOUR, NAMES, PROFESSIONS, TITLES, faceOf } from './vocab';

describe('vocab', () => {
  it('has enough distinct material to fill a 20-card grid', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(NAMES.map((n) => n.name)).size).toBe(NAMES.length);
    expect(PROFESSIONS.length).toBeGreaterThanOrEqual(10);
    expect(TITLES.length).toBeGreaterThanOrEqual(20);
    expect(FLAVOUR.length).toBeGreaterThanOrEqual(30);
  });
  it('uses only regularly pluralising professions', () => {
    for (const p of PROFESSIONS) {
      expect(p.key, `${p.key} does not pluralise with a plain -s`).toMatch(/[^sxz]$/);
      expect(p.key).not.toMatch(/(ch|sh)$/);
    }
  });
  it('gives every profession a face for both genders', () => {
    for (const p of PROFESSIONS) {
      expect(faceOf(p.key, 'male')).toBe(p.male);
      expect(faceOf(p.key, 'female')).toBe(p.female);
    }
  });
});

describe('originality', () => {
  it('shares no title or flavour line with the scraped archive', () => {
    const dir = path.join(process.cwd(), 'puzzles');
    const scraped = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
      const puzzle = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      scraped.add(puzzle.title.trim().toLowerCase());
      for (const person of puzzle.people) {
        if (person.clue && !person.origHint) scraped.add(person.clue.trim().toLowerCase());
      }
    }
    for (const t of TITLES) expect(scraped.has(t.trim().toLowerCase()), t).toBe(false);
    for (const f of FLAVOUR) expect(scraped.has(f.trim().toLowerCase()), f).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/vocab.test.ts`
Expected: FAIL — cannot resolve `./vocab`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/vocab.ts
export interface VocabPerson {
  name: string;
  gender: 'male' | 'female';
}

export interface VocabProfession {
  key: string;
  male: string;
  female: string;
}

export const NAMES: VocabPerson[] = [
  { name: 'Ada', gender: 'female' }, { name: 'Bram', gender: 'male' },
  { name: 'Cleo', gender: 'female' }, { name: 'Desmond', gender: 'male' },
  { name: 'Elin', gender: 'female' }, { name: 'Fabio', gender: 'male' },
  { name: 'Greta', gender: 'female' }, { name: 'Hugo', gender: 'male' },
  { name: 'Ines', gender: 'female' }, { name: 'Jonas', gender: 'male' },
  { name: 'Kira', gender: 'female' }, { name: 'Lorenzo', gender: 'male' },
  { name: 'Mira', gender: 'female' }, { name: 'Nils', gender: 'male' },
  { name: 'Odette', gender: 'female' }, { name: 'Piet', gender: 'male' },
  { name: 'Quinn', gender: 'female' }, { name: 'Rafael', gender: 'male' },
  { name: 'Suri', gender: 'female' }, { name: 'Tomas', gender: 'male' },
  { name: 'Ulla', gender: 'female' }, { name: 'Viktor', gender: 'male' },
  { name: 'Wren', gender: 'female' }, { name: 'Xavi', gender: 'male' },
  { name: 'Yara', gender: 'female' }, { name: 'Zeno', gender: 'male' },
  { name: 'Anouk', gender: 'female' }, { name: 'Boris', gender: 'male' },
  { name: 'Carys', gender: 'female' }, { name: 'Dmitri', gender: 'male' },
  { name: 'Esme', gender: 'female' }, { name: 'Ferran', gender: 'male' },
  { name: 'Golda', gender: 'female' }, { name: 'Hamish', gender: 'male' },
  { name: 'Iris', gender: 'female' }, { name: 'Janko', gender: 'male' },
  { name: 'Katia', gender: 'female' }, { name: 'Lucian', gender: 'male' },
  { name: 'Maud', gender: 'female' }, { name: 'Novak', gender: 'male' },
  { name: 'Orla', gender: 'female' }, { name: 'Pavel', gender: 'male' },
  { name: 'Rosa', gender: 'female' }, { name: 'Stefan', gender: 'male' },
];

/** Keys and emoji taken from the profession face map the site already ships
 * (`site/src/faces.ts`); each pluralises with a plain -s. */
export const PROFESSIONS: VocabProfession[] = [
  { key: 'cop', male: '👮‍♂️', female: '👮‍♀️' },
  { key: 'sleuth', male: '🕵️‍♂️', female: '🕵️‍♀️' },
  { key: 'guard', male: '💂‍♂️', female: '💂‍♀️' },
  { key: 'builder', male: '👷‍♂️', female: '👷‍♀️' },
  { key: 'farmer', male: '👨‍🌾', female: '👩‍🌾' },
  { key: 'cook', male: '👨‍🍳', female: '👩‍🍳' },
  { key: 'doctor', male: '👨‍⚕️', female: '👩‍⚕️' },
  { key: 'clerk', male: '👨‍💼', female: '👩‍💼' },
  { key: 'coder', male: '👨‍💻', female: '👩‍💻' },
  { key: 'singer', male: '👨‍🎤', female: '👩‍🎤' },
  { key: 'teacher', male: '👨‍🏫', female: '👩‍🏫' },
  { key: 'painter', male: '👨‍🎨', female: '👩‍🎨' },
  { key: 'pilot', male: '👨‍✈️', female: '👩‍✈️' },
  { key: 'judge', male: '👨‍⚖️', female: '👩‍⚖️' },
  { key: 'mech', male: '👨‍🔧', female: '👩‍🔧' },
  { key: 'student', male: '👨‍🎓', female: '👩‍🎓' },
];

export function faceOf(profession: string, gender: 'male' | 'female'): string {
  const entry = PROFESSIONS.find((p) => p.key === profession);
  if (!entry) return '😬';
  return gender === 'female' ? entry.female : entry.male;
}

export const TITLES: string[] = [
  'The Lantern Street Lineup',
  'Twenty Faces, Five Lies',
  'A Quiet Morning at the Depot',
  'Nobody Left the Courtyard',
  'The Ferry Was Late',
  'Someone Signed the Ledger Twice',
  'Four Rows, One Confession',
  'The Greenhouse Roster',
  'Names Called at Dawn',
  'The Second Shift',
  'Everyone Says They Were Reading',
  'A Draft in the Archive Room',
  'The Bell Rang Anyway',
  'Chalk Marks on the Platform',
  'Whose Coat Is on the Hook',
  'The Corner Table Knows',
  'Nine Alibis and a Gap',
  'Sunday Inventory',
  'The Stairwell Census',
  'One Story Does Not Fit',
  'The Kettle Was Still Warm',
  'Line Up by the Fence',
];

export const FLAVOUR: string[] = [
  'I was tying my shoelace the whole time.',
  "Don't look at me, I only work weekends.",
  'I have nothing useful to add, sorry.',
  'Ask someone with a better view.',
  'I was facing the other way.',
  'My glasses were in my pocket.',
  'I heard something, but that is all.',
  'I keep out of other people’s business.',
  'You will have to ask the others.',
  'I lost track of everyone after lunch.',
  'It was too loud to notice anything.',
  'I had my hands full at the time.',
  'I only just got here myself.',
  'I never remember faces.',
  'I was counting crates, not people.',
  'Somebody moved my chair, that is all I know.',
  'I would rather not guess.',
  'Nothing to report from where I stood.',
  'I was halfway out the door.',
  'My shift had already ended.',
  'I was looking for my keys.',
  'The window was fogged over.',
  'I stepped outside for some air.',
  'I was on the phone with my sister.',
  'Everyone looks the same in that light.',
  'I did not check the clock once.',
  'I stayed where I was told to stay.',
  'I was reading the noticeboard.',
  'I had a headache and closed my eyes.',
  'The kettle needed watching.',
  'I was sorting the post.',
  'I could not hear a thing over the fan.',
];
```

If the originality test flags any title or flavour line as matching the archive, rewrite that line — do not delete the assertion.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/vocab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/vocab.ts shared/solver/vocab.test.ts
git commit -m "feat(solver): original names, professions, titles, and flavour lines"
```

---

### Task 16: Candidate clue enumeration

**Files:**
- Create: `shared/solver/candidates.ts`
- Test: `shared/solver/candidates.test.ts`

**Interfaces:**
- Consumes: `Board`, `unitMembers`, `unitsOfKind`, `countTrait`, `hasTrait`, `evaluate` from `./predicates`; `neighbors`, `offsetIndex`, `segment` from `./grid`; `Hint`, `Unit`, `Trait` from `./hint`; `canRender` from `./render`.
- Produces:
  - `candidateUnits(b: Board): Unit[]` — every row, column, `edge`, `corner`, `neighbor(i)`, `profession(p)`, and every `between` segment of length ≥ 2
  - `candidateHints(b: Board): Hint[]` — every clue instance **true** of `b`'s assignment whose shape also renders, deduplicated by `formatHint`
  - `referencedCards(b: Board, h: Hint): Set<number>` — every card the clue talks about: members of each unit argument, plus any bare index argument

Two-unit predicates are restricted to pairs where at least one side is a `neighbor` or `between` unit. That matches the archive (the only counterexamples are self-referential clues, which the generator may not produce anyway) and keeps the candidate pool to a few tens of thousands instead of hundreds of thousands.

`referencedCards` implements the Global Constraint that a clue card must not be a member of any unit its clue references.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/candidates.test.ts
import { describe, expect, it } from 'vitest';
import { makeGrid } from './grid';
import { formatHint, parseHint } from './hint';
import { makeBoard, evaluate } from './predicates';
import { canRender } from './render';
import { candidateHints, candidateUnits, referencedCards } from './candidates';

const board = makeBoard(
  makeGrid(4, 5),
  Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? 'cook' : i % 3 === 1 ? 'cop' : 'pilot')),
  Array.from({ length: 20 }, (_, i) => [0, 1, 6, 13, 19].includes(i)),
);

describe('candidateUnits', () => {
  it('includes every kind, and between segments only along a row or column', () => {
    const units = candidateUnits(board);
    const kinds = new Set(units.map((u) => u.kind));
    expect(kinds).toEqual(new Set(['row', 'col', 'neighbor', 'between', 'profession', 'edge', 'corner']));
    const betweens = units.filter((u) => u.kind === 'between');
    expect(betweens.length).toBe(70); // 5 rows * C(4,2) + 4 cols * C(5,2)
    for (const u of betweens) {
      expect((u as { a: number; b: number }).a).toBeLessThan((u as { a: number; b: number }).b);
    }
  });
});

describe('candidateHints', () => {
  const hints = candidateHints(board);

  it('produces a large pool covering many predicates', () => {
    expect(hints.length).toBeGreaterThan(500);
    expect(new Set(hints.map((h) => h.pred)).size).toBeGreaterThanOrEqual(20);
  });
  it('every candidate is true of the board and renders', () => {
    for (const h of hints) {
      expect(evaluate(board, h), formatHint(h)).toBe(true);
      expect(canRender(h), formatHint(h)).toBe(true);
    }
  });
  it('contains no duplicates', () => {
    const strings = hints.map(formatHint);
    expect(new Set(strings).size).toBe(strings.length);
  });
});

describe('referencedCards', () => {
  it('collects unit members and bare indices', () => {
    expect([...referencedCards(board, parseHint('number_of_traits_in_unit(unit(row,2),criminal,1)'))].sort(
      (a, b) => a - b,
    )).toEqual([4, 5, 6, 7]);
    expect(referencedCards(board, parseHint('has_trait(11,innocent)'))).toEqual(new Set([11]));
    expect(referencedCards(board, parseHint('is_one_of_n_traits_in_unit(unit(neighbor,5),1,criminal,2)'))).toContain(
      1,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/candidates.test.ts`
Expected: FAIL — cannot resolve `./candidates`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/candidates.ts
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
      push('has_most_traits', [u(unit), t(trait)]);
      push('only_unit_has_exactly_n_traits', [u(unit), t(trait), n(c)]);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/candidates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/candidates.ts shared/solver/candidates.test.ts
git commit -m "feat(solver): enumerate every true, renderable clue for an assignment"
```

---

### Task 17: Puzzle generator

**Files:**
- Create: `shared/solver/generate.ts`
- Test: `shared/solver/generate.test.ts`

**Interfaces:**
- Consumes: `candidateHints`, `referencedCards` from `./candidates`; `makeBoard` from `./predicates`; `render` from `./render`; `formatHint` from `./hint`; `solveChain`, `isUniquelySolvable`, `minimalPaths`, `type Clues` from `./solve`; `measure`, `gatesPass`, `type LabelBand`, `type Metrics` from `./difficulty`; `NAMES`, `PROFESSIONS`, `TITLES`, `FLAVOUR`, `faceOf` from `./vocab`; `Puzzle`, `validatePuzzle` from `../puzzle`; `makeGrid` from `./grid`.
- Produces:
  - `makeRng(seed: number): () => number` — mulberry32, deterministic
  - `interface GenerateInput { date: string; difficulty: string; band: LabelBand; seed: number; maxAttempts?: number; trialsPerStep?: number }`
  - `interface GenerateResult { puzzle: Puzzle; seed: number; attempt: number; metrics: Metrics }`
  - `generatePuzzle(input: GenerateInput): GenerateResult`
  - `class GenerationError extends Error`

**Deviation from the spec, stated deliberately:** the spec sampled the clue-card count before generation. The chain determines how many clue cards a puzzle ends up with, so the count cannot be fixed in advance without distorting the chain. Instead `criminals` is sampled from the band and `clueCards` is gated after the fact — Task 14 already lists it in `GATED` for this reason.

Generation is deterministic in `seed`: the same seed and band always produce the same puzzle.

- [ ] **Step 1: Write the failing test**

```ts
// shared/solver/generate.test.ts
import { describe, expect, it } from 'vitest';
import { validatePuzzle } from '../puzzle';
import type { LabelBand } from './difficulty';
import { makeGrid } from './grid';
import { parseHint } from './hint';
import { render } from './render';
import { isUniquelySolvable, parseClues, solveChain } from './solve';
import { generatePuzzle, makeRng } from './generate';

// Wide bands: this test proves the machinery works, not that it hits a target.
const band: LabelBand = {
  samples: 10,
  criminals: { min: 4, max: 7 },
  clueCards: { min: 4, max: 16 },
  chainLength: { min: 2, max: 19 },
  meanRevealsPerStep: { min: 1, max: 8 },
  meanPathSize: { min: 1, max: 12 },
};

describe('makeRng', () => {
  it('is deterministic and in range', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    for (let i = 0; i < 5; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('generatePuzzle', () => {
  const result = generatePuzzle({ date: '2026-01-01', difficulty: 'Medium', band, seed: 1 });
  const puzzle = result.puzzle;

  it('produces a valid, uniquely solvable, fully chained puzzle', () => {
    expect(() => validatePuzzle(puzzle)).not.toThrow();
    expect(puzzle.variant).toBe('dan');
    expect(puzzle.date).toBe('2026-01-01');
    expect(puzzle.difficulty).toBe('Medium');
    const shape = {
      grid: makeGrid(puzzle.width, puzzle.height),
      professions: puzzle.people.map((p) => p.profession),
    };
    const clues = parseClues(puzzle.people.map((p) => p.origHint));
    const truth = puzzle.people.map((p) => p.criminal);
    expect(isUniquelySolvable(shape, clues, truth)).toBe(true);
    expect(solveChain(shape, clues, truth, puzzle.initialReveals).solvedAll).toBe(true);
  });

  it('round-trips every generated clue exactly', () => {
    for (const person of puzzle.people) {
      if (!person.origHint) continue;
      expect(render(parseHint(person.origHint))).toBe(person.clue);
    }
  });

  it('never puts a clue on a card the clue talks about', () => {
    // Enforced by construction; assert on the rendered markup, which names cards.
    puzzle.people.forEach((person, i) => {
      if (!person.clue) return;
      expect(person.clue).not.toContain(`#NAME:${i}`);
      expect(person.clue).not.toContain(`#NAMES:${i}`);
    });
  });

  it('gives every non-initial card at least one sufficient path', () => {
    puzzle.people.forEach((person, i) => {
      if (puzzle.initialReveals.includes(i)) return;
      expect(person.paths, `people[${i}]`).not.toBeNull();
      expect((person.paths as number[][]).length).toBeGreaterThan(0);
    });
  });

  it('reproduces exactly from its seed', () => {
    const again = generatePuzzle({ date: '2026-01-01', difficulty: 'Medium', band, seed: 1 });
    expect(again.puzzle).toEqual(puzzle);
  });

  it('uses only original titles and flavour text', () => {
    expect(puzzle.source).toBe('generated');
    for (const person of puzzle.people) {
      if (person.origHint === null) expect(person.clue).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/solver/generate.test.ts`
Expected: FAIL — cannot resolve `./generate`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/solver/generate.ts
import { type Person, type Puzzle, validatePuzzle } from '../puzzle';
import { candidateHints, referencedCards } from './candidates';
import { type LabelBand, type Metrics, gatesPass, measure } from './difficulty';
import type { Shape } from './enumerate';
import { makeGrid } from './grid';
import { type Hint, formatHint } from './hint';
import { makeBoard } from './predicates';
import { render } from './render';
import { type Clues, forcedGiven, isUniquelySolvable, minimalPaths, solveChain } from './solve';
import { FLAVOUR, NAMES, PROFESSIONS, TITLES, faceOf } from './vocab';

const WIDTH = 4;
const HEIGHT = 5;
const SIZE = WIDTH * HEIGHT;

export class GenerationError extends Error {}

/** mulberry32 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));

function shuffled<T>(rng: () => number, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface GenerateInput {
  date: string;
  difficulty: string;
  band: LabelBand;
  seed: number;
  maxAttempts?: number;
  trialsPerStep?: number;
}

export interface GenerateResult {
  puzzle: Puzzle;
  seed: number;
  attempt: number;
  metrics: Metrics;
}

function hexId(rng: () => number): string {
  let out = '';
  for (let i = 0; i < 12; i++) out += Math.floor(rng() * 16).toString(16);
  return out;
}

interface Cast {
  names: string[];
  genders: ('male' | 'female')[];
  professions: string[];
  faces: string[];
}

function castOf(rng: () => number): Cast {
  const people = shuffled(rng, NAMES).slice(0, SIZE);
  const chosen = shuffled(rng, PROFESSIONS).slice(0, 5);
  const slots: string[] = [];
  for (let i = 0; i < SIZE; i++) slots.push(chosen[i % chosen.length].key);
  const professions = shuffled(rng, slots);
  return {
    names: people.map((p) => p.name),
    genders: people.map((p) => p.gender),
    professions,
    faces: professions.map((key, i) => faceOf(key, people[i].gender)),
  };
}

interface ChainBuild {
  clues: Clues;
  flippedAt: number[][];
}

/** Grow a forcing chain from the initial reveal. Returns null if it stalls. */
function buildChain(
  rng: () => number,
  shape: Shape,
  truth: boolean[],
  pool: Hint[],
  initialReveals: number[],
  trialsPerStep: number,
  maxReveals: number,
): ChainBuild | null {
  const board = makeBoard(shape.grid, shape.professions, truth);
  const clues: Clues = Array.from({ length: SIZE }, () => null);
  const flippedAt: number[][] = Array.from({ length: SIZE }, () => []);
  let flipped = [...initialReveals].sort((a, b) => a - b);
  let cursor = 0;

  while (flipped.length < SIZE) {
    const hosts = shuffled(
      rng,
      flipped.filter((i) => clues[i] === null),
    );
    let progressed = false;

    for (const host of hosts) {
      let tried = 0;
      while (tried < trialsPerStep && cursor < pool.length) {
        const hint = pool[cursor++];
        tried++;
        if (referencedCards(board, hint).has(host)) continue;
        clues[host] = hint;
        const forced = forcedGiven(shape, clues, truth, flipped);
        const reveals: number[] = [];
        for (let i = 0; i < SIZE; i++) {
          if (!flipped.includes(i) && forced[i] !== null) reveals.push(i);
        }
        if (reveals.length === 0 || reveals.length > maxReveals) {
          clues[host] = null;
          continue;
        }
        for (const i of reveals) flippedAt[i] = [...flipped];
        flipped = [...flipped, ...reveals].sort((a, b) => a - b);
        progressed = true;
        break;
      }
      if (progressed) break;
    }

    if (!progressed) return null;
  }

  return { clues, flippedAt };
}

export function generatePuzzle(input: GenerateInput): GenerateResult {
  const maxAttempts = input.maxAttempts ?? 25;
  const trialsPerStep = input.trialsPerStep ?? 80;
  const failures: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = makeRng(input.seed + attempt * 7919);
    const grid = makeGrid(WIDTH, HEIGHT);
    const cast = castOf(rng);
    const shape: Shape = { grid, professions: cast.professions };

    const criminals = randInt(rng, input.band.criminals.min, input.band.criminals.max);
    const criminalSet = new Set(shuffled(rng, [...Array(SIZE).keys()]).slice(0, criminals));
    const truth = Array.from({ length: SIZE }, (_, i) => criminalSet.has(i));

    const board = makeBoard(grid, cast.professions, truth);
    const pool = shuffled(rng, candidateHints(board));
    const initialReveals = [randInt(rng, 0, SIZE - 1)];

    const maxReveals = Math.max(2, Math.ceil(input.band.meanRevealsPerStep.max));
    const built = buildChain(rng, shape, truth, pool, initialReveals, trialsPerStep, maxReveals);
    if (!built) {
      failures.push(`attempt ${attempt}: chain stalled`);
      continue;
    }

    let unreachable = -1;
    const paths: number[][][] = truth.map((_, i) => {
      if (initialReveals.includes(i)) return [];
      const p = minimalPaths(shape, built.clues, truth, i, built.flippedAt[i]);
      if (p.length === 0) unreachable = i;
      return p;
    });
    if (unreachable !== -1) {
      failures.push(`attempt ${attempt}: card ${unreachable} has no sufficient path`);
      continue;
    }

    const chain = solveChain(shape, built.clues, truth, initialReveals);
    const metrics = measure({ shape, clues: built.clues, truth, initialReveals, paths });
    if (!chain.solvedAll || !isUniquelySolvable(shape, built.clues, truth)) {
      failures.push(`attempt ${attempt}: not uniquely solvable`);
      continue;
    }
    if (!gatesPass(input.band, metrics)) {
      failures.push(
        `attempt ${attempt}: out of band (chain=${metrics.chainLength} ` +
          `clues=${metrics.clueCards} path=${metrics.meanPathSize.toFixed(2)})`,
      );
      continue;
    }

    const flavour = shuffled(rng, FLAVOUR);
    let flavourAt = 0;
    const people: Person[] = truth.map((criminal, i) => {
      const hint = built.clues[i];
      return {
        name: cast.names[i],
        profession: cast.professions[i],
        gender: cast.genders[i],
        criminal,
        clue: hint ? render(hint) : flavour[flavourAt++ % flavour.length],
        origHint: hint ? formatHint(hint) : null,
        paths: paths[i],
        face: cast.faces[i],
      };
    });

    const puzzle: Puzzle = {
      formatVersion: 1,
      id: hexId(rng),
      date: input.date,
      title: TITLES[Math.floor(rng() * TITLES.length)],
      difficulty: input.difficulty,
      width: WIDTH,
      height: HEIGHT,
      initialReveals,
      source: 'generated',
      variant: 'dan',
      people,
      hints: chain.steps,
    };

    validatePuzzle(puzzle);
    return { puzzle, seed: input.seed + attempt * 7919, attempt, metrics };
  }

  throw new GenerationError(
    `no puzzle after ${maxAttempts} attempts:\n  ${failures.join('\n  ')}`,
  );
}
```

`Puzzle` does not have a `variant` field yet — Task 18 adds it. Write Task 18 first if the type error blocks you, or add the field to `shared/puzzle.ts` now and let Task 18 add its validation and tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/solver/generate.test.ts`
Expected: PASS. This is slow (each chain step enumerates the assignment space); allow several minutes.

If generation throws `GenerationError`, read the per-attempt failure lines it prints. "chain stalled" means `trialsPerStep` is too low or the pool is too small — raise `trialsPerStep`. "out of band" with wide test bands means a metric is being computed wrongly — check `measure` rather than widening the band.

- [ ] **Step 5: Commit**

```bash
git add shared/solver/generate.ts shared/solver/generate.test.ts shared/solver/difficulty.ts shared/solver/difficulty.test.ts
git commit -m "feat(solver): seeded puzzle generator with from-scratch verification"
```

---

### Task 18: Schema variant field and manifest slugs

Dan puzzles live beside real ones as `puzzles/YYYY-MM-DD-dan.json`. The manifest must list both and tell them apart, and every consumer needs a stable way to address a file. That address is the **slug**: the filename without `.json` (`2026-08-29` or `2026-08-29-dan`).

**Files:**
- Modify: `shared/puzzle.ts` (add `variant`, validate it)
- Modify: `scripts/manifest.mts` (filename regex, `ManifestEntry.slug` and `.variant`, sort)
- Test: `shared/puzzle.test.ts` (existing), `scripts/manifest.test.mts` (existing)

**Interfaces:**
- Produces:
  - `Puzzle.variant?: 'dan'` — absent means a scraped puzzle
  - `interface ManifestEntry { date: string; slug: string; variant: 'real' | 'dan'; id: string; difficulty: string; title: string }`

`ManifestEntry` gains two required fields, so every existing consumer's fixtures need them. Task 19 updates the site; this task updates `scripts/manifest.test.mts` only.

- [ ] **Step 1: Write the failing tests**

Append to `shared/puzzle.test.ts`:

```ts
describe('validatePuzzle variant', () => {
  it('accepts an absent variant and variant "dan"', () => {
    const base = validPuzzle(); // existing fixture helper in this file
    expect(validatePuzzle(base).variant).toBeUndefined();
    expect(validatePuzzle({ ...base, variant: 'dan' }).variant).toBe('dan');
  });

  it('rejects any other variant', () => {
    expect(() => validatePuzzle({ ...validPuzzle(), variant: 'real' })).toThrow(
      PuzzleValidationError,
    );
    expect(() => validatePuzzle({ ...validPuzzle(), variant: 7 })).toThrow(PuzzleValidationError);
  });
});
```

If `shared/puzzle.test.ts` has no `validPuzzle()` helper, use whatever fixture the neighbouring tests use and keep the same style.

Replace the assertions in `scripts/manifest.test.mts`. In the first test, write a Dan file too and expect it after its real sibling:

```ts
    await writeFile(path.join(dir, '2026-07-01.json'), JSON.stringify(puzzle('2026-07-01', 'aaaaaaaaaaaa')));
    await writeFile(path.join(dir, '2026-07-03.json'), JSON.stringify(puzzle('2026-07-03', 'bbbbbbbbbbbb')));
    await writeFile(
      path.join(dir, '2026-07-03-dan.json'),
      JSON.stringify({ ...puzzle('2026-07-03', 'cccccccccccc'), variant: 'dan' }),
    );
    await writeFile(path.join(dir, 'index.json'), '[]');
    await writeFile(path.join(dir, 'notes.txt'), 'ignore me');

    const entries = await regenerateManifest(dir);

    expect(entries.map((e) => e.slug)).toEqual(['2026-07-03', '2026-07-03-dan', '2026-07-01']);
    expect(entries[0]).toEqual({
      date: '2026-07-03', slug: '2026-07-03', variant: 'real',
      id: 'bbbbbbbbbbbb', difficulty: 'Easy', title: 'Title 2026-07-03',
    });
    expect(entries[1].variant).toBe('dan');
```

Add a third test:

```ts
  it('rejects a -dan file whose puzzle is not marked as a Dan variant', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cbs-manifest-'));
    await writeFile(path.join(dir, '2026-07-01-dan.json'), JSON.stringify(puzzle('2026-07-01', 'aaaaaaaaaaaa')));
    await expect(regenerateManifest(dir)).rejects.toThrow(/variant/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run shared/puzzle.test.ts scripts/manifest.test.mts`
Expected: FAIL — `variant` is not on `Puzzle`; entries lack `slug`.

- [ ] **Step 3: Add the schema field**

In `shared/puzzle.ts`, inside `interface Puzzle`, after `source: string;`:

```ts
  /** Absent on scraped puzzles; 'dan' on puzzles this repo generated. */
  variant?: 'dan';
```

In `validatePuzzle`, after the `source` check:

```ts
  if (p.variant !== undefined && p.variant !== 'dan') fail("variant must be absent or 'dan'");
```

- [ ] **Step 4: Update the manifest builder**

In `scripts/manifest.mts`, replace `ManifestEntry` and the body of `regenerateManifest` up to the sort:

```ts
export interface ManifestEntry {
  date: string;
  /** Filename without `.json` — how the site addresses this puzzle. */
  slug: string;
  variant: 'real' | 'dan';
  id: string;
  difficulty: string;
  title: string;
}

const PUZZLE_FILE = /^(\d{4}-\d{2}-\d{2})(-dan)?\.json$/;

export async function regenerateManifest(puzzlesDir: string): Promise<ManifestEntry[]> {
  const files = (await readdir(puzzlesDir)).filter((f) => PUZZLE_FILE.test(f)).sort();
  const entries: ManifestEntry[] = [];
  for (const file of files) {
    const variant = PUZZLE_FILE.exec(file)![2] ? 'dan' : 'real';
    let puzzle;
    try {
      puzzle = validatePuzzle(JSON.parse(await readFile(path.join(puzzlesDir, file), 'utf8')));
    } catch (e) {
      throw new Error(`${file}: ${String(e)}`);
    }
    if ((puzzle.variant === 'dan') !== (variant === 'dan')) {
      throw new Error(`${file}: filename and puzzle variant disagree`);
    }
    entries.push({
      date: puzzle.date,
      slug: file.slice(0, -'.json'.length),
      variant,
      id: puzzle.id,
      difficulty: puzzle.difficulty,
      title: puzzle.title,
    });
  }
  // Newest first; within a date, the real puzzle before the Dan one.
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
```

The rest of the function (the `writeFile` and `return`) is unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run shared/puzzle.test.ts scripts/manifest.test.mts`
Expected: PASS. The site tests will now fail to typecheck — Task 19 fixes them.

- [ ] **Step 6: Regenerate the real manifest**

```bash
npm run manifest
```

This rewrites `puzzles/index.json` with the new fields for all existing puzzles. Commit it.

- [ ] **Step 7: Commit**

```bash
git add shared/puzzle.ts shared/puzzle.test.ts scripts/manifest.mts scripts/manifest.test.mts puzzles/index.json
git commit -m "feat(schema): add puzzle variant field and manifest slugs"
```

---

### Task 19: Route and archive UI for Dan puzzles

**Files:**
- Modify: `site/src/router.ts` (accept a `-dan` suffix, carry a slug)
- Modify: `site/src/App.tsx` (pass the slug through)
- Modify: `site/src/screens/Game.tsx:604-614` (fetch by slug), `:94` and `:500-502` (Dan label)
- Modify: `site/src/screens/archiveData.ts` (variant filter)
- Modify: `site/src/screens/Archive.tsx` (Real/Dan toggle, link by slug)
- Test: `site/src/router.test.ts`, `site/src/screens/archiveData.test.ts`, `site/src/screens/Archive.test.tsx`

**Interfaces:**
- Consumes: `ManifestEntry` (with `slug`, `variant`) from Task 18.
- Produces:
  - `type Route = { screen: 'archive' } | { screen: 'play'; slug: string }`
  - `ArchiveFilters` gains `variant?: 'real' | 'dan'`
  - `Game` prop becomes `{ slug: string }`

The toggle is exclusive: the archive shows real puzzles or Dan puzzles, never both interleaved. It defaults to `real` and is not persisted.

- [ ] **Step 1: Write the failing router test**

Replace the play case in `site/src/router.test.ts`:

```ts
  it('routes #/play/<slug> to the game, with or without the -dan suffix', () => {
    expect(parseHash('#/play/2026-07-07')).toEqual({ screen: 'play', slug: '2026-07-07' });
    expect(parseHash('#/play/2026-07-07-dan')).toEqual({ screen: 'play', slug: '2026-07-07-dan' });
    expect(parseHash('#/play/2026-07-07-sam')).toEqual({ screen: 'archive' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run site/src/router.test.ts`
Expected: FAIL — got `{ screen: 'play', date: '2026-07-07' }`.

- [ ] **Step 3: Update the router and App**

`site/src/router.ts`:

```ts
export type Route = { screen: 'archive' } | { screen: 'play'; slug: string };

export function parseHash(hash: string): Route {
  const m = hash.match(/^#\/play\/(\d{4}-\d{2}-\d{2}(?:-dan)?)$/);
  return m ? { screen: 'play', slug: m[1] } : { screen: 'archive' };
}
```

`useRoute` is unchanged. `site/src/App.tsx`:

```tsx
  return route.screen === 'play' ? <Game key={route.slug} slug={route.slug} /> : <Archive />;
```

- [ ] **Step 4: Update Game to fetch by slug**

In `site/src/screens/Game.tsx`, replace the component signature and the two `date` references beneath it:

```tsx
export default function Game({ slug }: { slug: string }) {
  const { data, error, retry } = useFetch<unknown>(`puzzles/${slug}.json`);
```

and

```tsx
  if (!data) return <p>Loading {slug}</p>;
```

Everything else in `Game` already reads `puzzle.date`, so it needs no change.

- [ ] **Step 5: Label Dan puzzles in the game view**

Add near `formatDateOrdinal` in `site/src/screens/Game.tsx`:

```tsx
function puzzleLabel(puzzle: Puzzle): string {
  const dan = puzzle.variant === 'dan' ? ' · Dan' : '';
  return `${formatDateOrdinal(puzzle.date)} (${puzzle.difficulty})${dan}`;
}
```

Use it at line 94:

```tsx
  const title = puzzleLabel(puzzle);
```

and in the date line at ~line 500:

```tsx
            <span>{puzzleLabel(puzzle)}</span>
```

- [ ] **Step 6: Write the failing archiveData test**

Append to `site/src/screens/archiveData.test.ts`:

```ts
describe('filterEntries variant', () => {
  const entries: ManifestEntry[] = [
    { date: '2026-07-03', slug: '2026-07-03', variant: 'real', id: 'aaaaaaaaaaaa', difficulty: 'Easy', title: 'Real' },
    { date: '2026-07-03', slug: '2026-07-03-dan', variant: 'dan', id: 'bbbbbbbbbbbb', difficulty: 'Easy', title: 'Dan' },
  ];

  it('keeps only the requested variant', () => {
    expect(filterEntries(entries, { variant: 'real' }).map((e) => e.slug)).toEqual(['2026-07-03']);
    expect(filterEntries(entries, { variant: 'dan' }).map((e) => e.slug)).toEqual(['2026-07-03-dan']);
  });

  it('keeps both when no variant is requested', () => {
    expect(filterEntries(entries, {}).length).toBe(2);
  });
});
```

The other tests in this file build `ManifestEntry` fixtures; add `slug` and `variant` to each so the file typechecks.

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run site/src/screens/archiveData.test.ts`
Expected: FAIL — `variant` is not a property of `ArchiveFilters`.

- [ ] **Step 8: Add the variant filter**

In `site/src/screens/archiveData.ts`:

```ts
export interface ArchiveFilters {
  difficulty?: string;
  status?: PuzzleStatus;
  variant?: 'real' | 'dan';
}

export function filterEntries(entries: ManifestEntry[], filters: ArchiveFilters): ManifestEntry[] {
  return entries.filter((entry) => {
    if (filters.variant && entry.variant !== filters.variant) return false;
    if (filters.difficulty && entry.difficulty !== filters.difficulty) return false;
    if (filters.status && statusFor(entry.id) !== filters.status) return false;
    return true;
  });
}
```

- [ ] **Step 9: Write the failing Archive test**

In `site/src/screens/Archive.test.tsx`, extend the fixture and add a test:

```tsx
const manifest = [
  { date: '2026-07-03', slug: '2026-07-03', variant: 'real', id: 'bbbbbbbbbbbb', difficulty: 'Hard', title: 'Second' },
  { date: '2026-07-03', slug: '2026-07-03-dan', variant: 'dan', id: 'dddddddddddd', difficulty: 'Hard', title: 'Second (Dan)' },
  { date: '2026-07-01', slug: '2026-07-01', variant: 'real', id: 'aaaaaaaaaaaa', difficulty: 'Easy', title: 'First' },
];
```

```tsx
  it('shows real puzzles by default and swaps to Dan puzzles on the toggle', async () => {
    render(<Archive />);
    await screen.findByText('July 2026');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/play/2026-07-03',
      '#/play/2026-07-01',
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Dan' }));
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/play/2026-07-03-dan',
    ]);
  });
```

The existing first test asserts `links[0]` is `#/play/2026-07-03` and `links[1]` is the done one — with the default `real` filter that still holds, since the Dan entry is filtered out.

- [ ] **Step 10: Run it to verify it fails**

Run: `npx vitest run site/src/screens/Archive.test.tsx`
Expected: FAIL — no button named "Dan".

- [ ] **Step 11: Add the toggle to Archive**

In `site/src/screens/Archive.tsx`, add state and thread it through:

```tsx
  const [variant, setVariant] = useState<'real' | 'dan'>('real');
```

```tsx
  const difficulties = useMemo(
    () => sortDifficulties([...new Set((data ?? []).filter((e) => e.variant === variant).map((e) => e.difficulty))]),
    [data, variant],
  );
  const filtered = useMemo(
    () =>
      filterEntries(data ?? [], {
        variant,
        difficulty: difficulty || undefined,
        status: status || undefined,
      }),
    [data, difficulty, status, variant],
  );
```

Render the toggle as the first child of `div.archive-filters`:

```tsx
          <div className="variant-toggle" role="group" aria-label="Puzzle set">
            <button
              type="button"
              aria-pressed={variant === 'real'}
              onClick={() => setVariant('real')}
            >
              Real
            </button>
            <button type="button" aria-pressed={variant === 'dan'} onClick={() => setVariant('dan')}>
              Dan
            </button>
          </div>
```

Change the list item to key and link by slug:

```tsx
                  <li key={entry.slug}>
                    <a href={`#/play/${entry.slug}`}>
```

- [ ] **Step 12: Style the toggle**

Append to `site/src/styles.css`, following the existing `.archive-filters` rules:

```css
.variant-toggle {
  display: flex;
  gap: 0;
}
.variant-toggle button {
  padding: 0.3rem 0.9rem;
  border: 1px solid currentColor;
  background: none;
  color: inherit;
  cursor: pointer;
}
.variant-toggle button:first-child {
  border-radius: 4px 0 0 4px;
}
.variant-toggle button:last-child {
  border-radius: 0 4px 4px 0;
  border-left: none;
}
.variant-toggle button[aria-pressed='true'] {
  background: currentColor;
  filter: invert(1);
}
```

- [ ] **Step 13: Run the whole site suite**

Run: `npx vitest run site`
Expected: PASS. Any remaining failures are fixtures missing `slug`/`variant` — add them.

- [ ] **Step 14: Commit**

```bash
git add site/src/router.ts site/src/router.test.ts site/src/App.tsx site/src/screens site/src/styles.css
git commit -m "feat(site): route, label, and filter Dan puzzles"
```

---

### Task 20: Generation CLI, backfill, and daily automation

**Files:**
- Create: `scripts/generate.mts`
- Test: `scripts/generate.test.mts`
- Modify: `package.json` (add the `generate` script)
- Modify: `.github/workflows/scrape-daily.yml` (generate after each scrape)

**Interfaces:**
- Consumes: `generatePuzzle` from `../shared/solver/generate.ts`; `loadBands` from `../shared/solver/difficulty.ts`; `regenerateManifest` from `./manifest.mts`.
- Produces:
  - `interface GenerateRunOptions { puzzlesDir?: string; bandsPath?: string; dates?: string[]; force?: boolean }`
  - `interface GenerateRunResult { written: string[]; skipped: string[]; failed: { date: string; reason: string }[] }`
  - `runGenerate(opts?: GenerateRunOptions): Promise<GenerateRunResult>`
  - `seedForDate(date: string): number`

Seeds are derived from the date, so a regenerated Dan puzzle for a given date is byte-identical to the first one. `runGenerate` never rewrites an existing `-dan` file unless `force` is set.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/generate.test.mts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePuzzle } from '../shared/puzzle.ts';
import { runGenerate, seedForDate } from './generate.mts';

// A real puzzle file only needs the fields runGenerate reads plus schema validity.
function realPuzzle(date: string, id: string, difficulty: string) {
  const person = {
    name: 'banda', profession: 'coder', gender: 'male',
    criminal: false, clue: null, origHint: null, paths: [],
  };
  return {
    formatVersion: 1, id, date, title: `Title ${date}`, difficulty,
    width: 1, height: 2, initialReveals: [], source: 'cluesbysam.com',
    people: [person, person],
  };
}

const bands = {
  Easy: {
    samples: 10,
    criminals: { min: 4, max: 7 },
    clueCards: { min: 4, max: 16 },
    chainLength: { min: 2, max: 19 },
    meanRevealsPerStep: { min: 1, max: 8 },
    meanPathSize: { min: 1, max: 12 },
  },
};

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cbs-generate-'));
  const bandsPath = path.join(dir, 'difficulty.json');
  await writeFile(bandsPath, JSON.stringify(bands));
  await writeFile(
    path.join(dir, '2026-07-01.json'),
    JSON.stringify(realPuzzle('2026-07-01', 'aaaaaaaaaaaa', 'Easy')),
  );
  return { dir, bandsPath };
}

describe('seedForDate', () => {
  it('is stable and differs between dates', () => {
    expect(seedForDate('2026-07-01')).toBe(seedForDate('2026-07-01'));
    expect(seedForDate('2026-07-01')).not.toBe(seedForDate('2026-07-02'));
  });
});

describe('runGenerate', () => {
  it('writes a valid Dan sibling and lists it in the manifest', async () => {
    const { dir, bandsPath } = await fixture();
    const result = await runGenerate({ puzzlesDir: dir, bandsPath });

    expect(result.written).toEqual(['2026-07-01']);
    expect(result.failed).toEqual([]);
    const raw = JSON.parse(await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8'));
    const puzzle = validatePuzzle(raw);
    expect(puzzle.variant).toBe('dan');
    expect(puzzle.date).toBe('2026-07-01');
    expect(puzzle.difficulty).toBe('Easy');
    expect(puzzle.title).not.toBe('Title 2026-07-01');

    const index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
    expect(index.map((e: { slug: string }) => e.slug)).toEqual(['2026-07-01', '2026-07-01-dan']);
  });

  it('skips dates that already have a Dan puzzle, and regenerates identically with force', async () => {
    const { dir, bandsPath } = await fixture();
    await runGenerate({ puzzlesDir: dir, bandsPath });
    const first = await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8');

    const second = await runGenerate({ puzzlesDir: dir, bandsPath });
    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual(['2026-07-01']);

    const third = await runGenerate({ puzzlesDir: dir, bandsPath, force: true });
    expect(third.written).toEqual(['2026-07-01']);
    expect(await readFile(path.join(dir, '2026-07-01-dan.json'), 'utf8')).toBe(first);
  });

  it('reports a date whose difficulty has no calibrated band without throwing', async () => {
    const { dir, bandsPath } = await fixture();
    await writeFile(
      path.join(dir, '2026-07-02.json'),
      JSON.stringify(realPuzzle('2026-07-02', 'cccccccccccc', 'Brutal')),
    );
    const result = await runGenerate({ puzzlesDir: dir, bandsPath });
    expect(result.written).toEqual(['2026-07-01']);
    expect(result.failed).toEqual([{ date: '2026-07-02', reason: 'no calibrated band for Brutal' }]);
  });
});
```

The fixture puzzles are 1×2, but `generatePuzzle` always builds 4×5 — the source puzzle supplies only the date and difficulty, never its shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/generate.test.mts`
Expected: FAIL — cannot resolve `./generate.mts`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/generate.mts
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadBands } from '../shared/solver/difficulty.ts';
import { GenerationError, generatePuzzle } from '../shared/solver/generate.ts';
import { validatePuzzle } from '../shared/puzzle.ts';
import { regenerateManifest } from './manifest.mts';

export interface GenerateRunOptions {
  puzzlesDir?: string;
  bandsPath?: string;
  /** Restrict to these dates; default is every real puzzle in the directory. */
  dates?: string[];
  force?: boolean;
}

export interface GenerateRunResult {
  written: string[];
  skipped: string[];
  failed: { date: string; reason: string }[];
}

/** FNV-1a over the date string: stable across runs and machines. */
export function seedForDate(date: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const REAL_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export async function runGenerate(opts: GenerateRunOptions = {}): Promise<GenerateRunResult> {
  const puzzlesDir = opts.puzzlesDir ?? path.join(process.cwd(), 'puzzles');
  const bandsPath = opts.bandsPath ?? path.join(process.cwd(), 'config', 'difficulty.json');
  const bands = loadBands(JSON.parse(await readFile(bandsPath, 'utf8')));

  const files = await readdir(puzzlesDir);
  const existing = new Set(files);
  const dates = files
    .map((f) => REAL_FILE.exec(f)?.[1])
    .filter((d): d is string => d !== undefined)
    .filter((d) => !opts.dates || opts.dates.includes(d))
    .sort();

  const result: GenerateRunResult = { written: [], skipped: [], failed: [] };

  for (const date of dates) {
    if (!opts.force && existing.has(`${date}-dan.json`)) {
      result.skipped.push(date);
      continue;
    }
    const real = validatePuzzle(
      JSON.parse(await readFile(path.join(puzzlesDir, `${date}.json`), 'utf8')),
    );
    const band = bands[real.difficulty];
    if (!band) {
      result.failed.push({ date, reason: `no calibrated band for ${real.difficulty}` });
      continue;
    }
    try {
      const { puzzle } = generatePuzzle({
        date,
        difficulty: real.difficulty,
        band,
        seed: seedForDate(date),
      });
      await writeFile(
        path.join(puzzlesDir, `${date}-dan.json`),
        JSON.stringify(puzzle, null, 2) + '\n',
      );
      result.written.push(date);
    } catch (e) {
      if (!(e instanceof GenerationError)) throw e;
      result.failed.push({ date, reason: e.message.split('\n')[0] });
    }
  }

  await regenerateManifest(puzzlesDir);
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  runGenerate({ force, dates: dates.length ? dates : undefined }).then(
    (r) => {
      for (const d of r.written) console.log(`generated ${d}-dan.json`);
      if (r.skipped.length) console.log(`skipped ${r.skipped.length} existing`);
      for (const f of r.failed) console.error(`FAILED ${f.date}: ${f.reason}`);
      if (r.failed.length) process.exit(1);
    },
    (e) => {
      console.error(String(e));
      process.exit(1);
    },
  );
}
```

A `GenerationError` is recorded and the run continues — one stubborn date must not block the rest of a backfill — but the CLI exits non-zero so CI notices.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/generate.test.mts`
Expected: PASS. Slow; each generated puzzle takes on the order of a minute.

- [ ] **Step 5: Add the npm script**

In `package.json`, after the `manifest` entry:

```json
    "generate": "tsx scripts/generate.mts"
```

- [ ] **Step 6: Commit the CLI**

```bash
git add scripts/generate.mts scripts/generate.test.mts package.json
git commit -m "feat(scripts): generate Dan puzzles for scraped dates"
```

- [ ] **Step 7: Backfill the whole archive**

```bash
npm run calibrate   # only if config/difficulty.json is not already committed
npm run generate
```

This runs the generator once per archived date. It is slow — expect tens of minutes — and prints one line per puzzle. If any date lands in `FAILED`, do not lower the difficulty gates: re-run just that date with a widened attempt budget by editing the call site temporarily, or note the date and move on. A backfill that covers most dates is fine; a backfill that passes because the gates were loosened is not.

- [ ] **Step 8: Verify the backfill**

```bash
npx vitest run
ls puzzles/*-dan.json | wc -l
```

Expected: the full suite passes and the Dan file count matches the real puzzle count minus any recorded failures. Spot-check one in the browser:

```bash
npm run dev
```

Open the archive, flip the toggle to **Dan**, play one through. Check that clues read naturally, that no clue refers to the card it sits on, and that the puzzle is solvable without guessing.

- [ ] **Step 9: Commit the backfill**

```bash
git add puzzles config/difficulty.json
git commit -m "feat(puzzles): backfill Dan puzzles for the archive"
```

- [ ] **Step 10: Wire generation into the daily workflow**

In `.github/workflows/scrape-daily.yml`, insert a step between `npm run extract` and the commit step:

```yaml
      - run: npm run generate
```

and widen the commit step's change detection and message, since it now stages a second file:

```yaml
      - id: commit
        name: Commit and push if the scrape produced changes
        run: |
          if [ -n "$(git status --porcelain puzzles)" ]; then
            git config user.name 'github-actions[bot]'
            git config user.email 'github-actions[bot]@users.noreply.github.com'
            git add puzzles
            git commit -m "Scrape puzzle $(date -u +%F)"
            git push
            echo "changed=true" >> "$GITHUB_OUTPUT"
          else
            echo "changed=false" >> "$GITHUB_OUTPUT"
          fi
```

The commit step body is unchanged — `git add puzzles` already picks up the new `-dan` file and the rewritten `index.json`. The only edit to this file is the added `npm run generate` line.

Also raise the job timeout, because generation is minutes of CPU. Under `jobs.scrape`, beside `runs-on`:

```yaml
    timeout-minutes: 30
```

- [ ] **Step 11: Commit the workflow**

```bash
git add .github/workflows/scrape-daily.yml
git commit -m "ci: generate a Dan puzzle after each daily scrape"
```

---

## Done

At this point the repo has: an exact solver for the puzzle format verified against all 53 archived puzzles, a difficulty model calibrated from those puzzles, a generator that produces original 4×5 puzzles with no-guessing chains, a Dan puzzle beside every real one, and a Real/Dan toggle in the archive.
