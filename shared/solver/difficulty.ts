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
  abstractShare: number;
}

/**
 * Clue forms that pin down *which* card or unit, or *how much* two units
 * overlap, rather than yielding a number outright. The solver enumerates all
 * assignments so phrasing costs it nothing, but these force a human into case
 * analysis instead of arithmetic. Their share of a puzzle's clues is the
 * single strongest human-difficulty signal in the archive (Spearman 0.546
 * against the source site's own labels, monotone across all five: 0.176,
 * 0.277, 0.335, 0.350, 0.607) and it survives partialling out clue count
 * (0.259) and chain length (0.302).
 */
export const ABSTRACT_PREDICATES: ReadonlySet<string> = new Set([
  'is_one_of_n_traits_in_unit',
  'unit_shares_n_out_of_n_traits_with_unit',
  'only_one_unit_has_exactly_n_traits',
  'only_unit_has_exactly_n_traits',
  'only_one_person_in_unit_has_exactly_n_trait_neighbors',
  'is_not_only_trait_in_unit',
]);

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
  let clueCards = 0;
  let abstractCount = 0;
  for (const hint of input.clues) {
    if (!hint) continue;
    clueCards++;
    predicateMix[hint.pred] = (predicateMix[hint.pred] ?? 0) + 1;
    if (ABSTRACT_PREDICATES.has(hint.pred)) abstractCount++;
  }

  return {
    criminals: input.truth.filter(Boolean).length,
    clueCards,
    chainLength: chain.steps.length,
    meanRevealsPerStep: mean(revealCounts),
    maxRevealsPerStep: max(revealCounts),
    meanPathSize: mean(shortest),
    maxPathSize: max(shortest),
    predicateMix,
    abstractShare: clueCards === 0 ? 0 : abstractCount / clueCards,
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
  abstractShare: Band;
}

export type Bands = Record<string, LabelBand>;

export class InsufficientSamplesError extends Error {}

const BANDED = [
  'criminals',
  'clueCards',
  'chainLength',
  'meanRevealsPerStep',
  'meanPathSize',
  'abstractShare',
] as const;

/**
 * Metrics that gate a generated puzzle after the fact.
 *
 * `criminals` is excluded because criminal count carries no difficulty
 * signal (rho 0.301, and Medium/Tricky/Hard means sit within 0.23 of each
 * other): generation samples it from the union of every label's range
 * rather than the target label's own band, so gating on it here would
 * reject puzzles for a distinction that isn't real. It is still recorded in
 * `BANDED` as information.
 *
 * `meanRevealsPerStep` is excluded because it is redundant with
 * `chainLength`, not because it lacks signal: rho(chainLength,
 * meanRevealsPerStep) = -1.0000 exactly, and chainLength ×
 * meanRevealsPerStep = 19 for every one of the 54 archived puzzles — a
 * single distinct value, because both are just views of "cards the chain
 * must reveal" (20 minus the one initial reveal). Gating both would gate one
 * quantity twice and over-constrain generation for no added discrimination.
 * It stays in `BANDED` for the same reason: still worth recording, just not
 * worth enforcing on top of `chainLength`.
 *
 * `meanPathSize` is excluded not because it lacks signal but because the
 * generator cannot currently reach it. Measured like-for-like — recomputing
 * each archived card's stored reveal-prefix path through `minimalPaths` so
 * the archive is measured the same way a generated puzzle is (see
 * `scripts/calibrate.mts`) — it is the STRONGEST human-difficulty signal
 * available: rho +0.686, monotone across four of five labels (Easy 2.52,
 * Medium 2.78, Tricky 3.08, Hard 3.53; Brutal 3.07 on only 3 samples),
 * beating both `abstractShare` (+0.546) and `clueCards` (-0.565). But
 * `buildChain` + `minimalPaths` on a freshly generated chain lands
 * `meanPathSize` around 1.3–1.9 regardless of label — well below even Easy's
 * calibrated floor — because generated chains currently need less
 * supporting context per deduction than any archived puzzle.
 *
 * That gap is not an artifact of the minimiser stalling higher when seeded
 * from the archive's larger stored paths, which was the obvious confound.
 * Re-running the archive side with `minimalPaths(..., attempts=12)` instead of
 * the default 3 moves the means by -0.158 (2026-07-13 Easy 2.579→2.421),
 * -0.158 (2026-07-07 Medium 2.474→2.316) and 0.000 (2026-07-12 Brutal 3.368).
 * A ~6% shift does not close a gap of 1.0-1.5, and the label ordering is
 * unchanged, so the archive really does demand more support per deduction.
 *
 * Gating on it
 * today would make every label unreachable. It stays in `BANDED` so the gap
 * is recorded and visible; closing it (so generated puzzles genuinely need
 * as much support per card as their label implies) is tracked as follow-up
 * work, not papered over by gating on a target the generator cannot hit.
 */
const GATED = ['clueCards', 'chainLength', 'abstractShare'] as const;

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

/**
 * The calibrated label that best describes these metrics.
 *
 * Generation does not reject a puzzle for missing a target band — a valid,
 * uniquely-solvable puzzle is worth keeping whatever its metrics say, and
 * discarding one costs minutes of CPU to rebuild something no better. Instead
 * every generated puzzle is measured and then labelled with whatever it
 * actually is, which is what this decides.
 *
 * Labels are ranked on two keys, in order:
 *
 * 1. How far outside the band the metrics fall, summed over the gated
 *    metrics, each normalised by that metric's full range across all labels
 *    so no single metric dominates for having wider numbers. Zero means the
 *    band contains the puzzle outright.
 * 2. How far the metrics sit from the band's midpoint, normalised the same
 *    way. The calibrated bands overlap heavily — Tricky's `clueCards` range
 *    alone covers most of the archive — so containment is usually true of
 *    several labels at once, and without this key the choice among them
 *    would come down to nothing but label spelling.
 *
 * Ties after both keys break on label name, so the result depends only on
 * the metrics and the band file, never on iteration order.
 */
export function classify(bands: Bands, m: Metrics): string {
  const labels = Object.keys(bands).sort();
  if (labels.length === 0) throw new BandsFormatError('no calibrated bands to classify against');

  const span: Record<string, number> = {};
  for (const key of GATED) {
    const lo = Math.min(...labels.map((l) => bands[l][key].min));
    const hi = Math.max(...labels.map((l) => bands[l][key].max));
    // A metric identical across every label discriminates nothing; a span of
    // 1 keeps it from dividing by zero and leaves its contribution finite.
    span[key] = hi > lo ? hi - lo : 1;
  }

  const scored = labels.map((label) => {
    let outside = 0;
    let fromMid = 0;
    for (const key of GATED) {
      const b = bands[label][key];
      outside += Math.max(0, b.min - m[key], m[key] - b.max) / span[key];
      fromMid += Math.abs(m[key] - (b.min + b.max) / 2) / span[key];
    }
    return { label, outside, fromMid };
  });

  scored.sort((a, b) => a.outside - b.outside || a.fromMid - b.fromMid || (a.label < b.label ? -1 : 1));
  return scored[0].label;
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
