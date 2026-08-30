# Dan Puzzle Generator — Design

**Date:** 2026-08-29
**Status:** Approved pending user review

## Purpose

Generate original puzzles in the Clues by Sam format so that every date in the
archive offers two puzzles: the scraped real one and a "Dan" one this repo
created at a comparable difficulty. Requires a solver (to guarantee the
generated puzzles are uniquely solvable and fair) and a generator built on top
of it.

The existing design doc (`2026-07-07-cbs-clone-design.md`) listed puzzle
authoring as out of scope. This supersedes that for authoring only; nothing
about the scraper or the player's core loop changes.

## Scope

**In:**
- Solver: evaluator for all 27 clue predicates, unique-solvability check,
  derivation of `paths` and `hints`
- Renderer: predicate AST → the `clue` markup string the player sees
- Difficulty calibration measured from the existing archive
- Generator producing one Dan puzzle per date, at that date's difficulty label
- Backfill of all existing dates, plus daily generation after each scrape
- Archive screen toggle between real and Dan puzzles

**Out:**
- Grid sizes other than the archive's uniform 4×5
- Changing the player's game loop, scoring, or persistence model
- Reusing any scraped title or flavour text in generated puzzles

## Background: confirmed semantics

Probed against the 53-puzzle archive rather than assumed:

- **Neighbours are 8-way** (king move). Checked against every
  `number_of_traits_in_unit(unit(neighbor,i),…)` instance: 8-way 27/27,
  4-way 7/27.
- `unit(edge,void)` is the perimeter (3/3), `unit(corner,void)` the four
  corners (4/4), and `number_of_traits` counts the whole grid (6/6).
- `unit(row,n)` and `unit(col,n)` are **1-based**; `#C:1` renders as column A.
- `unit(between,pair(a,b))` is the **inclusive line segment** from a to b, not
  the inclusive index range. The endpoints always share a row or a column (all
  56 distinct pairs in the archive do), so the unit is either a contiguous
  row-run or a column-run stepping by `width`. Checked against every
  `number_of_traits_in_unit(unit(between,…))` instance: segment 51/51, index
  range 26/51. `ClueText.tsx`'s `sameRow` branch assumes the same reading.
  Rendered positionally ("in row 3", "above Mary").

Every archived puzzle is 4×5 with 4–16 criminals, 7–16 clue-bearing cards, and
labels drawn from Easy / Medium / Tricky / Hard / Brutal.

## The central design decision: exhaustive enumeration

A 4×5 grid has 2²⁰ ≈ 1.05M possible criminal/innocent assignments. That is
small enough to enumerate directly, which makes the two questions the solver
must answer exact rather than heuristic:

- **Unique solvability:** exactly one assignment satisfies the full clue set.
- **Forcing:** given flipped set `F` (identities known) and the clues visible
  on `F`, card `i` is forced iff every surviving assignment agrees on `i`.

Knowing `F`'s identities fixes those cards, so a query enumerates
2^(20−|F|). Filtering is incremental — the first clue typically cuts the space
5–20×, so subsequent predicates evaluate only over survivors. This removes any
need for constraint propagation or "probably fair" approximations: fairness is
decided by exhaustive check.

**Consequence:** the design is tied to small grids. A 5×6 grid (2³⁰) would
need a different solver. Acceptable — the archive has only ever been 4×5, and
generated puzzles match the real one's dimensions by construction.

## Architecture

```
shared/solver/
├── grid.ts         # geometry: 8-way neighbours, the 7 unit kinds
├── hint.ts         # origHint string <-> typed AST
├── predicates.ts   # 27 evaluators over a complete assignment
├── render.ts       # AST -> clue markup string
├── enumerate.ts    # assignment space, incremental filtering, forcing queries
├── solve.ts        # solve closure -> unique solvability, paths, hints
├── difficulty.ts   # metrics + per-label bands
└── vocab.ts        # names, professions, titles, flavour lines (original)
scripts/
├── calibrate.mts   # archive -> config/difficulty.json
└── generate.mts    # generate one Dan puzzle for a date
```

Each module is independently testable: `grid` and `predicates` are pure
functions of geometry and an assignment; `enumerate` and `solve` depend only on
`predicates`; `generate` composes the rest.

### Unit kinds

`row(n)`, `col(n)` (1-based), `neighbor(i)` (8-way, excludes i itself),
`between(a,b)` (inclusive line segment — a row-run when the endpoints share a
row, a column-run stepping by `width` when they share a column),
`profession(name)`, `edge` (perimeter), `corner` (four corners). Predicates that quantify over "any other unit"
(`has_most_traits`, `only_unit_has_exactly_n_traits`) range over units of the
same kind; `all_units_have_at_least_n_traits` and
`only_one_unit_has_exactly_n_traits` take a bare kind (`row` or `col`) rather
than a unit instance.

### Predicate semantics

`U` = unit, `T` = trait (criminal/innocent), `|U∩T|` = members of U with T.
These are read off the archive's clue/hint pairs and are treated as hypotheses
until the corpus test confirms them.

| Predicate | Semantics |
|---|---|
| `has_trait(i,T)` | person i has T |
| `number_of_traits(T,n)` | exactly n people in the grid have T |
| `number_of_traits_in_unit(U,T,n)` | \|U∩T\| = n |
| `min_number_of_traits_in_unit(U,T,n)` | \|U∩T\| ≥ n |
| `max_number_of_traits_in_neighbors_in_unit(U,T,n)` | no member of U has more than n T-neighbours |
| `odd_number_of_traits_in_unit(U,T)` | \|U∩T\| is odd |
| `more_traits_in_unit_than_unit(U1,U2,T)` | \|U1∩T\| > \|U2∩T\| |
| `equal_number_of_traits_in_units(U1,U2,T)` | \|U1∩T\| = \|U2∩T\| |
| `more_traits_than_traits_in_unit(U,T1,T2)` | \|U∩T1\| > \|U∩T2\| |
| `equal_traits_and_traits_in_unit(U,T1,T2)` | \|U∩T1\| = \|U∩T2\| |
| `has_most_traits(U,T)` | \|U∩T\| strictly exceeds every other unit of U's kind |
| `only_unit_has_exactly_n_traits(U,T,n)` | \|U∩T\| = n and no other unit of that kind has exactly n |
| `only_one_unit_has_exactly_n_traits(kind,T,n)` | exactly one unit of kind has exactly n |
| `all_units_have_at_least_n_traits(kind,T,n)` | every unit of kind has ≥ n |
| `is_one_of_n_traits_in_unit(U,i,T,n)` | i ∈ U, i has T, \|U∩T\| = n |
| `is_not_only_trait_in_unit(U,i,T)` | i ∈ U, i has T, \|U∩T\| ≥ 2 |
| `units_share_n_traits(U1,U2,T,n)` | \|U1∩U2∩T\| = n |
| `units_share_odd_n_traits(U1,U2,T)` | \|U1∩U2∩T\| is odd |
| `unit_shares_n_out_of_n_traits_with_unit(U1,U2,T,n,m)` | \|U1∩T\| = m and \|U1∩U2∩T\| = n |
| `both_traits_in_unit_are_in_unit(U1,U2,T)` | \|U1∩T\| = 2 and both are in U2 |
| `only_trait_in_unit_is_in_unit(U1,U2,T)` | \|U1∩T\| = 1 and it is in U2 |
| `both_traits_are_neighbors_in_unit(U,T)` | \|U∩T\| = 2 and the two are adjacent |
| `all_traits_are_neighbors_in_unit(U,T)` | U∩T is connected under 8-way adjacency |
| `only_one_person_in_unit_has_exactly_n_trait_neighbors(U,T,n)` | exactly one member of U has exactly n T-neighbours |
| `n_in_unit_have_trait_in_dir(U,T,dx,dy,n)` | exactly n members of U have a T person at offset (dx,dy) |
| `n_t_in_unit_have_trait_in_dir(U,T1,T2,dx,dy,n)` | exactly n T1-members of U have a T2 at (dx,dy) |
| `n_professions_have_trait_in_dir(prof,T,dx,dy,n)` | exactly n people of that profession have a T at (dx,dy) |

Direction offsets are `(dx,dy)`: `(1,0)` right, `(-1,0)` left, `(0,-1)` above,
`(0,1)` below.

## Verification strategy

The archive is a large, adversarial test corpus, and it is what makes
27-predicate parity tractable rather than reckless. Three corpus tests, run
over every `puzzles/*.json`:

1. **Evaluator soundness.** Every `origHint` must evaluate `true` against its
   own puzzle's known solution. ~1,300 assertions. A misread predicate fails
   loudly and specifically.
2. **Renderer fidelity.** Parse each real `origHint`, render it, diff against
   the stored `clue`. ~1,300 golden cases. The source picks among phrasings for
   some predicates ("2 painters have…" / "Exactly 1 cook has…" / "1 of the 2
   cooks has…"), so the bar is **≥95% exact match**, with the residue
   enumerated in a test snapshot rather than silently tolerated. Only the
   generator's own output must round-trip exactly.
3. **Solver agreement.** Every real puzzle must come out uniquely solvable
   under its full clue set, and each real `paths` entry must be a genuinely
   sufficient set under our forcing query.

**Measured fidelity (Task 10, 2026-08-29):** `shared/solver/corpus.test.ts`'s
renderer-fidelity test measures **97.2%** exact-match on the real archive: 460
comparable cases, 447 exact matches, 13 mismatches, out of 660 total
`origHint`-bearing clue cards across the archive (196 excluded as
self-referential first-person phrasings the source uses and our renderer
deliberately never produces; 4 excluded as unsupported hint shapes
`canRender` correctly declines to render). The fix that got this from an
initial 79.3% to 97.2%: the archive
glues "row"/"column" to the number or `#C:` token that immediately follows
it with a U+00A0 non-breaking space rather than a plain space, in locative
("in row 3") and comparative ("row 3 than row 5") phrasings specifically
(not in the bare-noun "Only one row has…" or "Row 3 has more…" phrasings,
which use a plain space) — `render.ts` now reproduces that convention via an
`NBSP` constant used in `where()` and the two other row/column call sites
that needed it. The remaining 13 mismatches are all previously-disclosed,
accepted minority-phrasing gaps from Tasks 8-9's ledger (the unrenderable
"N of the M #PROFS:X" fraction phrasing for `n_professions_have_trait_in_dir`
/ `n_in_unit_have_trait_in_dir`; the `unit_shares_n_out_of_n_traits_with_unit`
n=1-vs-n≠1 split at m≥3; a couple of single-occurrence phrasing ties with no
AST discriminator) — not fixed, per the plan's instruction not to touch
already-reviewed judgment calls.

Test 3 is the fairness proof. If our notion of "forced" agrees with the source's
on 53 real puzzles, generated puzzles inherit that guarantee.

## Generation algorithm

Clue placement is part of the puzzle: a clue is unreadable until its card is
flipped, so a valid puzzle is a *chain*, not just a satisfiable clue set.

1. Sample the grid: 4×5, criminal count and clue-card count drawn from the
   target label's measured band; names, genders, professions from `vocab.ts`;
   faces via the existing `faces.ts` map.
2. Draw a random true assignment.
3. Enumerate every clue instance **true** of that assignment across all 27
   predicates and all unit instantiations — typically several hundred
   candidates.
4. Build the chain. Maintain flipped set `F` (starting from `initialReveals`,
   one card) and a card→clue map. At each step choose an unassigned card
   `p ∈ F` and a candidate clue `c` such that the knowledge
   (identities of `F` + clues assigned on `F` + `c`) forces at least one new
   card; prefer clues forcing 1–3 cards, tuned by target label. Flip what is
   forced; repeat until all 20 cards are revealed.
5. Cards left without a clue get flavour text (`clue` set, `origHint: null`),
   matching the real format.
6. **Verify from scratch** with the generic solver, not the construction
   bookkeeping: unique solution under the full clue set, recomputed `paths` and
   `hints`, difficulty metrics inside the label's band, and
   `validatePuzzle` acceptance.
7. On stall or band miss, retry with a new seed, up to a fixed budget.

`paths` are minimised: after finding the flipped set at which a card first
becomes forced, greedily drop members that do not break forcing, and collect
distinct minimal sufficient sets from a few random drop orders. Minimal
sufficient sets are strictly fairer than the source's canonical chains — every
set is still genuinely sufficient, and more solve orders stay legal.

Generation is seeded and deterministic: the seed is recorded so any puzzle can
be reproduced.

## Difficulty calibration

`scripts/calibrate.mts` measures every archived puzzle with our own solver and
writes per-label bands to `config/difficulty.json`. Metrics:

- criminal count; clue-bearing vs flavour card counts
- solve chain length (steps in the forcing closure from `initialReveals`)
- cards revealed per step (mean, max)
- minimal sufficient path size (mean, max) — how much evidence must be combined
- predicate mix (distribution over the 27)

A Dan puzzle takes that date's real label. The metrics split by role: criminal
count and clue-card count are **sampled** from the band before generation
(step 1), while the three solve-shape metrics — chain length, mean cards
revealed per step, and mean minimal path size — are **gates** checked after
generation (step 6). Predicate mix is reported for review but does not gate,
since it varies widely within every label. Bands are derived from measured
data and checked in, so the numbers are reviewable rather than a matter of
feel.

**Known limit:** the labels are the source's, and per-label sample sizes are
small (3 Brutal, 8 Easy). Bands will be wide for sparse labels; that is
reported honestly rather than papered over.

## Storage, routing, and UI

- `Puzzle` gains optional `variant?: 'dan'` (absent = real). Additive and
  backward compatible with `formatVersion: 1`; `validatePuzzle` gains a check.
- Files: `puzzles/2026-08-29-dan.json` alongside `puzzles/2026-08-29.json`.
- `manifest.mts`: filename regex extended to accept the `-dan` suffix;
  `ManifestEntry` gains `variant`. One manifest covers both.
- `router.ts`: `#/play/<date>` becomes `#/play/<date>(-dan)?`. The route slug
  is already the filename stem, so the fetch path needs no change.
- Archive screen: a Real / Dan toggle filtering the list, alongside the
  existing difficulty and status filters.
- Progress is keyed by `puzzle.id`; Dan puzzles get fresh random 12-hex ids, so
  saved games stay separate with no storage change.
- Deploy copies `puzzles/` wholesale — no workflow change needed there.
- `scrape-daily.yml` runs the generator after a successful scrape and commits
  both files together. A one-off backfill covers the 53 existing dates and
  doubles as a large-scale generator smoke test.

## Content originality

Scraped titles and flavour chatter are Ad Artis's commercial content and are
not copied into generated puzzles. `vocab.ts` carries an original pool of
titles and flavour lines. Names and professions are reused, since they come
from the profession→emoji face map the player already ships and carry no
authorship.

## Error handling

- Generator failure for a date is a non-fatal, reported skip: the real puzzle
  still commits, and the missing Dan puzzle is logged rather than blocking the
  daily scrape.
- `validatePuzzle` and the from-scratch solver check run before any file is
  written; a puzzle that fails either is discarded, never written.
- `calibrate.mts` fails loudly if a label has too few samples to form a band,
  rather than emitting a band derived from one puzzle.

## Testing

Vitest, colocated per repo convention:

- `grid.test.ts`, `hint.test.ts`, `predicates.test.ts`, `render.test.ts`,
  `enumerate.test.ts`, `solve.test.ts` — unit tests on small hand-built grids
- `corpus.test.ts` — the three archive-wide tests above
- `generate.test.ts` — generated puzzles are uniquely solvable, pass
  `validatePuzzle`, round-trip render exactly, and reproduce from their seed
- Existing suites (`manifest`, `router`, `Archive`, `App`) extended for the
  variant field and toggle
