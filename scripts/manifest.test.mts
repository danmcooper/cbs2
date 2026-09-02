import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VARIANTS } from '../shared/puzzle.ts';
import { regenerateManifest } from './manifest.mts';

function puzzle(date: string, id: string) {
  const person = {
    name: 'banda', profession: 'coder', gender: 'male',
    criminal: false, clue: null, origHint: null, paths: [],
  };
  return {
    formatVersion: 1, id, date, title: `Title ${date}`, difficulty: 'Easy',
    width: 1, height: 2, initialReveals: [], source: 'cluesbysam.com',
    people: [person, person],
  };
}

describe('regenerateManifest', () => {
  it('writes index.json sorted by date descending, ignoring non-puzzle files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cbs-manifest-'));
    await writeFile(path.join(dir, '2026-07-01.json'), JSON.stringify(puzzle('2026-07-01', 'aaaaaaaaaaaa')));
    await writeFile(path.join(dir, '2026-07-03.json'), JSON.stringify(puzzle('2026-07-03', 'bbbbbbbbbbbb')));
    await writeFile(
      path.join(dir, '2026-07-03-dan.json'),
      JSON.stringify({ ...puzzle('2026-07-03', 'cccccccccccc'), variant: 'dan' }),
    );
    await writeFile(path.join(dir, 'index.json'), '[]');
    await writeFile(path.join(dir, 'notes.txt'), 'ignore me');

    const entries = await regenerateManifest(dir);

    expect(entries.map((e) => e.slug)).toEqual(['2026-07-03', '2026-07-03-dan', '2026-07-01']);
    expect(entries[0]).toEqual({
      date: '2026-07-03', slug: '2026-07-03', variant: 'real',
      id: 'bbbbbbbbbbbb', difficulty: 'Easy', title: 'Title 2026-07-03',
      width: 1, height: 2,
    });
    expect(entries[1].variant).toBe('dan');
    const onDisk = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
    expect(onDisk).toEqual(entries);
  });

  it('fails loudly on an invalid puzzle file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cbs-manifest-'));
    await writeFile(path.join(dir, '2026-07-01.json'), '{"formatVersion":1}');
    await expect(regenerateManifest(dir)).rejects.toThrow(/2026-07-01\.json/);
  });

  it('rejects a -dan file whose puzzle is not marked as a Dan variant', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cbs-manifest-'));
    await writeFile(path.join(dir, '2026-07-01-dan.json'), JSON.stringify(puzzle('2026-07-01', 'aaaaaaaaaaaa')));
    await expect(regenerateManifest(dir)).rejects.toThrow(/variant/);
  });

  it('gives each generated variant its own entry, real first within a date', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cbs-manifest-'));
    await writeFile(path.join(dir, '2026-07-03.json'), JSON.stringify(puzzle('2026-07-03', 'aaaaaaaaaaaa')));
    for (const [variant, spec] of Object.entries(VARIANTS)) {
      await writeFile(
        path.join(dir, `2026-07-03${spec.suffix}.json`),
        JSON.stringify({ ...puzzle('2026-07-03', 'bbbbbbbbbbbb'), variant }),
      );
    }

    const entries = await regenerateManifest(dir);

    expect(entries.map((e) => e.variant)).toEqual(['real', ...Object.keys(VARIANTS)]);
    expect(entries.map((e) => e.slug)).toEqual([
      '2026-07-03',
      ...Object.values(VARIANTS).map((s) => `2026-07-03${s.suffix}`),
    ]);
  });

  it('refuses a file whose name and contents disagree about the variant', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cbs-manifest-'));
    // The site addresses a puzzle by its filename and reads its variant out of
    // the file, so the two disagreeing means one of them lies to a player.
    await writeFile(
      path.join(dir, '2026-07-01-dan.json'),
      JSON.stringify(puzzle('2026-07-01', 'aaaaaaaaaaaa')),
    );
    await expect(regenerateManifest(dir)).rejects.toThrow(/variant/);
  });

  // `variantOf` matches suffixes with `endsWith`, so what stops it from reading
  // any old filename as a variant is the date check on what remains. (Its other
  // guard, trying the longest suffix first, is dormant while `dan` is the only
  // variant: it matters again the moment one suffix extends another, the way
  // `-dan-long` once extended `-dan`.)
  it('ignores a file ending in a variant suffix that is not dated', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cbs-manifest-'));
    await writeFile(
      path.join(dir, 'draft-dan.json'),
      JSON.stringify({ ...puzzle('2026-07-01', 'aaaaaaaaaaaa'), variant: 'dan' }),
    );
    await writeFile(
      path.join(dir, '2026-07-01.json'),
      JSON.stringify(puzzle('2026-07-01', 'bbbbbbbbbbbb')),
    );

    const entries = await regenerateManifest(dir);

    expect(entries.map((e) => e.slug)).toEqual(['2026-07-01']);
  });
});
