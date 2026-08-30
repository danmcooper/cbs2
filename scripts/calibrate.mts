import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadArchive } from '../shared/solver/corpus.ts';
import { buildBands, measure } from '../shared/solver/difficulty.ts';
import { makeGrid } from '../shared/solver/grid.ts';
import { parseClues } from '../shared/solver/solve.ts';

const archive = loadArchive();
const samples: { label: string; metrics: ReturnType<typeof measure> }[] = [];

for (const { file, puzzle } of archive) {
  const metrics = measure({
    shape: { grid: makeGrid(puzzle.width, puzzle.height), professions: puzzle.people.map((p) => p.profession) },
    clues: parseClues(puzzle.people.map((p) => p.origHint)),
    truth: puzzle.people.map((p) => p.criminal),
    initialReveals: puzzle.initialReveals,
    paths: puzzle.people.map((p) => p.paths),
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
