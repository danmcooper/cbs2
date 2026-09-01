import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePuzzle } from '../shared/puzzle.ts';

export interface ManifestEntry {
  date: string;
  /** Filename without `.json` — how the site addresses this puzzle. */
  slug: string;
  variant: 'real' | 'dan';
  id: string;
  difficulty: string;
  title: string;
}

const PUZZLE_FILE = /^(\d{4}-\d{2}-\d{2})(-dan)?\.json$/;

export async function regenerateManifest(puzzlesDir: string): Promise<ManifestEntry[]> {
  const files = (await readdir(puzzlesDir)).filter((f) => PUZZLE_FILE.test(f)).sort();
  const entries: ManifestEntry[] = [];
  for (const file of files) {
    const variant = PUZZLE_FILE.exec(file)![2] ? 'dan' : 'real';
    let puzzle;
    try {
      puzzle = validatePuzzle(JSON.parse(await readFile(path.join(puzzlesDir, file), 'utf8')));
    } catch (e) {
      throw new Error(`${file}: ${String(e)}`);
    }
    if ((puzzle.variant === 'dan') !== (variant === 'dan')) {
      throw new Error(`${file}: filename and puzzle variant disagree`);
    }
    entries.push({
      date: puzzle.date,
      slug: file.slice(0, -'.json'.length),
      variant,
      id: puzzle.id,
      difficulty: puzzle.difficulty,
      title: puzzle.title,
    });
  }
  // Newest first; within a date, the real puzzle before the Dan one.
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
