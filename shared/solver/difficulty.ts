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
