import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ONE_OFFS, type OneOffSlug } from '../shared/puzzle.ts';
import { bandsFor, classify, loadBands } from '../shared/solver/difficulty.ts';
import { archiveClueMix } from '../shared/solver/corpus.ts';
import { generatePuzzle } from '../shared/solver/generate.ts';
import { seedForDate, unionCriminals } from './generate.mts';

export interface OneOffRunOptions {
  puzzlesDir?: string;
  bandsPath?: string;
}

/**
 * Builds one of the named puzzles in `ONE_OFFS` and writes it as `<slug>.json`.
 *
 * Separate from `runGenerate` rather than another `VariantSpec`, because every
 * assumption that script makes is about dates: it walks the real puzzles to find
 * what to build, takes each one's difficulty as the aim, and names its output
 * after the date and the variant. A one-off has no real puzzle behind it and no
 * date that means anything, so it would have had to opt out of all of that.
 *
 * Deterministic in the same way everything else here is — the seed is the slug,
 * so this rebuilds the same puzzle every time and the committed file is a thing
 * that can be checked rather than a thing that must be trusted. The slug and not
 * the date, so two one-offs made on the same day are different puzzles.
 *
 * Does not touch the manifest. `regenerateManifest` would skip the file anyway,
 * which is exactly the property that keeps a one-off out of the archive.
 */
export async function buildOneOff(slug: OneOffSlug, opts: OneOffRunOptions = {}) {
  const spec = ONE_OFFS[slug];
  const puzzlesDir = opts.puzzlesDir ?? path.join(process.cwd(), 'puzzles');
  const bandsPath = opts.bandsPath ?? path.join(process.cwd(), 'config', 'difficulty.json');
  const bands = loadBands(JSON.parse(await readFile(bandsPath, 'utf8')));
  const band = bands[spec.aimedAt];
  if (!band) throw new Error(`no calibrated band for ${spec.aimedAt}`);

  const size = spec.width * spec.height;
  const { puzzle } = generatePuzzle({
    date: spec.date,
    difficulty: spec.aimedAt,
    band: { ...band, criminals: unionCriminals(bands) },
    seed: seedForDate(slug),
    mix: archiveClueMix(puzzlesDir),
    width: spec.width,
    height: spec.height,
    // A one-off is an existing variant built off the schedule, not a third kind
    // of thing. Being a Dan puzzle is what makes it bill itself by its board
    // rather than by a difficulty label our own classifier invented — and on a
    // board this far from the calibrated twenty cards, the board is the only
    // honest headline anyway. The catalogue says which variant, so `audit-dan`
    // has something to check the file's own claim against.
    variant: spec.variant,
    labelOf: (metrics) => classify(bandsFor(bands, size), metrics),
  });
  await writeFile(
    path.join(puzzlesDir, `${slug}.json`),
    JSON.stringify(puzzle, null, 2) + '\n',
  );
  return puzzle;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const slugs = Object.keys(ONE_OFFS) as OneOffSlug[];
  const asked = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const unknown = asked.filter((a) => !slugs.includes(a as OneOffSlug));
  if (unknown.length) {
    console.error(`unrecognised one-off ${unknown[0]} — expected one of ${slugs.join(', ')}`);
    process.exit(2);
  }
  const wanted = asked.length ? (asked as OneOffSlug[]) : slugs;
  (async () => {
    for (const slug of wanted) {
      const startedAt = Date.now();
      const puzzle = await buildOneOff(slug);
      const clued = puzzle.people.filter((p) => p.origHint).length;
      console.log(
        `generated ${slug}.json  ${puzzle.width}x${puzzle.height}  ${puzzle.difficulty}  ` +
          `${clued}/${puzzle.people.length} clue cards  ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      );
    }
  })().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
