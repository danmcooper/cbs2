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

Nothing scheduled goes past a 6x6, but the pipeline will build far bigger by
hand, and getting there took a vocabulary big enough to seat those boards and
one bug fixed. `fitFeatureWeights` normalised with `Math.max(...weights)`, one
weight per candidate hint — fine on a 4x5, a blown call stack on an 8x8, and a
`RangeError` from inside the fitter with nothing in it to suggest board size. It
folds now. An 8x8 takes about 89s and a 10x10 457s, well past the daily
workflow's own timeout, so a board that size can only ever be made by hand.

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
