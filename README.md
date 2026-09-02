# cbs2

Personal archive and player for Clues by Sam daily puzzles. See
`docs/superpowers/specs/2026-07-07-cbs-clone-design.md` for the design.

## Commands

- `npm run dev` — dev server (open the printed URL; the app lives under the UUID base path)
- `npm test` — full Vitest suite (puzzle generation included; it runs on a 4x4 board to stay quick)
- `npm run test:generate` — generate one puzzle at the shipped 4x5 size and check it is sound;
  worth a minute before `npm run generate`
- `npm run test:generate Medium 1 5x6` — the same, aimed at a label and seed, on a given board
- `npm run generate` — one generated sibling per variant for every date that lacks one
  (`2026-07-01` for one date, `dan` for one variant, `--force` to redo existing ones)
- `npx tsx scripts/audit-dan.mts` — re-derive and re-check every generated puzzle from its file alone
- `npm run build` — production build to `site/dist/`
- `npm run extract` — scrape today's puzzle into `puzzles/`
- `npm run extract -- <url-or-puzzleId>` — import a specific/archived puzzle
  (`DATE_OVERRIDE=YYYY-MM-DD` env var if the page has no date)
- `npm run one-off` — build the named boards in `ONE_OFFS` (`npm run one-off 10x10` for one).
  Not in the manifest and not on any schedule; the 10x10 is about eighteen minutes
- `npm run manifest` — regenerate `puzzles/index.json`

## Variants

Each scraped puzzle gets generated siblings, listed in `VARIANTS` in
`shared/puzzle.ts`. That table is the only place a variant is named: the
filename suffix, the archive dropdown, and the schema's accepted set all read
from it.

| Variant | File | Board |
| --- | --- | --- |
| — (scraped) | `YYYY-MM-DD.json` | 4x5 |
| `dan` | `YYYY-MM-DD-dan.json` | by the day of the week, 3x4 to 6x6 |
| `dan`, one-off | `<name>.json` | fixed, per entry in `ONE_OFFS` |

A Dan puzzle does not inherit the real puzzle's board. `WEEKDAY_BOARDS` in
`scripts/generate.mts` is a straight lookup from the day of the week: 3x4 on
Monday up to 6x6 on Sunday, never wider than it is tall, and never smaller than
the day before — though Thursday and Friday are both 5x5, because seven days do
not divide that range evenly and a repeat mid-week beats a jump at the weekend.
The day is read in UTC, so a date's board is a property of the date string
rather than of the machine that generated it.

This replaced a per-date random draw. A schedule gives the week a shape, and it
puts the expensive boards on known days instead of wherever the seed dropped
them. It also means a player knows what they are opening before they open it.

The boards are not equally cheap: measured on this machine, a 6x6 takes about
6s and a 6x7 about 49s, so almost all of a week's cost is in its last two days.
The spread is nothing like it was — before `sat.ts` learned clauses, identical
board sizes came in three orders of magnitude apart and several 6x7s never
finished at all. If a date ever does stall again, the cost is in refuting flips,
and `sat.ts` is the place to look rather than the seed.

Nothing scheduled goes past a 6x6, but a one-off can: a 10x10 is the largest
board the pipeline will build, and getting there took a vocabulary big enough to
seat it and one bug fixed. `fitFeatureWeights` normalised with
`Math.max(...weights)`, one weight per candidate hint — fine on a 4x5, a blown
call stack on an 8x8, and a `RangeError` from inside the fitter with nothing in
it to suggest board size. It folds now. An 8x8 takes about 89s and the 10x10
took 457s, well past the daily workflow's own timeout — a board this size can
only ever be made by hand.

That 10x10 is a *one-off*: a puzzle addressed by a name instead of a date.
`ONE_OFFS` in `shared/puzzle.ts` is the catalogue, `npm run one-off` builds
from it, and the file is `puzzles/10x10.json`. Nothing links to it. Every
scanner in the repo keys on a date-shaped filename — `regenerateManifest`,
`archiveClueMix`, `check-sat`, `runGenerate` — so a one-off reaches none of
them, and in particular never reaches the manifest the archive lists from.
`router.ts` carries an allow-list of the names in `ONE_OFFS` and routes nothing
else that is not a date, so the only way to open one is to type its slug:
`#/play/10x10`.

Being outside all of that is also why a one-off is not just another
`VariantSpec`. `runGenerate` finds its work by walking the real puzzles, takes
each one's difficulty as its aim, and names its output after a date and a
suffix; a one-off has no real puzzle behind it and no meaningful date, so it
gets `scripts/one-off.mts` instead. It is still seeded and still deterministic
— from the slug — so the committed file can be rebuilt rather than merely
trusted.

`audit-dan` is the one scanner that does look at a one-off, and it should: with
no manifest entry, no corpus role and no nightly rebuild, the audit is the only
thing standing between a one-off and shipping broken. It re-derives everything
from the file rather than from the date, so nothing about a large board is
beyond it; where a dated puzzle is checked against its own filename, a one-off
is checked against its `ONE_OFFS` entry — variant, board, and date.

Adding the 10x10 to it immediately failed a check that turned out not to
scale. "No puzzle leans on one predicate harder than a real one does" was
written as a flat cap of 7, which is 7 of the archive's 14 clue cards; the
10x10 has 62 clue cards and 25 distinct predicates, so 9 of one predicate is a
seventh of its clues against the archive's worst-case half. The cap is a share
now, floored at the old 7 so every board in the archive is checked exactly as
before — only 16 or more clue cards can reach past the old flat cap, and the
roomiest real board spends 4 of its 15. It is the same refitting that `bandsFor` and `professionShapesFor`
already do, applied to a threshold that had quietly been counted in cards.

Difficulty bands are calibrated from human labels on the source site's 4x5
archive, so two of their fields count cards and have to be refitted before they
mean anything on another board — see `bandsFor` in `shared/solver/difficulty.ts`.
The archive's profession groupings all cover twenty cards and are refitted the
same way, by `professionShapesFor`. Refitting drifts on boards far from the
calibrated twenty cards: a small board aimed at Medium tends to land on Tricky.

The vocabulary comes in tiers, and every tier past the first is gated by board
size. `NAMES` runs three passes through the alphabet for 52; `EXTRA_NAMES` adds
two more passes, and `namesFor` hands them out only to a board with more cards
than the base list can seat. `PROFESSIONS` holds sixteen — every profession the
source site uses — `EXTRA_PROFESSIONS` adds five, and `WIDE_PROFESSIONS` fifteen
more; `professionsFor` deals the second tier above twenty cards and the third
only above forty-nine, which no scheduled board reaches. Each tier exists
because the one below it runs too many cards to a profession: the archive sits
near two each, twenty-one professions on a 10x10 is five.

The gating is not tidiness. `castOf` buckets the vocabulary by initial, shuffles
each bucket, and deals round-robin, so a name added to a bucket changes which
name that bucket deals *first* — on every board, at every size. Appending to
`NAMES` outright would re-roll the cast of every puzzle already generated. Under
the gates, a board that never needed the extras draws exactly the cast it always
did, which is what `audit-dan` re-derives and checks.

Generated clues say one thing the source site's never do. On the source's 4x5
you can count the cooks at a glance; on a 6x6 with a dozen professions,
"Exactly 1 cook has an innocent below them" leaves you counting cooks before
the clue is usable. `render`'s `professionTotals` option — off by default, on
for generation — writes those as "Exactly 1 of 3 cooks has …", but only for the
shapes that count one profession's members; a comparison between two
professions is about the difference, and two totals in one sentence bury it.
The total comes out as a `#PROFN:` token rather than a number, because the
renderer works from the hint and never sees the board; the site counts the cast
when it expands the token. Because this is an extension, `render` still writes
what the source site would by default, which is what the fidelity test in
`corpus.test.ts` measures against every real puzzle.

## One-time repo setup

1. Repo Settings → Pages → Source: **GitHub Actions**.
2. `config/site.json` holds the site UUID — generated once, never regenerate.

Playable link: `https://<user>.github.io/cbs2/<UUID>/`
