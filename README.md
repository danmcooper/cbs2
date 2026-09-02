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
| `dan` | `YYYY-MM-DD-dan.json` | drawn from the date, 3x3 to 7x7 |

A Dan puzzle does not inherit the real puzzle's board. `randomBoard` in
`scripts/generate.mts` draws two numbers in 3–7 from the date's own seed and
takes the smaller as the width, so the board is always at least as tall as it is
wide and the date alone decides it. The draw has its own seed key, so changing
one variant's board cannot reshuffle another's contents.

The boards are not equally cheap — a 3x3 generates in about a second, the two
7x7s in 34s and 63s — but the spread is nothing like it was. Before `sat.ts` learned
clauses, identical board sizes came in three orders of magnitude apart and
several 6x7s never finished at all; the whole 57-date backfill now runs in a few
minutes. If a date ever does stall again, the cost is in refuting flips, and
`sat.ts` is the place to look rather than the seed.

Difficulty bands are calibrated from human labels on the source site's 4x5
archive, so two of their fields count cards and have to be refitted before they
mean anything on another board — see `bandsFor` in `shared/solver/difficulty.ts`.
The archive's profession groupings all cover twenty cards and are refitted the
same way, by `professionShapesFor`. Refitting drifts on boards far from the
calibrated twenty cards: a small board aimed at Medium tends to land on Tricky.

The vocabulary is sized for the largest board rather than the average one.
`NAMES` runs three passes through the alphabet because a 7x7 needs forty-nine
distinct names, and `PROFESSIONS` holds sixteen — every profession the source
site uses — with five more in `EXTRA_PROFESSIONS` that `professionsFor` deals in
only above twenty cards, where the base set would otherwise run
three-to-a-profession. A board the size of the archive's or smaller draws
exactly the cast it always did.

## One-time repo setup

1. Repo Settings → Pages → Source: **GitHub Actions**.
2. `config/site.json` holds the site UUID — generated once, never regenerate.

Playable link: `https://<user>.github.io/cbs2/<UUID>/`
