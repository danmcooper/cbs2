import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
});
