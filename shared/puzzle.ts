export interface Person {
  name: string;
  profession: string;
  gender: string;
  criminal: boolean;
  clue: string | null;
  origHint: string | null;
  paths: number[][] | null;
  /** Emoji from the source bundle's face map; absent in older puzzle files. */
  face?: string | null;
}

/** One precomputed deduction step: with `flipped` on the table, the clues on
 * `clues` cards suffice to deduce the `reveals` cards. */
export interface HintStep {
  flipped: number[];
  clues: number[];
  reveals: number[];
}

/**
 * The puzzles this repo generates, as opposed to the ones it scrapes. A real
 * puzzle carries no `variant` at all; each key here is one generated sibling.
 *
 * `suffix` is what goes between the date and `.json` in the filename, and by
 * extension what the site puts in a URL — so it is always `-${variant}`, and
 * one variant's suffix must never be a prefix of another's. `label` is how the
 * variant names itself on screen.
 */
export const VARIANTS = {
  /**
   * The only generated sibling. Its board is set by the day of the week rather
   * than inherited from the real puzzle — see `WEEKDAY_BOARDS` in
   * `scripts/generate.mts` — so a Dan puzzle grows from 3x4 on Monday to 6x6
   * on Sunday.
   */
  dan: { suffix: '-dan', label: 'Dan' },
} as const;

export type Variant = keyof typeof VARIANTS;

/**
 * Puzzles addressed by a name instead of by a date.
 *
 * Everything else here belongs to a day and is listed in the archive. A one-off
 * belongs to no day, and gets no listing: `regenerateManifest` only picks up
 * date-shaped filenames, so `10x10.json` never reaches the manifest, the
 * archive cannot show it, and nothing on the site links to it. Knowing the slug
 * is the only way in. The scraper and the corpus are date-anchored in the same
 * way, so a one-off never becomes a source of anything either.
 *
 * `audit-dan` is the exception, and deliberately: it re-derives a puzzle from
 * the file rather than from the date, so there is nothing about a one-off it
 * cannot check. It reads the entry here for the claims a filename would
 * otherwise make — which variant, which board, which date.
 *
 * The board, the date the file carries, and the difficulty generation aimed at
 * live here rather than only inside the file, because `scripts/one-off.mts`
 * builds the file from them. Without that a one-off would be the one artifact
 * in the repo that nothing could reproduce.
 */
export const ONE_OFFS = {
  /**
   * A hundred cards: five times the source site's board and nearly three times
   * the largest day of our own week. Built once, by hand, because nothing that
   * runs on a schedule could — an 8x8 is 89 seconds and this took 457, well past
   * the daily workflow's timeout.
   *
   * The date is the day it was made. It means nothing here, but the format
   * demands one, and a made-up date that looked significant would be worse than
   * one that is merely true.
   */
  '10x10': {
    width: 10,
    height: 10,
    date: '2026-09-02',
    aimedAt: 'Medium',
    variant: 'dan',
  },
} as const;

export type OneOffSlug = keyof typeof ONE_OFFS;

/**
 * What a puzzle advertises about itself in a list or a header.
 *
 * A real puzzle is always the source site's 4x5, so its size says nothing and
 * its difficulty label — which the source assigned and which our bands are
 * calibrated against — says everything. A Dan puzzle is the other way round:
 * the label is our own classifier's opinion of a puzzle nobody else has
 * played, while the board changes with the day of the week and is the thing a
 * player actually wants to know before starting.
 */
export function puzzleBillingOf(p: {
  /** Absent on a `Puzzle`'s real puzzles, the literal `'real'` on a manifest entry. */
  variant?: 'real' | Variant;
  difficulty: string;
  width: number;
  height: number;
}): string {
  const generated = p.variant !== undefined && p.variant !== 'real';
  return generated ? `${p.width}x${p.height}` : p.difficulty;
}

const VARIANT_NAMES = Object.keys(VARIANTS) as Variant[];

export interface Puzzle {
  formatVersion: 1;
  id: string;
  date: string;
  title: string;
  difficulty: string;
  width: number;
  height: number;
  initialReveals: number[];
  source: string;
  people: Person[];
  /** Absent in older puzzle files and when the source puzzle has no hints. */
  hints?: HintStep[];
  /** Absent on scraped puzzles; one of `VARIANTS` on generated ones. */
  variant?: Variant;
}

export class PuzzleValidationError extends Error {}

function fail(msg: string): never {
  throw new PuzzleValidationError(msg);
}

export function validatePuzzle(data: unknown): Puzzle {
  if (typeof data !== 'object' || data === null) fail('puzzle is not an object');
  const p = data as Record<string, unknown>;
  if (p.formatVersion !== 1) fail(`unsupported formatVersion: ${String(p.formatVersion)}`);
  if (typeof p.id !== 'string' || !/^[0-9a-f]{12}$/.test(p.id)) fail('id must be 12 lowercase hex chars');
  if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) fail('date must be YYYY-MM-DD');
  if (typeof p.title !== 'string') fail('title must be a string');
  if (typeof p.difficulty !== 'string') fail('difficulty must be a string');
  if (typeof p.source !== 'string') fail('source must be a string');
  if (p.variant !== undefined && !VARIANT_NAMES.includes(p.variant as Variant)) {
    fail(`variant must be absent or one of ${VARIANT_NAMES.join(', ')}`);
  }
  if (!Number.isInteger(p.width) || (p.width as number) < 1) fail('width must be a positive integer');
  if (!Number.isInteger(p.height) || (p.height as number) < 1) fail('height must be a positive integer');
  const count = (p.width as number) * (p.height as number);
  if (!Array.isArray(p.people)) fail('people must be an array');
  if (p.people.length !== count) fail(`people length ${p.people.length} != width*height ${count}`);
  const inRange = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < count;
  if (!Array.isArray(p.initialReveals) || !p.initialReveals.every(inRange)) {
    fail('initialReveals must be an array of in-range card indices');
  }
  if (p.hints !== undefined) {
    const indexArrayOk = (v: unknown) => Array.isArray(v) && v.every(inRange);
    const ok =
      Array.isArray(p.hints) &&
      p.hints.every(
        (raw) =>
          typeof raw === 'object' &&
          raw !== null &&
          indexArrayOk((raw as Record<string, unknown>).flipped) &&
          indexArrayOk((raw as Record<string, unknown>).clues) &&
          indexArrayOk((raw as Record<string, unknown>).reveals),
      );
    if (!ok) fail('hints must be absent or an array of {flipped, clues, reveals} in-range index arrays');
  }
  p.people.forEach((raw, i) => {
    const where = `people[${i}]`;
    if (typeof raw !== 'object' || raw === null) fail(`${where} is not an object`);
    const q = raw as Record<string, unknown>;
    if (typeof q.name !== 'string' || q.name === '') fail(`${where}.name must be a non-empty string`);
    if (typeof q.profession !== 'string' || q.profession === '') fail(`${where}.profession must be a non-empty string`);
    if (typeof q.gender !== 'string') fail(`${where}.gender must be a string`);
    if (typeof q.criminal !== 'boolean') fail(`${where}.criminal must be a boolean`);
    if (q.clue !== null && typeof q.clue !== 'string') fail(`${where}.clue must be a string or null`);
    if (q.origHint !== null && typeof q.origHint !== 'string') fail(`${where}.origHint must be a string or null`);
    if (q.face !== undefined && q.face !== null && typeof q.face !== 'string') {
      fail(`${where}.face must be a string, null, or absent`);
    }
    if (q.paths !== null) {
      const ok =
        Array.isArray(q.paths) &&
        q.paths.every((path) => Array.isArray(path) && path.every(inRange));
      if (!ok) fail(`${where}.paths must be null or an array of arrays of in-range indices`);
    }
  });
  return data as Puzzle;
}
