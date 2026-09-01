import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadArchive } from '../shared/solver/corpus.ts';
import { buildBands, measure } from '../shared/solver/difficulty.ts';
import type { Shape } from '../shared/solver/enumerate.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { type Clues, minimalPaths, parseClues } from '../shared/solver/solve.ts';

// `meanPathSize` cannot be compared between the archive and a freshly
// generated puzzle unless both sides are measured the same way. A scraped
// puzzle's stored `paths` field is the source site's own accumulated reveal
// prefix (never minimised) — in puzzles/2026-08-29.json, card 0 stores
// [11,9,13,19,8,12,14,1,15,7] and card 2 stores that same list plus 0, a
// strictly nested, non-minimal superset. `generatePuzzle` instead stores
// `minimalPaths(...)`, a genuinely minimal sufficient subset. So for
// calibration, each archived card's stored path is re-run through
// `minimalPaths`, seeded from that same stored path, before `measure` sees
// it — putting both sides of the comparison through the same minimiser.
// This makes `npm run calibrate` slow (a full pass over all 54 archived
// puzzles takes roughly 35 minutes) because `minimalPaths` is nontrivial
// per card and this now runs it ~1080 times; that cost is acceptable for a
// script that is run rarely and not on any hot path.
function minimisedPathsFor(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  storedPaths: (number[][] | null)[],
): (number[][] | null)[] {
  return storedPaths.map((paths, i) => {
    if (paths === null || paths.length === 0) return paths;
    return minimalPaths(shape, clues, truth, i, paths[0]);
  });
}

const archive = loadArchive();
const samples: { label: string; metrics: ReturnType<typeof measure> }[] = [];

for (const { file, puzzle } of archive) {
  const shape = { grid: makeGrid(puzzle.width, puzzle.height), professions: puzzle.people.map((p) => p.profession) };
  const clues = parseClues(puzzle.people.map((p) => p.origHint));
  const truth = puzzle.people.map((p) => p.criminal);
  const paths = minimisedPathsFor(
    shape,
    clues,
    truth,
    puzzle.people.map((p) => p.paths),
  );
  const metrics = measure({
    shape,
    clues,
    truth,
    initialReveals: puzzle.initialReveals,
    paths,
  });
  console.log(
    `${file} ${puzzle.difficulty}: chain=${metrics.chainLength} ` +
      `reveals/step=${metrics.meanRevealsPerStep.toFixed(2)} path=${metrics.meanPathSize.toFixed(2)}`,
  );
  samples.push({ label: puzzle.difficulty, metrics });
}

// A label with fewer than 3 archived puzzles gets no band at all. Dates carrying
// that label are reported as failures by scripts/generate.mts rather than being
// generated against a band invented from one or two samples.
const counts = new Map<string, number>();
for (const s of samples) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
const usable = samples.filter((s) => (counts.get(s.label) as number) >= 3);
for (const [label, n] of counts) {
  if (n < 3) console.warn(`skipping ${label}: only ${n} sample(s)`);
}

const bands = buildBands(usable);
const out = path.join(process.cwd(), 'config', 'difficulty.json');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(bands, null, 2) + '\n');
console.log(`wrote ${out} for ${Object.keys(bands).length} labels`);
