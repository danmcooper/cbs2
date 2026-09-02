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
  (`2026-07-01` for one date, `dan-long` for one variant, `--force` to redo existing ones)
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
| `dan` | `YYYY-MM-DD-dan.json` | the real puzzle's own |
| `dan-long` | `YYYY-MM-DD-dan-long.json` | 5x6 |

Difficulty bands are calibrated from human labels on the source site's 4x5
archive, so two of their fields count cards and have to be refitted before they
mean anything on another board — see `bandsFor` in `shared/solver/difficulty.ts`.
The archive's profession groupings all cover twenty cards and are refitted the
same way, by `professionShapesFor`.

## One-time repo setup

1. Repo Settings → Pages → Source: **GitHub Actions**.
2. `config/site.json` holds the site UUID — generated once, never regenerate.

Playable link: `https://<user>.github.io/cbs2/<UUID>/`
