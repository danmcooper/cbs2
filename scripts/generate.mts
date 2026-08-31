import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePuzzle } from '../shared/puzzle.ts';
import type { Band, Bands } from '../shared/solver/difficulty.ts';
import { classify, loadBands } from '../shared/solver/difficulty.ts';
import { GenerationError, generatePuzzle } from '../shared/solver/generate.ts';
import { regenerateManifest } from './manifest.mts';

export interface GenerateRunOptions {
  puzzlesDir?: string;
  bandsPath?: string;
  /** Restrict to these dates; default is every real puzzle in the directory. */
  dates?: string[];
  force?: boolean;
  /**
   * Called as each date is settled, before the run finishes. A full backfill
   * takes the better part of an hour, so a caller that only learns the outcome
   * from the returned result has no idea whether it is progressing or wedged.
   */
  onProgress?: (event: GenerateProgress) => void;
}

export type GenerateProgress =
  | { date: string; outcome: 'written'; label: string; aimedAt: string; seconds: number }
  | { date: string; outcome: 'skipped' }
  | { date: string; outcome: 'failed'; reason: string };

export interface GenerateRunResult {
  /** Dates that got a `-dan.json`, with the label the puzzle measured as and
   * the label of the real puzzle for that date that generation aimed at. */
  written: { date: string; label: string; aimedAt: string }[];
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

/**
 * One puzzle per date, in a deterministic date-sorted traversal, with nothing
 * discarded. Each date aims at its real puzzle's difficulty — that label's
 * band sets the reveal ceiling and the abstraction target `generatePuzzle`
 * builds toward — but the puzzle that comes out is measured and labelled with
 * whatever it actually is, via `classify`. Nothing is rejected for missing the
 * band it aimed at.
 *
 * That replaces an earlier scheme that retried up to 25 times per date against
 * a hard band gate and pooled the rejects to fill other labels. The rejects
 * were always perfectly good puzzles, so the gate bought nothing but CPU: a
 * single exhausted date cost 8-10 minutes, and no amount of retrying makes a
 * generator hit a band it structurally cannot reach. Labelling honestly after
 * the fact gets every date a real puzzle on the first valid attempt. Whether
 * the distribution of assigned labels matches the archive's is a separate
 * question, tracked as follow-up work.
 *
 * Determinism: seeds come from the date string, so a run over any date set —
 * full or subset, fresh or `--force` — reproduces the same puzzle for a given
 * date.
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

  const result: GenerateRunResult = { written: [], skipped: [], failed: [] };
  const report = (event: GenerateProgress) => opts.onProgress?.(event);

  const inScope: { date: string; aimedAt: string }[] = [];
  for (const date of dates) {
    if (!opts.force && existing.has(`${date}-dan.json`)) {
      result.skipped.push(date);
      report({ date, outcome: 'skipped' });
      continue;
    }
    const real = validatePuzzle(
      JSON.parse(await readFile(path.join(puzzlesDir, `${date}.json`), 'utf8')),
    );
    inScope.push({ date, aimedAt: real.difficulty });
  }

  const criminalsUnion = unionCriminals(bands);

  for (const { date, aimedAt } of inScope) {
    const band = bands[aimedAt];
    if (!band) {
      const reason = `no calibrated band for ${aimedAt}`;
      result.failed.push({ date, reason });
      report({ date, outcome: 'failed', reason });
      continue;
    }

    const startedAt = Date.now();
    try {
      const { puzzle } = generatePuzzle({
        date,
        difficulty: aimedAt,
        band: { ...band, criminals: criminalsUnion },
        seed: seedForDate(date),
        labelOf: (metrics) => classify(bands, metrics),
      });
      await writeFile(
        path.join(puzzlesDir, `${date}-dan.json`),
        JSON.stringify(puzzle, null, 2) + '\n',
      );
      result.written.push({ date, label: puzzle.difficulty, aimedAt });
      report({
        date,
        outcome: 'written',
        label: puzzle.difficulty,
        aimedAt,
        seconds: (Date.now() - startedAt) / 1000,
      });
    } catch (e) {
      if (!(e instanceof GenerationError)) throw e;
      const reason = e.message.split('\n')[0];
      result.failed.push({ date, reason });
      report({ date, outcome: 'failed', reason });
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
  runGenerate({
    force,
    dates: dates.length ? dates : undefined,
    onProgress: (e) => {
      if (e.outcome === 'skipped') return;
      if (e.outcome === 'failed') {
        console.error(`FAILED ${e.date}: ${e.reason}`);
        return;
      }
      const aim = e.label === e.aimedAt ? e.label : `${e.label} (aimed ${e.aimedAt})`;
      console.log(`generated ${e.date}-dan.json  ${aim}  ${e.seconds.toFixed(1)}s`);
    },
  }).then(
    (r) => {
      const byLabel = new Map<string, number>();
      for (const w of r.written) byLabel.set(w.label, (byLabel.get(w.label) ?? 0) + 1);
      console.log(
        `\n${r.written.length} generated, ${r.skipped.length} skipped, ${r.failed.length} failed`,
      );
      if (byLabel.size) {
        console.log([...byLabel].sort().map(([k, v]) => `${k}=${v}`).join(' '));
      }
      if (r.failed.length) process.exit(1);
    },
    (e) => {
      console.error(String(e));
      process.exit(1);
    },
  );
}
