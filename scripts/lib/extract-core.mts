import vm from 'node:vm';
import { PuzzleValidationError, validatePuzzle, type HintStep, type Puzzle } from '../../shared/puzzle.ts';

export type ExtractStage =
  | 'page-fetch'
  | 'bundle-discovery'
  | 'bundle-fetch'
  | 'array-parse'
  | 'faces-parse'
  | 'hints-parse'
  | 'metadata-parse'
  | 'validation'
  | 'conflict';

export class ExtractError extends Error {
  constructor(
    public stage: ExtractStage,
    message: string,
  ) {
    super(`[${stage}] ${message}`);
    this.name = 'ExtractError';
  }
}

export function findBundleUrl(html: string, pageUrl: string): string {
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  for (const tag of tags) {
    if (!/type="module"/.test(tag)) continue;
    const src = tag.match(/src="([^"]+)"/);
    // The daily page ships index-*.js; archive play pages ship main-*.js.
    if (src && /assets\/(index|main)-[^"/]*\.js$/.test(src[1])) {
      return new URL(src[1], pageUrl).href;
    }
  }
  throw new ExtractError('bundle-discovery', 'no module script matching assets/(index|main)-*.js in page HTML');
}

/** Index of the bracket closing the `open` at `start`, skipping string contents. */
function matchBalanced(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === inString) inString = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inString = c;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** An array value in the bundle: a literal, or a `JSON.parse("…")` call. */
const ARRAY_VALUE = String.raw`\[|JSON\.parse\(`;

/**
 * Delimit the array-valued expression starting at `start` and evaluate it in a
 * sandbox. Bundlers emit large arrays as `JSON.parse("…")` (it parses faster
 * than a literal), so match parens for that form and brackets for a literal.
 */
function evalArrayAt(bundle: string, start: number, stage: ExtractStage): unknown[] {
  const json = bundle.startsWith('JSON.parse(', start);
  const end = json
    ? matchBalanced(bundle, start + 'JSON.parse'.length, '(', ')')
    : matchBalanced(bundle, start, '[', ']');
  if (end === -1) throw new ExtractError(stage, 'unbalanced brackets after array signature');
  const src = bundle.slice(start, end + 1);
  let value: unknown;
  try {
    value = vm.runInNewContext(`(${src})`, Object.create(null), { timeout: 1000 });
  } catch (e) {
    throw new ExtractError(stage, `sandbox evaluation of array slice failed: ${String(e)}`);
  }
  if (!Array.isArray(value)) throw new ExtractError(stage, 'evaluated slice is not an array');
  return value;
}

export function extractPeopleArray(bundle: string): unknown[] {
  const start = bundle.indexOf('[{criminal:');
  if (start === -1) throw new ExtractError('array-parse', 'signature "[{criminal:" not found in bundle');
  return evalArrayAt(bundle, start, 'array-parse');
}

const isIndexArray = (v: unknown) => Array.isArray(v) && v.every((n) => Number.isInteger(n));

/** The config's supportsHints flag: inline `!0`/`!1` or a minified boolean constant. */
function bundleSupportsHints(bundle: string): boolean {
  const m = bundle.match(/supportsHints:(!0|!1|[\w$]+)/);
  if (!m) return false;
  if (m[1] === '!0') return true;
  if (m[1] === '!1') return false;
  const ident = m[1].replace(/\$/g, '\\$');
  const def = bundle.match(new RegExp(`[,;=\\s({]${ident}=(!0|!1)`));
  return def?.[1] === '!0';
}

/**
 * The bundle's level config carries a precomputed `hints:[{flipped,clues,reveals},…]`
 * ladder (inline or via a minified identifier, as a literal or a JSON.parse
 * call). Older/hint-less puzzles omit it;
 * `hints:` keys elsewhere (e.g. the preferences object) don't resolve to that
 * shape and are skipped. Returns null when the puzzle has no usable hints.
 */
export function extractHints(bundle: string): HintStep[] | null {
  let resolved = false;
  for (const m of bundle.matchAll(new RegExp(`[,{]hints:(${ARRAY_VALUE}|[\\w$]+)`, 'g'))) {
    let start: number;
    if (m[1] === '[' || m[1].startsWith('JSON.parse')) {
      start = m.index + m[0].length - m[1].length;
    } else {
      const ident = m[1].replace(/\$/g, '\\$');
      const def = bundle.match(new RegExp(`[,;=\\s({]${ident}=(${ARRAY_VALUE})`));
      if (!def || def.index === undefined) continue;
      start = def.index + def[0].length - def[1].length;
    }
    const value = evalArrayAt(bundle, start, 'hints-parse');
    const steps = value.filter((raw): raw is HintStep => {
      const r = raw as Record<string, unknown>;
      return isIndexArray(r?.flipped) && isIndexArray(r?.clues) && isIndexArray(r?.reveals);
    });
    if (steps.length !== value.length) continue; // some other hints-named value
    resolved = true; // the hints key itself, even if the site left it empty
    if (steps.length > 0) return steps.map(({ flipped, clues, reveals }) => ({ flipped, clues, reveals }));
  }
  // Silent nulls would let the daily scrape commit hint-less puzzles after a
  // bundle-shape change; if the config says hints exist, refuse to guess.
  if (!resolved && bundleSupportsHints(bundle)) {
    throw new ExtractError('hints-parse', 'bundle has supportsHints=true but no hints array was found');
  }
  return null;
}

/**
 * The bundle assigns the profession -> [male, female] emoji map one entry at a
 * time (`q={};q.police=[…];q.cop=[…];…`). Anchor on the police entry to learn
 * the minified variable name, then collect every two-string array assigned to
 * it. New professions on the source site flow through without code changes.
 */
export function extractFaces(bundle: string): Record<string, [string, string]> {
  const anchor = bundle.match(/([\w$]+)\.police=\[/);
  if (!anchor) throw new ExtractError('faces-parse', 'face map (VAR.police=[…]) not found in bundle');
  const ident = anchor[1].replace(/\$/g, '\\$');
  const entry = new RegExp(`(?:^|[;,{}])${ident}\\.([\\w$]+)=\\[("[^"]*"),("[^"]*")\\]`, 'g');
  const faces: Record<string, [string, string]> = {};
  for (const m of bundle.matchAll(entry)) {
    try {
      faces[m[1]] = [JSON.parse(m[2]) as string, JSON.parse(m[3]) as string];
    } catch {
      throw new ExtractError('faces-parse', `unparseable face entry for "${m[1]}"`);
    }
  }
  return faces;
}

export interface BundleMetadata {
  width: number;
  height: number;
  difficulty: string;
  title: string;
  date: string;
  id: string;
  initialReveals: number[];
}

export interface ArchiveLevelData {
  meta: BundleMetadata;
  cards: unknown[];
  hints: HintStep[] | null;
}

/**
 * Archive play pages don't inline the puzzle in the JS bundle; they embed it
 * as JSON in `window.levelData`, with the id in `window.puzzleLogId` and the
 * date leading `window.puzzleSaveId` ("YYYY-MM-DD-archive"). Returns null on
 * pages without levelData (the daily page, which uses the bundle path).
 */
export function extractLevelData(html: string): ArchiveLevelData | null {
  const at = html.indexOf('window.levelData');
  if (at === -1) return null;
  const open = html.indexOf('{', at);
  const close = open === -1 ? -1 : matchBalanced(html, open, '{', '}');
  if (close === -1) throw new ExtractError('metadata-parse', 'window.levelData object is unbalanced');
  let level: Record<string, unknown>;
  try {
    level = JSON.parse(html.slice(open, close + 1)) as Record<string, unknown>;
  } catch (e) {
    throw new ExtractError('metadata-parse', `window.levelData is not valid JSON: ${String(e)}`);
  }

  const id = html.match(/window\.puzzleLogId\s*=\s*"([0-9a-f]{12})"/);
  if (!id) throw new ExtractError('metadata-parse', 'window.puzzleLogId (12-hex) not found on archive page');
  const date = html.match(/window\.puzzleSaveId\s*=\s*"(\d{4}-\d{2}-\d{2})/);
  if (!date) {
    throw new ExtractError('metadata-parse', 'window.puzzleSaveId has no YYYY-MM-DD prefix (pass DATE_OVERRIDE?)');
  }

  const rawHints = Array.isArray(level.hints)
    ? level.hints.filter((raw): raw is HintStep => {
        const r = raw as Record<string, unknown>;
        return isIndexArray(r?.flipped) && isIndexArray(r?.clues) && isIndexArray(r?.reveals);
      })
    : null;
  const hints =
    rawHints && rawHints.length > 0
      ? rawHints.map(({ flipped, clues, reveals }) => ({ flipped, clues, reveals }))
      : null;
  if (!hints && !Array.isArray(level.hints) && level.supportsHints === true) {
    throw new ExtractError('hints-parse', 'levelData has supportsHints=true but no hints array');
  }

  return {
    meta: {
      width: Number(level.width),
      height: Number(level.height),
      difficulty: String(level.difficulty ?? ''),
      title: String(level.identityClue ?? ''),
      date: date[1],
      id: id[1],
      initialReveals: isIndexArray(level.initial_reveals) ? (level.initial_reveals as number[]) : [],
    },
    cards: Array.isArray(level.cards) ? level.cards : [],
    hints,
  };
}

function parseIntList(csv: string): number[] {
  return csv === '' ? [] : csv.split(',').map(Number);
}

export function extractMetadata(bundle: string): BundleMetadata {
  // e.g. nv=4,av=5,uv="Medium",iv="…title…",cv=[{criminal:
  const head = bundle.match(/[\w$]+=(\d+),[\w$]+=(\d+),[\w$]+="([^"]*)",[\w$]+="([^"]*)",[\w$]+=\[\{criminal:/);
  if (!head) {
    throw new ExtractError('metadata-parse', 'width/height/difficulty/title constants not found before people array');
  }
  const date = bundle.match(/"(\d{4}-\d{2}-\d{2})"/);
  if (!date) throw new ExtractError('metadata-parse', 'date constant "YYYY-MM-DD" not found');
  const id =
    bundle.match(/"([0-9a-f]{12})"[\s\S]{0,300}?"https:\/\/cluesbysam\.com\/log"/) ??
    bundle.match(/"https:\/\/cluesbysam\.com\/log"[\s\S]{0,300}?"([0-9a-f]{12})"/);
  if (!id) throw new ExtractError('metadata-parse', 'puzzleId (12-hex constant near /log URL) not found');

  let initialReveals: number[];
  const inline = bundle.match(/initial_reveals:\[([\d,]*)\]/);
  if (inline) {
    initialReveals = parseIntList(inline[1]);
  } else {
    const indirect = bundle.match(/initial_reveals:([\w$]+)/);
    if (!indirect) throw new ExtractError('metadata-parse', 'initial_reveals not found');
    const ident = indirect[1].replace(/\$/g, '\\$');
    const def = bundle.match(new RegExp(`[,;=\\s({]${ident}=\\[([\\d,]*)\\]`));
    if (!def) {
      throw new ExtractError('metadata-parse', `initial_reveals identifier ${indirect[1]} has no array definition`);
    }
    initialReveals = parseIntList(def[1]);
  }

  return {
    width: Number(head[1]),
    height: Number(head[2]),
    difficulty: head[3],
    title: head[4],
    date: date[1],
    id: id[1],
    initialReveals,
  };
}

export function normalizePuzzle(
  meta: BundleMetadata,
  rawPeople: unknown[],
  faces: Record<string, [string, string]> = {},
  hints: HintStep[] | null = null,
): Puzzle {
  const people = rawPeople.map((raw) => {
    const r = raw as Record<string, unknown>;
    const pair = faces[r.profession as string];
    return {
      name: r.name,
      profession: r.profession,
      gender: r.gender,
      criminal: r.criminal === true,
      clue: typeof r.hint === 'string' && r.hint !== '' ? r.hint : null,
      origHint: typeof r.orig_hint === 'string' && r.orig_hint !== '' ? r.orig_hint : null,
      paths: Array.isArray(r.paths) ? r.paths : null,
      face: pair ? pair[r.gender === 'female' ? 1 : 0] : null,
    };
  });
  const candidate = {
    formatVersion: 1,
    id: meta.id,
    date: meta.date,
    title: meta.title,
    difficulty: meta.difficulty,
    width: meta.width,
    height: meta.height,
    initialReveals: meta.initialReveals,
    source: 'cluesbysam.com',
    people,
    ...(hints ? { hints } : {}),
  };
  try {
    return validatePuzzle(candidate);
  } catch (e) {
    if (e instanceof PuzzleValidationError) throw new ExtractError('validation', e.message);
    throw e;
  }
}
