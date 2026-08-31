import { type Person, type Puzzle, validatePuzzle } from '../puzzle';
import { candidateHints, namedCards } from './candidates';
import { ABSTRACT_PREDICATES, type LabelBand, type Metrics, gatesPass, measure } from './difficulty';
import type { Shape } from './enumerate';
import { makeGrid } from './grid';
import { type Hint, formatHint } from './hint';
import { makeBoard } from './predicates';
import { render } from './render';
import { type Clues, forcedGiven, isUniquelySolvable, minimalPaths, solveChain } from './solve';
import { FLAVOUR, NAMES, PROFESSIONS, TITLES, faceOf } from './vocab';

const WIDTH = 4;
const HEIGHT = 5;
const SIZE = WIDTH * HEIGHT;

export class GenerationError extends Error {}

/** mulberry32 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));

function shuffled<T>(rng: () => number, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface GenerateInput {
  date: string;
  difficulty: string;
  band: LabelBand;
  seed: number;
  maxAttempts?: number;
  trialsPerStep?: number;
  /**
   * Names the difficulty of a finished attempt from its own metrics, and by
   * being present switches off band rejection entirely: the first attempt
   * that is uniquely solvable, fully chained, and path-reachable on every
   * card is returned, carrying the label this returns rather than
   * `difficulty`.
   *
   * This is how generation is driven in practice. A valid puzzle is worth
   * keeping whatever its metrics turn out to be — throwing one away costs
   * minutes of CPU to rebuild something no better, and the archive is full of
   * labels we can hand out honestly. `band` still shapes the attempt (it sets
   * the reveal ceiling and the abstraction target), so a date still aims at
   * its real puzzle's difficulty; it just no longer rejects for missing.
   *
   * Without it, the old behaviour stands: attempts that miss `band` are
   * discarded and the puzzle keeps the requested `difficulty`.
   */
  labelOf?: (metrics: Metrics) => string;
}

export interface GenerateResult {
  puzzle: Puzzle;
  seed: number;
  attempt: number;
  metrics: Metrics;
}

function hexId(rng: () => number): string {
  let out = '';
  for (let i = 0; i < 12; i++) out += Math.floor(rng() * 16).toString(16);
  return out;
}

interface Cast {
  names: string[];
  genders: ('male' | 'female')[];
  professions: string[];
  faces: string[];
}

function castOf(rng: () => number): Cast {
  const people = shuffled(rng, NAMES).slice(0, SIZE);
  const chosen = shuffled(rng, PROFESSIONS).slice(0, 5);
  const slots: string[] = [];
  for (let i = 0; i < SIZE; i++) slots.push(chosen[i % chosen.length].key);
  const professions = shuffled(rng, slots);
  return {
    names: people.map((p) => p.name),
    genders: people.map((p) => p.gender),
    professions,
    faces: professions.map((key, i) => faceOf(key, people[i].gender)),
  };
}

interface ChainBuild {
  clues: Clues;
  flippedAt: number[][];
}

/** Grow a forcing chain from the initial reveal. Returns null if it stalls. */
function buildChain(
  rng: () => number,
  shape: Shape,
  truth: boolean[],
  pool: Hint[],
  initialReveals: number[],
  trialsPerStep: number,
  maxReveals: number,
  targetAbstractShare: number,
): ChainBuild | null {
  const board = makeBoard(shape.grid, shape.professions, truth);
  const clues: Clues = Array.from({ length: SIZE }, () => null);
  const flippedAt: number[][] = Array.from({ length: SIZE }, () => []);
  let flipped = [...initialReveals].sort((a, b) => a - b);
  let cursor = 0;
  let abstractChosen = 0;
  let totalChosen = 0;

  while (flipped.length < SIZE) {
    const hosts = shuffled(
      rng,
      flipped.filter((i) => clues[i] === null),
    );
    let progressed = false;

    for (const host of hosts) {
      // Bias toward the target abstractShare: when the running share among
      // clues chosen so far sits below the target band's midpoint, prefer a
      // candidate from the abstract predicate family for this step; at or
      // above it, prefer one outside the family. A candidate is only ever
      // accepted once it has passed the exact same forcedGiven/maxReveals
      // check as before, so this never trades away correctness — and if no
      // candidate of the preferred kind turns up within the trial budget,
      // the first valid candidate found (the old, unbiased behavior) is used.
      const currentShare = totalChosen === 0 ? 0 : abstractChosen / totalChosen;
      const preferAbstract = currentShare < targetAbstractShare;

      let tried = 0;
      let firstValid: { hint: Hint; reveals: number[] } | null = null;
      let preferredValid: { hint: Hint; reveals: number[] } | null = null;

      while (tried < trialsPerStep && cursor < pool.length && !preferredValid) {
        const hint = pool[cursor++];
        tried++;
        // Once a fallback is in hand, a candidate can only possibly improve on
        // it by being of the preferred kind — so skip the expensive
        // forcedGiven/reveal check entirely for the wrong kind. This is a pure
        // cost optimization: it changes nothing about which candidate is
        // eventually chosen (a wrong-kind candidate was never going to beat an
        // existing firstValid anyway), it just avoids paying for a check whose
        // answer cannot change the outcome.
        if (firstValid && ABSTRACT_PREDICATES.has(hint.pred) !== preferAbstract) continue;
        if (namedCards(board, hint).has(host)) continue;
        clues[host] = hint;
        const forced = forcedGiven(shape, clues, truth, flipped);
        const reveals: number[] = [];
        for (let i = 0; i < SIZE; i++) {
          if (!flipped.includes(i) && forced[i] !== null) reveals.push(i);
        }
        clues[host] = null;
        if (reveals.length === 0 || reveals.length > maxReveals) continue;

        if (!firstValid) firstValid = { hint, reveals };
        if (ABSTRACT_PREDICATES.has(hint.pred) === preferAbstract) {
          preferredValid = { hint, reveals };
        }
      }

      const chosen = preferredValid ?? firstValid;
      if (!chosen) continue;

      clues[host] = chosen.hint;
      for (const i of chosen.reveals) flippedAt[i] = [...flipped];
      flipped = [...flipped, ...chosen.reveals].sort((a, b) => a - b);
      totalChosen++;
      if (ABSTRACT_PREDICATES.has(chosen.hint.pred)) abstractChosen++;
      progressed = true;
      break;
    }

    if (!progressed) return null;
  }

  return { clues, flippedAt };
}

export function generatePuzzle(input: GenerateInput): GenerateResult {
  const maxAttempts = input.maxAttempts ?? 25;
  const trialsPerStep = input.trialsPerStep ?? 80;
  const failures: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = makeRng(input.seed + attempt * 7919);
    const grid = makeGrid(WIDTH, HEIGHT);
    const cast = castOf(rng);
    const shape: Shape = { grid, professions: cast.professions };

    const criminals = randInt(rng, input.band.criminals.min, input.band.criminals.max);
    const criminalSet = new Set(shuffled(rng, [...Array(SIZE).keys()]).slice(0, criminals));
    const truth = Array.from({ length: SIZE }, (_, i) => criminalSet.has(i));

    const board = makeBoard(grid, cast.professions, truth);
    const pool = shuffled(rng, candidateHints(board));
    const initialReveals = [randInt(rng, 0, SIZE - 1)];

    const maxReveals = Math.max(2, Math.ceil(input.band.meanRevealsPerStep.max));
    const targetAbstractShare =
      (input.band.abstractShare.min + input.band.abstractShare.max) / 2;
    const built = buildChain(
      rng,
      shape,
      truth,
      pool,
      initialReveals,
      trialsPerStep,
      maxReveals,
      targetAbstractShare,
    );
    if (!built) {
      failures.push(`attempt ${attempt}: chain stalled`);
      continue;
    }

    let unreachable = -1;
    const paths: number[][][] = truth.map((_, i) => {
      if (initialReveals.includes(i)) return [];
      const p = minimalPaths(shape, built.clues, truth, i, built.flippedAt[i]);
      if (p.length === 0) unreachable = i;
      return p;
    });
    if (unreachable !== -1) {
      failures.push(`attempt ${attempt}: card ${unreachable} has no sufficient path`);
      continue;
    }

    const chain = solveChain(shape, built.clues, truth, initialReveals);
    const metrics = measure({ shape, clues: built.clues, truth, initialReveals, paths });
    if (!chain.solvedAll || !isUniquelySolvable(shape, built.clues, truth)) {
      failures.push(`attempt ${attempt}: not uniquely solvable`);
      continue;
    }

    const flavour = shuffled(rng, FLAVOUR);
    let flavourAt = 0;
    const people: Person[] = truth.map((criminal, i) => {
      const hint = built.clues[i];
      return {
        name: cast.names[i],
        profession: cast.professions[i],
        gender: cast.genders[i],
        criminal,
        clue: hint ? render(hint) : flavour[flavourAt++ % flavour.length],
        origHint: hint ? formatHint(hint) : null,
        paths: paths[i],
        face: cast.faces[i],
      };
    });

    const puzzle: Puzzle = {
      formatVersion: 1,
      id: hexId(rng),
      date: input.date,
      title: TITLES[Math.floor(rng() * TITLES.length)],
      difficulty: input.labelOf ? input.labelOf(metrics) : input.difficulty,
      width: WIDTH,
      height: HEIGHT,
      initialReveals,
      source: 'generated',
      variant: 'dan',
      people,
      hints: chain.steps,
    };

    validatePuzzle(puzzle);

    if (!input.labelOf && !gatesPass(input.band, metrics)) {
      failures.push(
        `attempt ${attempt}: out of band (chain=${metrics.chainLength} ` +
          `clues=${metrics.clueCards} path=${metrics.meanPathSize.toFixed(2)})`,
      );
      continue;
    }

    return { puzzle, seed: input.seed + attempt * 7919, attempt, metrics };
  }

  throw new GenerationError(
    `no puzzle after ${maxAttempts} attempts:\n  ${failures.join('\n  ')}`,
  );
}
