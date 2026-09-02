import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VARIANTS, type Variant } from '../shared/puzzle.ts';
import { validatePuzzle } from '../shared/puzzle.ts';

export interface ManifestEntry {
  date: string;
  /** Filename without `.json` — how the site addresses this puzzle. */
  slug: string;
  variant: 'real' | Variant;
  id: string;
  difficulty: string;
  title: string;
  /**
   * The board, so the archive can show a generated puzzle's size without
   * fetching the puzzle itself. A real puzzle is always the source site's 4x5
   * and says nothing by saying so; a Dan puzzle's size is the day's headline.
   */
  width: number;
  height: number;
}

// Longest suffix first, so `-dan-long` is tried before `-dan` and a file cannot
// be read as the wrong variant just because one suffix extends another.
const SUFFIXES = (Object.entries(VARIANTS) as [Variant, { suffix: string }][]).sort(
  (a, b) => b[1].suffix.length - a[1].suffix.length,
);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The variant a filename claims, or null if it is not a puzzle file at all. */
function variantOf(file: string): 'real' | Variant | null {
  if (!file.endsWith('.json')) return null;
  const stem = file.slice(0, -'.json'.length);
  for (const [variant, spec] of SUFFIXES) {
    if (stem.endsWith(spec.suffix)) {
      return DATE.test(stem.slice(0, -spec.suffix.length)) ? variant : null;
    }
  }
  return DATE.test(stem) ? 'real' : null;
}

export async function regenerateManifest(puzzlesDir: string): Promise<ManifestEntry[]> {
  const files = (await readdir(puzzlesDir)).filter((f) => variantOf(f) !== null).sort();
  const entries: ManifestEntry[] = [];
  for (const file of files) {
    const variant = variantOf(file) as 'real' | Variant;
    let puzzle;
    try {
      puzzle = validatePuzzle(JSON.parse(await readFile(path.join(puzzlesDir, file), 'utf8')));
    } catch (e) {
      throw new Error(`${file}: ${String(e)}`);
    }
    if ((puzzle.variant ?? 'real') !== variant) {
      throw new Error(
        `${file}: filename and puzzle variant disagree — ` +
          `filename says ${variant}, puzzle says ${puzzle.variant ?? 'real'}`,
      );
    }
    entries.push({
      date: puzzle.date,
      slug: file.slice(0, -'.json'.length),
      variant,
      id: puzzle.id,
      difficulty: puzzle.difficulty,
      title: puzzle.title,
      width: puzzle.width,
      height: puzzle.height,
    });
  }
  // Newest first; within a date, the real puzzle first and the generated ones
  // after it — a variant's slug is its date plus a suffix, so sorting the slug
  // puts the bare date ahead of all of them.
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  await writeFile(path.join(puzzlesDir, 'index.json'), JSON.stringify(entries, null, 2) + '\n');
  return entries;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  regenerateManifest(path.join(process.cwd(), 'puzzles')).then(
    (entries) => console.log(`index.json: ${entries.length} puzzles`),
    (e) => {
      console.error(String(e));
      process.exit(1);
    },
  );
}
