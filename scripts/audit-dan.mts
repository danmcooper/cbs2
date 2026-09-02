/**
 * Independent audit of every generated Dan puzzle in `puzzles/`.
 *
 * Deliberately re-derives everything from the puzzle file alone rather than
 * trusting anything the generator recorded: it re-parses the `origHint`
 * strings, re-solves from scratch, and re-measures difficulty. A puzzle that
 * passes here is playable and fair no matter what the generator believed.
 *
 * Run: npx tsx scripts/audit-dan.mts [puzzlesDir]
 * Exits non-zero if any check fails on any file.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OneOffSlug, Puzzle, Variant } from '../shared/puzzle.ts';
import { ONE_OFFS, VARIANTS, validatePuzzle } from '../shared/puzzle.ts';
import { namedCards } from '../shared/solver/candidates.ts';
import { archiveClueMix } from '../shared/solver/corpus.ts';
import { professionShapesFor } from '../shared/solver/generate.ts';
import { parseHint } from '../shared/solver/hint.ts';
import type { Bands } from '../shared/solver/difficulty.ts';
import { bandsFor, classify, loadBands, measure } from '../shared/solver/difficulty.ts';
import type { Shape } from '../shared/solver/enumerate.ts';
import { makeGrid, neighbors } from '../shared/solver/grid.ts';
import { hintFeatures, makeBoard, unitMembers } from '../shared/solver/predicates.ts';
import {
  type Clues,
  forcedGiven,
  isUniquelySolvable,
  parseClues,
  solveChain,
} from '../shared/solver/solve.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A directory argument lets this be pointed at a scratch copy — which is how it
// gets mutation-tested, without writing anything into the real archive.
const PUZZLES = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'puzzles');
// Anchored and built from the variant table, so adding a variant brings it into
// the audit rather than quietly leaving it unaudited. The alternation is safe
// against one suffix extending another because the pattern is anchored at both
// ends: `-dan` could not match a `-dan-long.json` and still reach `\.json$`.
const SUFFIXES = Object.values(VARIANTS).map((v) => v.suffix);
const DAN_FILE = new RegExp(`^\\d{4}-\\d{2}-\\d{2}(${SUFFIXES.join('|')})\\.json$`);
const REAL_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;
// One-offs are named rather than dated, so nothing about the filename says they
// are generated puzzles — the catalogue does. Auditing them is not optional
// generosity: this is the only check a one-off gets, since it is absent from the
// manifest, absent from the corpus, and not rebuilt by the daily workflow.
const ONE_OFF_FILE = new RegExp(
  `^(${Object.keys(ONE_OFFS)
    .map((slug) => slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\.json$`,
);

/**
 * How hard one predicate may be leaned on, measured over the archive: the worst
 * real puzzle spends 7 of its 14 clue cards on `unit_shares_n_out_of_n_traits`.
 * Both readings of that are kept, because on an archive-sized board they agree
 * and on a large one only the share means anything — see where they are used.
 */
const ABSOLUTE_PRED_CAP = 7;
const WORST_PRED_SHARE = 0.5;

/** The letters a cast can draw a distinct initial from. Above this, the board
 * has more cards than the alphabet has letters and repeats are forced. */
const ALPHABET = 26;

interface Loaded {
  file: string;
  variant: Variant;
  /** The catalogue entry, when the file is a one-off rather than a dated puzzle. */
  oneOff?: (typeof ONE_OFFS)[OneOffSlug];
  puzzle: Puzzle;
  shape: Shape;
  clues: Clues;
  truth: boolean[];
}

/**
 * The source site's *authored* prose: puzzle titles, and the chatter on cards
 * that carry no logical clue. These are its creative, commercial content and
 * nothing we ship may reproduce them.
 *
 * Deliberately excludes rendered clue sentences, even though they are also
 * strings the site wrote. A clue is the mechanical rendering of a predicate —
 * "Exactly 2 criminals in row 1 have a criminal directly below them" is
 * `n_t_in_unit_have_trait_in_dir(unit(row,1),criminal,criminal,0,1,2)` and
 * nothing else — and `shared/solver/render.ts` is *required* to reproduce the
 * site's templates verbatim, which is exactly what the renderer-fidelity
 * corpus test enforces against all 54 archived puzzles. A finite template set
 * over a finite parameter space collides by arithmetic, not by copying: four
 * of the first 54 generated puzzles produced a clue string that also occurs
 * somewhere in the archive, each time for a different logical reason on a
 * different board. Banning those would mean either shipping clues that render
 * wrongly or refusing valid puzzles for a coincidence, so the ban covers
 * authored prose only.
 */
async function archiveProse(files: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const file of files) {
    const p = validatePuzzle(JSON.parse(await readFile(path.join(PUZZLES, file), 'utf8')));
    seen.add(p.title.trim());
    // A card with no `origHint` carries flavour text rather than a clue.
    for (const person of p.people) {
      if (person.origHint === null && person.clue) seen.add(person.clue.trim());
    }
  }
  return seen;
}

function load(file: string, puzzle: Puzzle): Loaded {
  const grid = makeGrid(puzzle.width, puzzle.height);
  const professions = puzzle.people.map((p) => p.profession);
  // The filename is the claim under audit — the puzzle's own `variant` field is
  // then checked against it rather than trusted. A one-off's filename claims
  // nothing, so its catalogue entry stands in as the claim instead.
  const slug = file.slice(0, -'.json'.length);
  const oneOff = Object.hasOwn(ONE_OFFS, slug) ? ONE_OFFS[slug as OneOffSlug] : undefined;
  const suffix = DAN_FILE.exec(file)?.[1];
  const variant =
    oneOff?.variant ??
    (Object.keys(VARIANTS) as Variant[]).find((v) => VARIANTS[v].suffix === suffix);
  if (!variant) throw new Error(`${file}: not a generated puzzle filename`);
  return {
    file,
    variant,
    oneOff,
    puzzle,
    shape: { grid, professions },
    clues: parseClues(puzzle.people.map((p) => p.origHint)),
    truth: puzzle.people.map((p) => p.criminal),
  };
}

/** Returns one message per failed check; empty means the puzzle is sound. */
function audit(
  l: Loaded,
  banned: Set<string>,
  bands: Bands,
  shapesFor: (size: number) => Set<string>,
): string[] {
  const bad: string[] = [];
  const { puzzle, shape, clues, truth } = l;
  const size = shape.grid.size;
  const shapes = shapesFor(size);

  if (puzzle.variant !== l.variant) {
    bad.push(`variant is ${String(puzzle.variant)}, expected '${l.variant}'`);
  }
  if (puzzle.source !== 'generated') bad.push(`source is ${puzzle.source}, expected 'generated'`);
  if (l.oneOff) {
    // A dated puzzle's filename is checkable on its own: it must be the date the
    // file carries plus the variant's suffix. A one-off's name says none of
    // that, so what it is held to instead is the catalogue entry it was built
    // from — the board and the date `scripts/one-off.mts` was told to use.
    const { width, height, date } = l.oneOff;
    if (puzzle.width !== width || puzzle.height !== height) {
      bad.push(`board is ${puzzle.width}x${puzzle.height}, catalogue says ${width}x${height}`);
    }
    if (puzzle.date !== date) {
      bad.push(`date ${puzzle.date} does not match the catalogue's ${date}`);
    }
  } else if (`${puzzle.date}${VARIANTS[l.variant].suffix}.json` !== l.file) {
    bad.push(`date ${puzzle.date} does not match filename`);
  }

  // Fairness. The strict form: every card recoverable from clue text alone,
  // with nothing handed to the player up front.
  if (!isUniquelySolvable(shape, clues, truth)) {
    bad.push('not uniquely solvable from zero reveals');
  }
  const chain = solveChain(shape, clues, truth, puzzle.initialReveals);
  if (!chain.solvedAll) bad.push('deduction chain stalls before every card is revealed');

  // No guessing: each non-initial card must carry at least one stored path,
  // and every stored path must actually suffice to deduce that card.
  const initial = new Set(puzzle.initialReveals);
  for (let i = 0; i < size; i++) {
    const paths = puzzle.people[i].paths;
    if (initial.has(i)) continue;
    if (paths === null || paths.length === 0) {
      bad.push(`card ${i} has no path — the player would have to guess it`);
      continue;
    }
    for (const flipped of paths) {
      if (forcedGiven(shape, clues, truth, flipped)[i] !== truth[i]) {
        bad.push(`card ${i}: stored path [${flipped.join(',')}] does not deduce it`);
      }
    }
  }

  // A hint has to be a deduction the player can act on. The archive's are
  // atomic — 58% cite one clue, and 87% turn over one card, though one sentence
  // legitimately cracks open several at once. What must hold is that the
  // sentences a step outlines deduce exactly the cards it names: a card it
  // forces but leaves unnamed hides a deduction the player has already earned,
  // and one it names but does not force offers a reveal the board will not
  // support. Steps built from `solveChain`'s rounds fail all of this: they cite
  // every visible clue, flip a whole wave, and demand the entire cumulative
  // solve state as their prerequisite.
  const hintable = new Set<number>();
  for (const step of puzzle.hints ?? []) {
    const where = `hint for card ${step.reveals.join(',')}`;
    if (step.reveals.length === 0) bad.push(`${where}: names no card at all`);
    for (const target of step.reveals) {
      hintable.add(target);
      if (step.flipped.includes(target)) bad.push(`${where}: needs its own answer flipped first`);
    }
    for (const i of step.clues) {
      if (!step.flipped.includes(i)) bad.push(`${where}: outlines clue ${i}, not a prerequisite`);
      if (clues[i] === null) bad.push(`${where}: outlines card ${i}, which carries no clue`);
    }
    const outlined = clues.map((h, j) => (step.clues.includes(j) ? h : null));
    const forced = forcedGiven(shape, outlined, truth, step.flipped);
    const actually = forced.flatMap((v, i) => (v !== null && !step.flipped.includes(i) ? [i] : []));
    if (`${actually}` !== `${[...step.reveals].sort((a, b) => a - b)}`) {
      bad.push(`${where}: its outlined clues deduce ${actually.join(',') || 'nothing'} instead`);
    }
  }
  for (let i = 0; i < size; i++) {
    if (!initial.has(i) && !hintable.has(i)) bad.push(`card ${i} has no hint step`);
  }
  if (!(puzzle.hints ?? []).some((s) => s.flipped.every((i) => initial.has(i)))) {
    bad.push('no hint is available from the opening position');
  }

  // Clues name people, so the player has to map a name back to a card. Every
  // archived puzzle makes that a glance rather than a scan by naming its cast
  // in alphabetical reading order with a distinct initial per card. A board
  // with more cards than the alphabet has letters cannot manage the second
  // half, so it is required to spend every letter before it repeats one.
  const names = puzzle.people.map((p) => p.name);
  if (names.join(',') !== [...names].sort().join(',')) {
    bad.push('names are not in alphabetical reading order');
  }
  if (new Set(names).size !== names.length) {
    bad.push(`${names.length - new Set(names).size} card(s) repeat a name`);
  }
  const initials = new Set(names.map((n) => n[0]));
  const wanted = Math.min(names.length, ALPHABET);
  if (initials.size !== wanted) {
    bad.push(`cast uses ${initials.size} initials for ${names.length} cards, expected ${wanted}`);
  }

  // "Only 1 of the 1 criminals ... is ..." reads as a slip and duplicates
  // both_traits_in_unit_are_in_unit; all 78 archive instances have shared < total.
  for (let i = 0; i < size; i++) {
    const hint = clues[i];
    if (hint?.pred !== 'unit_shares_n_out_of_n_traits_with_unit') continue;
    const [shared, total] = hint.args.slice(3);
    if (shared.t === 'num' && total.t === 'num' && shared.n >= total.n) {
      bad.push(`card ${i}: clue shares all ${total.n} of the unit's traits`);
    }
  }

  // Counts the archive never words that way: "0 persons in a corner have an
  // innocent directly above them" (the three directional families all floor at
  // 1 across their 41 real instances) and "#NAME:1 is one of 1 criminals
  // between #0 and #3" (63 real instances, all 2 or more).
  const DIR_FAMILIES = new Set([
    'n_in_unit_have_trait_in_dir',
    'n_t_in_unit_have_trait_in_dir',
    'n_professions_have_trait_in_dir',
  ]);
  for (let i = 0; i < size; i++) {
    const hint = clues[i];
    if (!hint) continue;
    if (DIR_FAMILIES.has(hint.pred)) {
      const count = hint.args[hint.args.length - 1];
      if (count.t === 'num' && count.n === 0) bad.push(`card ${i}: directional clue counts zero`);
    }
    if (hint.pred === 'is_one_of_n_traits_in_unit') {
      const count = hint.args[3];
      if (count.t === 'num' && count.n < 2) bad.push(`card ${i}: clue says "one of 1"`);
    }
  }

  // Real casts run 7 to 11 professions in ragged groups of mostly two and
  // three; generation used to deal a rigid five groups of four. Requiring an
  // exact archived shape is stricter than it has to be, but generation samples
  // one wholesale, so anything else means the sampler broke. Every archived
  // shape covers twenty cards, so on any other board the shapes to match are
  // what `professionShapesFor` refits from them.
  const groups = new Map<string, number>();
  for (const p of puzzle.people) groups.set(p.profession, (groups.get(p.profession) ?? 0) + 1);
  const castShape = [...groups.values()].sort((a, b) => b - a).join(',');
  if (!shapes.has(castShape)) {
    bad.push(`profession shape [${castShape}] is not one refitted from a real puzzle`);
  }

  // No puzzle should lean on one predicate harder than any real one does.
  // Generation soft-caps at 2; this is the backstop.
  //
  // "Harder" has to be a share, not a count. The archive's worst is 7 of the
  // same — but that is 7 of 14 clue cards, and every real puzzle carries between
  // 7 and 16. On a board with 62 of them a flat 7 is a far stricter test than
  // any real puzzle ever sat, and it fails a puzzle drawing on 25 distinct
  // predicates for concentrating a seventh of its clues where the archive's own
  // worst concentrates half. Same problem, and same fix, as the difficulty bands
  // and the profession shapes: a threshold counted in cards has to be refitted
  // before it means anything on another board.
  //
  // Floored at the old absolute 7, so the two readings agree at 14 clue cards
  // and the floor is what applies below that — which is what applied before.
  // Only a board with 16 or more clue cards is allowed anything the flat cap
  // would have refused, and the roomiest board in the archive spends 4 of its
  // 15 on one predicate, three clear of the cap either way.
  const clued = clues.filter((h) => h !== null).length;
  const cap = Math.max(ABSOLUTE_PRED_CAP, Math.floor(WORST_PRED_SHARE * clued));
  const perPred = new Map<string, number>();
  for (const hint of clues) {
    if (hint) perPred.set(hint.pred, (perPred.get(hint.pred) ?? 0) + 1);
  }
  for (const [pred, n] of perPred) {
    if (n > cap) {
      bad.push(`uses ${pred} ${n} of ${clued} clues — no real puzzle leans past ${cap} here`);
    }
  }

  // A clue may not name the card it sits on.
  const board = makeBoard(shape.grid, shape.professions, truth);
  for (let i = 0; i < size; i++) {
    const hint = clues[i];
    if (hint && namedCards(board, hint).has(i)) {
      bad.push(`card ${i}: its own clue refers to it`);
    }
  }

  // Naming one member of a unit whose members all share the trait tells the
  // player nothing either: unit membership is visible, so "Cleo is one of
  // Desmond's 3 innocent neighbors" only says Desmond's neighbors are innocent,
  // with Cleo dressed up as a distinction she does not have.
  for (let i = 0; i < size; i++) {
    const hint = clues[i];
    if (hint?.pred !== 'is_one_of_n_traits_in_unit') continue;
    const [unit, , , count] = hint.args;
    if (unit.t !== 'unit' || count.t !== 'num') continue;
    const members = unitMembers(board, unit.unit);
    if (count.n >= members.length) {
      bad.push(`card ${i}: names one of all ${members.length} of the unit`);
    }
  }

  // Asking whether traits are "connected" inside a unit whose cards are all mutually
  // adjacent tells the player nothing — every subset of such a unit is connected.
  for (let i = 0; i < size; i++) {
    const hint = clues[i];
    if (hint?.pred !== 'both_traits_are_neighbors_in_unit' &&
      hint?.pred !== 'all_traits_are_neighbors_in_unit') continue;
    const arg0 = hint.args[0];
    if (arg0.t !== 'unit') continue;
    const members = unitMembers(board, arg0.unit);
    if (members.every((x) => members.every((y) => x === y || neighbors(shape.grid, x).includes(y)))) {
      bad.push(`card ${i}: asks for connectedness among ${members.length} mutually adjacent cards`);
    }
  }

  // The stored difficulty must be the one the puzzle's own metrics earn.
  // Generation no longer rejects a puzzle for missing a band — it labels it
  // by what it measured — so the invariant worth checking is that the label
  // on disk is reproducible from the puzzle itself, not that it falls inside
  // some band it was never required to hit.
  if (!bands[puzzle.difficulty]) {
    bad.push(`difficulty ${puzzle.difficulty} has no calibrated band`);
  } else {
    const metrics = measure({
      shape,
      clues,
      truth,
      initialReveals: puzzle.initialReveals,
      paths: puzzle.people.map((p) => p.paths),
    });
    // Bands are calibrated on the archive's 4x5 board, so a puzzle on any other
    // board has to be classified against bands refitted to it.
    const earned = classify(bandsFor(bands, puzzle.width * puzzle.height), metrics);
    if (earned !== puzzle.difficulty) {
      bad.push(
        `labelled ${puzzle.difficulty} but its metrics classify as ${earned}: ` +
          `clueCards=${metrics.clueCards} chainLength=${metrics.chainLength} ` +
          `abstractShare=${metrics.abstractShare.toFixed(2)} ` +
          `meanPathSize=${metrics.meanPathSize.toFixed(2)}`,
      );
    }
  }

  // Nothing we ship may reproduce the source site's authored prose.
  if (banned.has(puzzle.title.trim())) bad.push(`title "${puzzle.title}" appears in the archive`);
  for (let i = 0; i < size; i++) {
    const person = puzzle.people[i];
    if (person.origHint !== null) continue;
    if (person.clue && banned.has(person.clue.trim())) {
      bad.push(`card ${i}: flavour text appears in the archive`);
    }
  }

  return bad;
}

async function main(): Promise<void> {
  const files = await readdir(PUZZLES);
  const dan = files.filter((f) => DAN_FILE.test(f) || ONE_OFF_FILE.test(f)).sort();
  const real = files.filter((f) => REAL_FILE.test(f)).sort();
  if (dan.length === 0) {
    console.error(`no generated puzzles to audit (${SUFFIXES.join(', ')})`);
    process.exit(1);
  }

  const banned = await archiveProse(real);
  const bands = loadBands(
    JSON.parse(await readFile(path.join(ROOT, 'config', 'difficulty.json'), 'utf8')),
  );
  const mix = archiveClueMix(PUZZLES);
  // Memoised per board size: refitting is deterministic but not free, and a
  // full archive asks for the same two or three sizes over and over.
  const shapeCache = new Map<number, Set<string>>();
  const shapesFor = (size: number) => {
    let set = shapeCache.get(size);
    if (!set) {
      set = new Set(professionShapesFor(mix.professionShapes, size).map((s) => s.join(',')));
      shapeCache.set(size, set);
    }
    return set;
  };
  console.log(`auditing ${dan.length} generated puzzles against ${real.length} real ones`);

  const byLabel = new Map<string, number>();
  // Clue mix is a property of the whole set, not of any one puzzle, so it is
  // reported rather than failed on. Generation draws from the archive's own
  // proportions; a wide gap here means that weighting has drifted.
  const usedPred = new Map<string, number>();
  const usedFeature = new Map<string, number>();
  const distinctPerPuzzle: number[] = [];
  let failed = 0;
  for (const file of dan) {
    let bad: string[];
    let label = '?';
    try {
      const puzzle = validatePuzzle(JSON.parse(await readFile(path.join(PUZZLES, file), 'utf8')));
      label = puzzle.difficulty;
      const loaded = load(file, puzzle);
      const board = makeBoard(loaded.shape.grid, loaded.shape.professions, loaded.truth);
      const here = new Set<string>();
      for (const person of puzzle.people) {
        if (!person.origHint) continue;
        const hint = parseHint(person.origHint);
        usedPred.set(hint.pred, (usedPred.get(hint.pred) ?? 0) + 1);
        here.add(hint.pred);
        for (const f of hintFeatures(board, hint)) {
          usedFeature.set(f, (usedFeature.get(f) ?? 0) + 1);
        }
      }
      distinctPerPuzzle.push(here.size);
      bad = audit(loaded, banned, bands, shapesFor);
    } catch (e) {
      bad = [`threw: ${String(e)}`];
    }
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
    if (bad.length > 0) {
      failed++;
      console.log(`FAIL ${file}`);
      for (const line of bad) console.log(`     ${line}`);
    }
  }

  console.log(`\n${dan.length - failed}/${dan.length} sound`);
  console.log(
    [...byLabel].sort().map(([k, v]) => `${k}=${v}`).join(' '),
  );

  const report = (title: string, used: Map<string, number>, want: Record<string, number>) => {
    const total = [...used.values()].reduce((a, b) => a + b, 0);
    const rows = [...new Set([...Object.keys(want), ...used.keys()])]
      .map((k) => ({ k, want: 100 * (want[k] ?? 0), got: (100 * (used.get(k) ?? 0)) / total }))
      .sort((a, b) => Math.abs(b.got - b.want) - Math.abs(a.got - a.want));
    const drift = rows.reduce((a, r) => a + Math.abs(r.got - r.want), 0) / 2;
    console.log(`\n${title} — ${drift.toFixed(1)}% of clues sit on the wrong kind`);
    for (const r of rows.slice(0, 6)) {
      console.log(`  ${r.k.padEnd(55)} archive ${r.want.toFixed(1).padStart(5)}%  dan ${r.got.toFixed(1).padStart(5)}%`);
    }
  };
  report('clue features (6 widest gaps)', usedFeature, mix.feature);
  report('predicates (6 widest gaps)', usedPred, mix.pred);
  const mean = distinctPerPuzzle.reduce((a, b) => a + b, 0) / distinctPerPuzzle.length;
  console.log(`\ndistinct predicates per puzzle — dan ${mean.toFixed(1)}, archive 9.4`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
