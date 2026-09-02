import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VARIANTS, type Variant, validatePuzzle } from '../shared/puzzle.ts';
import type { Band, Bands } from '../shared/solver/difficulty.ts';
import { bandsFor, classify, loadBands } from '../shared/solver/difficulty.ts';
import { archiveClueMix } from '../shared/solver/corpus.ts';
import { GenerationError, generatePuzzle } from '../shared/solver/generate.ts';
import { regenerateManifest } from './manifest.mts';

/** One generated sibling to build for each date. */
export interface VariantSpec {
  variant: Variant;
  /** The board to fill; `'inherit'` takes the real puzzle's own. */
  board: { width: number; height: number } | 'inherit';
  /**
   * Appended to the date to make the rng seed, so two variants that happen to
   * share a board still get different puzzles. Empty for `dan`: its 56 files
   * were generated from the bare date, before there was more than one variant,
   * and salting the key now would regenerate every one of them differently.
   */
  seedSalt: string;
}

/**
 * What a backfill builds: the original sibling on the real puzzle's own board,
 * and a Dan Long one on a 5x6 board the source site never uses. Thirty cards
 * rather than twenty is well past what enumeration could solve — it is only
 * reachable at all because the backbone comes from a SAT engine — so a Dan Long
 * puzzle takes seconds where a Dan one takes tenths.
 */
export const DEFAULT_VARIANTS: readonly VariantSpec[] = [
  { variant: 'dan', board: 'inherit', seedSalt: '' },
  { variant: 'dan-long', board: { width: 5, height: 6 }, seedSalt: '-dan-long' },
];

export interface GenerateRunOptions {
  puzzlesDir?: string;
  bandsPath?: string;
  /** Restrict to these dates; default is every real puzzle in the directory. */
  dates?: string[];
  /** Which siblings to build per date; default is `DEFAULT_VARIANTS`. */
  variants?: readonly VariantSpec[];
  force?: boolean;
  /**
   * Called as each date is settled, before the run finishes. A full backfill
   * takes the better part of an hour, so a caller that only learns the outcome
   * from the returned result has no idea whether it is progressing or wedged.
   */
  onProgress?: (event: GenerateProgress) => void;
}

export type GenerateProgress = { date: string; variant: Variant } & (
  | { outcome: 'written'; label: string; aimedAt: string; seconds: number }
  | { outcome: 'skipped' }
  | { outcome: 'failed'; reason: string }
);

export interface GenerateRunResult {
  /** Date/variant pairs that got a file, with the label the puzzle measured as
   * and the label of the real puzzle for that date that generation aimed at. */
  written: { date: string; variant: Variant; label: string; aimedAt: string }[];
  skipped: { date: string; variant: Variant }[];
  failed: { date: string; variant: Variant; reason: string }[];
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
 * One puzzle per date per variant, in a deterministic date-sorted traversal,
 * with nothing discarded. Each date aims at its real puzzle's difficulty — that label's
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
 * Determinism: seeds come from the date string and the variant's own salt, so
 * a run over any date set — full or subset, fresh or `--force` — reproduces
 * the same puzzle for a given date and variant.
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

  // A generated puzzle is a sibling of the real one for its date, so unless its
  // variant names a board of its own it gets that puzzle's. Every real puzzle is
  // 4x5; inheriting rather than hardcoding is what lets the tests point
  // generation at a smaller archive and finish in seconds, since solving is
  // exponential in the number of cards.
  const variants = opts.variants ?? DEFAULT_VARIANTS;
  const inScope: {
    date: string;
    spec: VariantSpec;
    aimedAt: string;
    width: number;
    height: number;
  }[] = [];
  for (const date of dates) {
    let real: ReturnType<typeof validatePuzzle> | undefined;
    for (const spec of variants) {
      const file = `${date}${VARIANTS[spec.variant].suffix}.json`;
      if (!opts.force && existing.has(file)) {
        result.skipped.push({ date, variant: spec.variant });
        report({ date, variant: spec.variant, outcome: 'skipped' });
        continue;
      }
      real ??= validatePuzzle(
        JSON.parse(await readFile(path.join(puzzlesDir, `${date}.json`), 'utf8')),
      );
      const board = spec.board === 'inherit' ? { width: real.width, height: real.height } : spec.board;
      inScope.push({ date, spec, aimedAt: real.difficulty, ...board });
    }
  }

  const criminalsUnion = unionCriminals(bands);
  // Read once for the whole run: the archive it measures does not change mid-run,
  // and it is the same mix for every date.
  const mix = archiveClueMix(puzzlesDir);

  for (const { date, spec, aimedAt, width, height } of inScope) {
    const variant = spec.variant;
    const band = bands[aimedAt];
    if (!band) {
      const reason = `no calibrated band for ${aimedAt}`;
      result.failed.push({ date, variant, reason });
      report({ date, variant, outcome: 'failed', reason });
      continue;
    }

    const startedAt = Date.now();
    try {
      const { puzzle } = generatePuzzle({
        date,
        difficulty: aimedAt,
        band: { ...band, criminals: criminalsUnion },
        seed: seedForDate(date + spec.seedSalt),
        mix,
        width,
        height,
        variant,
        // Bands are calibrated on the archive's 4x5 board, so a variant that
        // asks for a different one has to be classified against bands refitted
        // to it. This is the identity for a Dan puzzle and not for a Dan Long.
        labelOf: (metrics) => classify(bandsFor(bands, width * height), metrics),
      });
      await writeFile(
        path.join(puzzlesDir, `${date}${VARIANTS[variant].suffix}.json`),
        JSON.stringify(puzzle, null, 2) + '\n',
      );
      result.written.push({ date, variant, label: puzzle.difficulty, aimedAt });
      report({
        date,
        variant,
        outcome: 'written',
        label: puzzle.difficulty,
        aimedAt,
        seconds: (Date.now() - startedAt) / 1000,
      });
    } catch (e) {
      if (!(e instanceof GenerationError)) throw e;
      const reason = e.message.split('\n')[0];
      result.failed.push({ date, variant, reason });
      report({ date, variant, outcome: 'failed', reason });
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
  // `--variant dan-long` narrows a backfill to one sibling. A Dan Long puzzle
  // costs seconds where a Dan one costs tenths, so being able to run the two
  // separately is the difference between a minute and an afternoon.
  const named = args.filter((a) => a in VARIANTS) as Variant[];
  const unknown = args.filter(
    (a) => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a) && !(a in VARIANTS),
  );
  if (unknown.length) {
    console.error(
      `unrecognised argument ${unknown[0]} — expected a date, --force, or one of ` +
        Object.keys(VARIANTS).join(', '),
    );
    process.exit(2);
  }
  runGenerate({
    force,
    dates: dates.length ? dates : undefined,
    variants: named.length
      ? DEFAULT_VARIANTS.filter((v) => named.includes(v.variant))
      : undefined,
    onProgress: (e) => {
      if (e.outcome === 'skipped') return;
      if (e.outcome === 'failed') {
        console.error(`FAILED ${e.date} ${e.variant}: ${e.reason}`);
        return;
      }
      const aim = e.label === e.aimedAt ? e.label : `${e.label} (aimed ${e.aimedAt})`;
      const file = `${e.date}${VARIANTS[e.variant].suffix}.json`;
      console.log(`generated ${file}  ${aim}  ${e.seconds.toFixed(1)}s`);
    },
  }).then(
    (r) => {
      const byLabel = new Map<string, number>();
      for (const w of r.written) {
        const key = `${w.variant}/${w.label}`;
        byLabel.set(key, (byLabel.get(key) ?? 0) + 1);
      }
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
