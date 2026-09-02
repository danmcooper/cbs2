import { type Person, type Puzzle, type Variant, validatePuzzle } from '../puzzle';
import { candidateHints, namedCards } from './candidates';
// Type-only: corpus.ts reads the filesystem, and this import is erased at build time.
import type { ClueMix } from './corpus';
import {
  ABSTRACT_PREDICATES,
  type LabelBand,
  type Metrics,
  bandsFor,
  gatesPass,
  measure,
} from './difficulty';
import type { Shape } from './enumerate';
import { type Grid, edgeMembers, makeGrid } from './grid';
import { type Hint, formatHint } from './hint';
import { type Board, hintFeatures, makeBoard } from './predicates';
import { render } from './render';
import {
  type Clues,
  forcedGiven,
  hintSteps,
  isUniquelySolvable,
  minimalPaths,
  solveChain,
} from './solve';
import { FLAVOUR, NAMES, PROFESSIONS, TITLES, type VocabPerson, faceOf } from './vocab';

/** Every archived puzzle is 4x5, and so is every puzzle we ship. */
const DEFAULT_WIDTH = 4;
const DEFAULT_HEIGHT = 5;
const DEFAULT_SIZE = DEFAULT_WIDTH * DEFAULT_HEIGHT;

/** Fitting passes in `fitFeatureWeights`. The marginals are within a fraction of
 * a percent of target well before this, and the whole fit costs milliseconds. */
const FIT_PASSES = 32;

/** How much of each pass's correction `fitFeatureWeights` applies. Square roots
 * converge on this pool in a dozen passes; the full correction does not converge
 * at all. */
const FIT_DAMPING = 0.5;

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

export function shuffled<T>(rng: () => number, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Share of a puzzle's criminals the archive puts on the edge: 331 of 503 across
 * the 54 puzzles, against the 70% a uniform draw over a 4x5 board would give
 * (t = -2.30, p = 0.025). */
const EDGE_CRIMINAL_SHARE = 331 / 503;

/**
 * Which cards are criminal, drawn leaning slightly inward.
 *
 * A uniform draw puts criminals on the edge at whatever rate the board is edge —
 * 70% of a 4x5. The archive runs below that, and the difference is not nothing
 * to play against: an interior card touches eight others where a corner touches
 * three, so the neighbour clues that carry most of the deduction have more to
 * say about an interior criminal. Generated puzzles came out at the uniform
 * rate, which made their neighbour clues quietly thinner than the real ones.
 *
 * The weight is solved from the board rather than tuned: with `e` edge cards and
 * `n` interior ones, giving each interior card weight `w` would make the edge
 * share `e / (e + n*w)` if cards were drawn one at a time with replacement, so
 * `w = e*(1 - share) / (n*share)`. Drawing without replacement — Efraimidis-
 * Spirakis, the same scheme `orderPool` uses — pulls the result back toward
 * uniform, because a region that has given up several cards has fewer left to
 * give: nine criminals on a 4x5 land at 67.0% rather than the 65.8% asked for,
 * against 70.0% uniform. That is most of the gap, and the remainder sits inside
 * the archive's own standard error of 1.6 points, so it is not worth a scheme
 * that trades this one's guarantees — every card reachable, exactly `count`
 * returned — for a decimal place.
 */
export function pickCriminals(rng: () => number, grid: Grid, count: number): number[] {
  const edge = new Set(edgeMembers(grid));
  const interior = grid.size - edge.size;
  const weight =
    interior === 0
      ? 1
      : (edge.size * (1 - EDGE_CRIMINAL_SHARE)) / (interior * EDGE_CRIMINAL_SHARE);
  return [...Array(grid.size).keys()]
    .map((i) => ({ i, key: -Math.log(rng() || Number.MIN_VALUE) / (edge.has(i) ? 1 : weight) }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count)
    .map((e) => e.i);
}

function shareIn<T>(xs: readonly T[], keys: (x: T) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const x of xs) {
    for (const k of keys(x)) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      total++;
    }
  }
  for (const [k, n] of counts) counts.set(k, n / total);
  return counts;
}

/**
 * Order the candidate pool so that walking it front-to-back draws clues in
 * roughly the archive's proportions rather than the pool's own.
 *
 * `buildChain` scans this list and takes the first candidate that makes
 * progress, so the ordering — not any later filter — is what decides what a
 * puzzle is made of. Shuffling uniformly (what this used to do) reproduces the
 * pool's combinatorial shape: 58% of unit slots came out `between` against the
 * archive's 29%, and `number_of_traits_in_unit`, the archive's most common
 * clue at 14% of all clues, is 1.1% of the pool and so all but never appeared.
 *
 * Each candidate is weighted by how far its predicate and its features (unit
 * kinds, between-span lengths, directions — see `hintFeatures`) are over- or
 * under-represented in the pool relative to the archive, then drawn without
 * replacement by the Efraimidis–Spirakis trick (sort by -ln(u)/w), which is one
 * O(n log n) sort instead of the O(n^2) of renormalising after every draw.
 * Features are applied first and the predicate correction is measured against
 * the already-feature-weighted mass, so the two corrections compose instead of
 * fighting: the expected predicate mix is the archive's, and within a predicate
 * the features lean the archive's way too.
 *
 * Nothing is dropped. A candidate the archive never uses would get weight 0 and
 * sort to the back, but every predicate and feature `candidateHints` emits does
 * appear in the archive, so in practice this only reorders.
 */
/**
 * Per-hint weights whose feature marginals match `target`.
 *
 * Scaling each feature once by target/pool — what this used to do — does not
 * land on the target. A hint's weight is the product of its features' factors,
 * so a clue naming two profession groups picks the profession factor up twice,
 * and that factor is large: profession groups are 0.4% of the pool's unit slots
 * against the archive's 7%. The head came out at three times the archive's
 * profession rate, which is a worse error than the under-correction it was
 * fixing — the player notices "there are more criminal judges than criminal
 * doctors" twice a puzzle instead of once.
 *
 * So iterate: measure the weighted marginals, correct each feature by how far it
 * still is from target, repeat. This is iterative proportional fitting, and a
 * couple of dozen passes over precomputed feature lists costs nothing next to
 * the solving that follows.
 *
 * Two details keep the iteration on its feet. It is damped, because a feature
 * that is scarce in the pool and common in the archive asks for a big correction
 * and the hints carrying it carry other features too, so the full correction
 * overshoots those and the next pass overshoots back: undamped, the marginals
 * oscillate instead of settling, and the error is worse at pass 7 than at pass
 * 1. And the weights are rescaled each pass, because their absolute size is
 * meaningless — only ratios reach the draw — and left alone the product of
 * corrections runs to Infinity, at which point every weight is Infinity, every
 * sort key is 0, and the ordering is whatever order the pool was built in.
 */
function fitFeatureWeights(featureSets: readonly string[][], target: Record<string, number>): number[] {
  const keys = [...new Set(featureSets.flat())];
  let weights = featureSets.map(() => 1);
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    const mass = new Map<string, number>();
    let total = 0;
    featureSets.forEach((fs, i) => {
      for (const f of fs) {
        mass.set(f, (mass.get(f) ?? 0) + weights[i]);
        total += weights[i];
      }
    });
    if (total === 0) break;
    const correction = new Map<string, number>();
    for (const k of keys) {
      const want = target[k] ?? 0;
      const share = (mass.get(k) ?? 0) / total;
      // A feature the archive never uses goes to zero and stays there. One whose
      // carriers have all been zeroed by some *other* feature cannot be lifted,
      // so leave it be rather than dividing by zero.
      correction.set(k, want === 0 ? 0 : share > 0 ? (want / share) ** FIT_DAMPING : 1);
    }
    weights = weights.map((w, i) =>
      featureSets[i].reduce((acc, f) => acc * (correction.get(f) as number), w),
    );
    const max = Math.max(...weights);
    if (max > 0) weights = weights.map((w) => w / max);
  }
  return weights;
}

export function orderPool(
  rng: () => number,
  board: Board,
  pool: readonly Hint[],
  mix: ClueMix,
): Hint[] {
  const featureSets = pool.map((hint) => hintFeatures(board, hint));
  const byFeature = fitFeatureWeights(featureSets, mix.feature);

  const predMass = new Map<string, number>();
  let mass = 0;
  pool.forEach((hint, i) => {
    predMass.set(hint.pred, (predMass.get(hint.pred) ?? 0) + byFeature[i]);
    mass += byFeature[i];
  });

  return pool
    .map((hint, i) => {
      const share = (predMass.get(hint.pred) as number) / mass;
      const w = share === 0 ? 0 : byFeature[i] * ((mix.pred[hint.pred] ?? 0) / share);
      // Math.log(0) is -Infinity, so a zero weight sorts last rather than first.
      const u = rng() || Number.MIN_VALUE;
      return { hint, key: w > 0 ? -Math.log(u) / w : Infinity };
    })
    .sort((a, b) => a.key - b.key)
    .map((e) => e.hint);
}

export interface GenerateInput {
  date: string;
  difficulty: string;
  band: LabelBand;
  seed: number;
  /**
   * Archive clue proportions, from `archiveClueMix()`. Required rather than
   * defaulted: without it the candidate pool's own combinatorial shape decides
   * the clue mix, which is how Dan puzzles ended up 3x heavier on `between`
   * than any real one. See `orderPool`.
   */
  mix: ClueMix;
  /**
   * Board size, defaulting to the archive's 4x5. The mix is always measured on
   * the archive's own 4x5 boards; its profession shapes are refitted to whatever
   * board is asked for here — see `professionShapesFor`.
   */
  width?: number;
  height?: number;
  /** Which generated sibling this is; stamped on the puzzle. Defaults to `dan`. */
  variant?: Variant;
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

export interface Cast {
  names: string[];
  genders: ('male' | 'female')[];
  professions: string[];
  faces: string[];
}

/**
 * Every archived puzzle names its cast in alphabetical reading order, with a
 * distinct initial on each of the twenty cards. That is a playability
 * constraint, not decoration: clues name people ("#NAME:10 has only one
 * criminal neighbor"), and the player has to find that person on the board.
 * Sorted, uniquely-lettered names turn that lookup into a glance at roughly
 * where the letter falls; an arbitrary order forces a scan of all twenty
 * cards for every name in every clue.
 *
 * So pick one name per initial from `NAMES` (which stocks two candidates for
 * most letters) rather than twenty names outright, then lay them out sorted.
 * Sorting by initial is enough to sort the names because the initials are
 * distinct.
 *
 * Professions come from a whole profession shape sampled out of the archive
 * (`ClueMix.professionShapes`): a list of group sizes summing to `size`, e.g.
 * [3,3,3,2,2,2,2,2,1]. This used to be five professions dealt round-robin,
 * which gave every Dan puzzle the same rigid five-groups-of-four cast — visible
 * at a glance, and a silent constraint on the clues, since a `#PROFS:` unit was
 * then always exactly four people. Real casts run 7 to 11 professions in groups
 * of mostly two and three.
 */
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Shrink one archive shape onto a smaller board, keeping its character.
 *
 * Cards come off the largest group each time, so the raggedness and the group
 * count survive: a shape that named nine professions still names about nine,
 * which is what makes a `#PROFS:` unit worth reading. Taking whole groups off
 * the end instead would leave a tidier, flatter cast than the archive has.
 */
function shrunkShape(base: readonly number[], size: number): number[] {
  const out = [...base].sort((a, b) => b - a);
  let total = sum(out);
  while (total > size) {
    if (out[0] === 1) out.pop();
    else out[0]--;
    total--;
    out.sort((a, b) => b - a);
  }
  return out;
}

/**
 * Grow one archive shape until it covers `size`, keeping its character.
 *
 * New groups are drawn from `pool` — every group size the archive has ever
 * used, with its multiplicity, so the draw is the archive's own distribution of
 * twos and threes rather than a tidy average. When the remainder is smaller than
 * the group drawn, or the cast has already run out of professions to name, the
 * remainder goes onto the smallest existing group instead: that is where an
 * extra card changes the shape least, and it keeps the largest group where the
 * archive left it.
 */
function grownShape(
  rng: () => number,
  base: readonly number[],
  size: number,
  pool: readonly number[],
  maxGroup: number,
): number[] {
  const out = [...base];
  let total = sum(out);
  while (total < size) {
    const draw = pool[randInt(rng, 0, pool.length - 1)];
    if (out.length < PROFESSIONS.length && draw <= size - total) {
      out.push(draw);
      total += draw;
      continue;
    }
    let at = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i] < maxGroup && (at === -1 || out[i] < out[at])) at = i;
    }
    if (at === -1) {
      if (out.length >= PROFESSIONS.length) {
        throw new GenerationError(
          `cannot cover ${size} cards with ${PROFESSIONS.length} groups of at most ${maxGroup}`,
        );
      }
      out.push(1);
      total++;
      continue;
    }
    out[at]++;
    total++;
  }
  return out.sort((a, b) => b - a);
}

/**
 * Profession shapes that cover a `size`-card board.
 *
 * The archive only ever measured 4x5 boards, so every shape it offers sums to
 * twenty. At that size this hands them straight back, and `castOf` deals a real
 * puzzle's real cast. At any other size there is nothing to hand back and
 * `castOf` would rather throw than deal a cast with holes in it, so the shapes
 * are refitted from the archive's rather than invented: one per archive shape,
 * each keeping its own group count and raggedness, so a 5x6 cast still runs the
 * seven to eleven professions in groups of mostly two and three that make a
 * `#PROFS:` clue worth reading.
 *
 * Deterministic, because it is a table derived from a corpus rather than part of
 * any one puzzle's draw — two calls with the same archive and size give the same
 * shapes, and `castOf` does the sampling.
 */
export function professionShapesFor(
  professionShapes: readonly number[][],
  size: number,
): number[][] {
  const fits = professionShapes.filter((s) => s.length <= PROFESSIONS.length && sum(s) === size);
  if (fits.length > 0) return fits.map((s) => [...s]);

  const usable = professionShapes.filter((s) => s.length > 0);
  if (usable.length === 0) return [];
  const pool = usable.flat();
  const maxGroup = Math.max(...pool);
  const rng = makeRng(size * 1009 + usable.length);
  return usable.map((s) =>
    sum(s) > size ? shrunkShape(s, size) : grownShape(rng, s, size, pool, maxGroup),
  );
}

export function castOf(
  rng: () => number,
  professionShapes: readonly number[][],
  size: number = DEFAULT_SIZE,
): Cast {
  const buckets = new Map<string, VocabPerson[]>();
  for (const person of NAMES) {
    const initial = person.name[0];
    const bucket = buckets.get(initial);
    if (bucket) bucket.push(person);
    else buckets.set(initial, [person]);
  }
  const letters = shuffled(rng, [...buckets.keys()]);
  for (const [letter, bucket] of buckets) buckets.set(letter, shuffled(rng, bucket));

  // Round-robin over the letters, so the distinct-initial rule holds for as long
  // as the alphabet can hold it and degrades one letter at a time after that. A
  // 4x5 board never leaves the first pass; a 5x6 one wants thirty cards from
  // twenty-six letters, and takes its four extras from whichever letters the
  // shuffle put first.
  const people: VocabPerson[] = [];
  for (let round = 0; people.length < size; round++) {
    const available = letters.filter((l) => (buckets.get(l) as VocabPerson[]).length > round);
    if (available.length === 0) {
      throw new GenerationError(`only ${NAMES.length} names in the vocabulary for ${size} cards`);
    }
    for (const letter of available) {
      if (people.length >= size) break;
      people.push((buckets.get(letter) as VocabPerson[])[round]);
    }
  }
  // Sorting by initial is no longer enough once a letter carries two names, so
  // sort the names themselves; the cast is still in alphabetical reading order.
  people.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // A usable shape has to cover every card and name no more professions than the
  // vocabulary stocks. Both hold for the real archive on a 4x5 board — its
  // shapes all sum to twenty and its widest cast needs exactly as many
  // professions as we have — so say so plainly rather than dealing a cast with
  // holes in it when the shapes and the board disagree. For a board the archive
  // has no shape for, `professionShapesFor` builds some first.
  const fits = professionShapes.filter(
    (s) => s.length <= PROFESSIONS.length && sum(s) === size,
  );
  if (fits.length === 0) {
    throw new GenerationError(
      `no archived profession shape covers ${size} cards with ${PROFESSIONS.length} professions`,
    );
  }
  const shape = fits[randInt(rng, 0, fits.length - 1)];
  const chosen = shuffled(rng, PROFESSIONS).slice(0, shape.length);
  const slots: string[] = [];
  shape.forEach((size, i) => {
    for (let j = 0; j < size; j++) slots.push(chosen[i].key);
  });
  const professions = shuffled(rng, slots);
  return {
    names: people.map((p) => p.name),
    genders: people.map((p) => p.gender),
    professions,
    faces: professions.map((key, i) => faceOf(key, people[i].gender)),
  };
}

/**
 * How many times a chain will reach for the same predicate before it starts
 * preferring anything else. A soft cap: it ranks candidates, it does not
 * exclude them, so a step with nothing else that works still gets its clue.
 *
 * Two is the archive's own mode: of the 54 real puzzles, 22 lean hardest on a
 * predicate exactly twice, 16 three times, and the tail runs out at 7. Pool
 * weighting alone got Dan puzzles to 8.4 distinct
 * predicates against the archive's 9.4, because a weight is a property of the
 * whole pool and nothing kept one chain from taking the same shape of clue over
 * and over once it happened to be working.
 */
const REPEAT_CAP = 2;

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
  const size = shape.grid.size;
  const board = makeBoard(shape.grid, shape.professions, truth);
  const clues: Clues = Array.from({ length: size }, () => null);
  const flippedAt: number[][] = Array.from({ length: size }, () => []);
  let flipped = [...initialReveals].sort((a, b) => a - b);
  let cursor = 0;
  let abstractChosen = 0;
  let totalChosen = 0;
  const predUsed = new Map<string, number>();

  while (flipped.length < size) {
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

      // Rank a candidate on the two soft preferences, worth 2 and 1 so that the
      // abstraction bias — which decides how the puzzle plays — outranks the
      // repeat cap, which only decides how it reads. Both are preferences, not
      // filters: a candidate is only ever accepted after passing the same
      // forcedGiven/maxReveals check as before, and if nothing better turns up
      // within the trial budget a rank-0 candidate is still taken.
      const rankOf = (hint: Hint) =>
        (ABSTRACT_PREDICATES.has(hint.pred) === preferAbstract ? 2 : 0) +
        ((predUsed.get(hint.pred) ?? 0) < REPEAT_CAP ? 1 : 0);

      let tried = 0;
      let best: { hint: Hint; reveals: number[]; rank: number } | null = null;

      while (tried < trialsPerStep && cursor < pool.length && best?.rank !== 3) {
        const hint = pool[cursor++];
        tried++;
        const rank = rankOf(hint);
        // A candidate that cannot outrank what is already in hand cannot change
        // the outcome, so skip the expensive forcedGiven/reveal check for it.
        // Purely a cost optimization — rank is decided by the hint alone.
        if (best && rank <= best.rank) continue;
        if (namedCards(board, hint).has(host)) continue;
        clues[host] = hint;
        const forced = forcedGiven(shape, clues, truth, flipped);
        const reveals: number[] = [];
        for (let i = 0; i < size; i++) {
          if (!flipped.includes(i) && forced[i] !== null) reveals.push(i);
        }
        clues[host] = null;
        if (reveals.length === 0 || reveals.length > maxReveals) continue;

        best = { hint, reveals, rank };
      }

      const chosen = best;
      if (!chosen) continue;

      clues[host] = chosen.hint;
      for (const i of chosen.reveals) flippedAt[i] = [...flipped];
      flipped = [...flipped, ...chosen.reveals].sort((a, b) => a - b);
      totalChosen++;
      predUsed.set(chosen.hint.pred, (predUsed.get(chosen.hint.pred) ?? 0) + 1);
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
  const grid = makeGrid(input.width ?? DEFAULT_WIDTH, input.height ?? DEFAULT_HEIGHT);
  // The mix and the bands are both measured on the archive's 4x5 board whatever
  // board we are filling, so refit them once, up front, rather than asking
  // every caller to. Both are the identity at 4x5.
  const shapes = professionShapesFor(input.mix.professionShapes, grid.size);
  const band = bandsFor({ b: input.band }, grid.size).b;
  const failures: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = makeRng(input.seed + attempt * 7919);
    const cast = castOf(rng, shapes, grid.size);
    const shape: Shape = { grid, professions: cast.professions };

    const criminals = randInt(rng, band.criminals.min, band.criminals.max);
    const criminalSet = new Set(pickCriminals(rng, grid, criminals));
    const truth = Array.from({ length: grid.size }, (_, i) => criminalSet.has(i));

    const board = makeBoard(grid, cast.professions, truth);
    const pool = orderPool(rng, board, candidateHints(board), input.mix);
    const initialReveals = [randInt(rng, 0, grid.size - 1)];

    const maxReveals = Math.max(2, Math.ceil(band.meanRevealsPerStep.max));
    const targetAbstractShare =
      (band.abstractShare.min + band.abstractShare.max) / 2;
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
      width: grid.width,
      height: grid.height,
      initialReveals,
      source: 'generated',
      variant: input.variant ?? 'dan',
      people,
      // `chain` proves the puzzle solvable; it does not describe how to hint it.
      // See `hintSteps`.
      hints: hintSteps(shape, built.clues, truth, paths),
    };

    validatePuzzle(puzzle);

    if (!input.labelOf && !gatesPass(band, metrics)) {
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
