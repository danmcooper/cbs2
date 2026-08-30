import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Puzzle } from '../shared/puzzle.ts';
import { validatePuzzle } from '../shared/puzzle.ts';
import type { Band, Bands } from '../shared/solver/difficulty.ts';
import { gatesPass, loadBands } from '../shared/solver/difficulty.ts';
import { GenerationError, generatePuzzle } from '../shared/solver/generate.ts';
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
  /** Dates whose file came from another date's off-band attempt instead of a
   * fresh `generatePuzzle` call. `written` still lists these dates too. */
  salvaged: { date: string; fromDate: string; label: string }[];
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

/**
 * The union of every calibrated label's `criminals` range (min of the mins,
 * max of the maxes). Measured across the 54 archived puzzles, criminal count
 * carries no difficulty signal: Medium/Tricky/Hard cluster within 0.23 of
 * each other's mean, and the two largest samples (Tricky, Hard) each span
 * nearly the full observed range — the apparent Easy/Brutal split is an
 * artifact of Brutal having only 3 samples. So generation samples criminals
 * from this union rather than the target label's own narrow range. Do not
 * narrow this back to a single label's `criminals` band — that would force,
 * e.g., every Brutal puzzle into 11-16 criminals on the strength of 3
 * samples. Calibration still records per-label criminals as information; it
 * just isn't used as a generation constraint.
 */
export function unionCriminals(bands: Bands): Band {
  const labels = Object.values(bands);
  return {
    min: Math.min(...labels.map((b) => b.criminals.min)),
    max: Math.max(...labels.map((b) => b.criminals.max)),
  };
}

/** Remove `date` from `needed.get(label)`, if present. */
function takeFromNeeded(needed: Map<string, string[]>, label: string, date: string): void {
  const list = needed.get(label);
  if (!list) return;
  const i = list.indexOf(date);
  if (i !== -1) list.splice(i, 1);
}

/**
 * Two-phase over a deterministic, date-sorted traversal. Dates lacking a `-dan`
 * sibling (or every in-scope date under `force`) are grouped by their real
 * puzzle's difficulty label into `needed`. `generatePuzzle` runs up to 25
 * attempts per date and discards every attempt whose metrics miss the target
 * band even when the attempt is a perfectly good, uniquely-solvable puzzle for
 * a *different* label — see `onOffBand` on `GenerateInput`. Rather than waste
 * that CPU, an off-band attempt is pooled (first-come, at most one per label)
 * and reused verbatim, just re-stamped with its destination date and label,
 * for the next date that needs that label — no second `generatePuzzle` call.
 *
 * Determinism: a full run from a clean directory over a fixed date set stays
 * fully deterministic (sorted traversal + date-derived seeds + first-come-wins
 * pool). A `--force` re-run over a SUBSET of dates is NOT guaranteed to
 * reproduce a salvaged puzzle byte-for-byte, because the pool that fed the
 * original run was built from dates outside the subset and will not be
 * rebuilt identically from the subset alone. That is an accepted weakening of
 * the full-run determinism guarantee, not a bug — a subset re-run is the
 * caller's problem to reconcile, not this function's.
 */
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

  const result: GenerateRunResult = { written: [], skipped: [], failed: [], salvaged: [] };

  const inScope: { date: string; label: string }[] = [];
  for (const date of dates) {
    if (!opts.force && existing.has(`${date}-dan.json`)) {
      result.skipped.push(date);
      continue;
    }
    const real = validatePuzzle(
      JSON.parse(await readFile(path.join(puzzlesDir, `${date}.json`), 'utf8')),
    );
    inScope.push({ date, label: real.difficulty });
  }

  const needed = new Map<string, string[]>();
  for (const { date, label } of inScope) {
    const list = needed.get(label) ?? [];
    list.push(date);
    needed.set(label, list);
  }

  const pool = new Map<string, Puzzle>();
  const criminalsUnion = unionCriminals(bands);

  for (const { date, label } of inScope) {
    takeFromNeeded(needed, label, date);

    const band = bands[label];
    if (!band) {
      result.failed.push({ date, reason: `no calibrated band for ${label}` });
      continue;
    }

    const pooled = pool.get(label);
    if (pooled) {
      pool.delete(label);
      const salvagedPuzzle = validatePuzzle({ ...pooled, date, difficulty: label });
      await writeFile(
        path.join(puzzlesDir, `${date}-dan.json`),
        JSON.stringify(salvagedPuzzle, null, 2) + '\n',
      );
      result.written.push(date);
      result.salvaged.push({ date, fromDate: pooled.date, label });
      continue;
    }

    try {
      const { puzzle } = generatePuzzle({
        date,
        difficulty: label,
        band: { ...band, criminals: criminalsUnion },
        seed: seedForDate(date),
        onOffBand: (candidate) => {
          const labels = [...needed.keys()]
            .filter((m) => (needed.get(m)?.length ?? 0) > 0 && !pool.has(m))
            .sort();
          for (const m of labels) {
            const mBand = bands[m];
            if (mBand && gatesPass(mBand, candidate.metrics)) {
              pool.set(m, candidate.puzzle);
              break;
            }
          }
        },
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
      const salvagedByDate = new Map(r.salvaged.map((s) => [s.date, s]));
      for (const d of r.written) {
        const s = salvagedByDate.get(d);
        console.log(s ? `generated ${d}-dan.json (salvaged from ${s.fromDate})` : `generated ${d}-dan.json`);
      }
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
