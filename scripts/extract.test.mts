import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePageUrl, runExtract } from './extract.mts';

const html = readFileSync(new URL('./lib/fixtures/page.html', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('./lib/fixtures/bundle-index-abc123.js', import.meta.url), 'utf8');

function fakeFetch(routes: Record<string, string>): typeof fetch {
  return (async (url: unknown) => {
    const body = routes[String(url)];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

const routes = {
  'https://cluesbysam.com/': html,
  'https://cluesbysam.com/assets/index-abc123.js': bundle,
};

async function tmpPuzzles() {
  return mkdtemp(path.join(tmpdir(), 'cbs-extract-'));
}

describe('resolvePageUrl', () => {
  it('maps inputs to page URLs', () => {
    expect(resolvePageUrl(undefined)).toBe('https://cluesbysam.com/');
    expect(resolvePageUrl('a6f09e2713b2')).toBe('https://cluesbysam.com/s/play?puzzleId=a6f09e2713b2');
    expect(resolvePageUrl('https://cluesbysam.com/s/play?puzzleId=x')).toBe('https://cluesbysam.com/s/play?puzzleId=x');
    expect(() => resolvePageUrl('garbage')).toThrow(/\[page-fetch\]/);
  });
});

describe('runExtract', () => {
  it('writes the puzzle file and regenerates the manifest', async () => {
    const dir = await tmpPuzzles();
    const result = await runExtract(undefined, { fetchImpl: fakeFetch(routes), puzzlesDir: dir });
    expect(result.status).toBe('written');
    const puzzle = JSON.parse(await readFile(path.join(dir, '2026-07-07.json'), 'utf8'));
    expect(puzzle.id).toBe('a6f09e2713b2');
    expect(puzzle.people).toHaveLength(4);
    const manifest = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
    expect(manifest).toEqual([
      {
        date: '2026-07-07', slug: '2026-07-07', variant: 'real',
        id: 'a6f09e2713b2', difficulty: 'Easy', title: 'A tiny test mystery',
        width: 2, height: 2,
      },
    ]);
  });

  it('is idempotent: same puzzle id → already-have, no rewrite', async () => {
    const dir = await tmpPuzzles();
    await runExtract(undefined, { fetchImpl: fakeFetch(routes), puzzlesDir: dir });
    const result = await runExtract(undefined, { fetchImpl: fakeFetch(routes), puzzlesDir: dir });
    expect(result.status).toBe('already-have');
  });

  it('hard-fails when the existing file has a different puzzle id', async () => {
    const dir = await tmpPuzzles();
    await runExtract(undefined, { fetchImpl: fakeFetch(routes), puzzlesDir: dir });
    const file = path.join(dir, '2026-07-07.json');
    const existing = JSON.parse(await readFile(file, 'utf8'));
    existing.id = 'ffffffffffff';
    await writeFile(file, JSON.stringify(existing));
    await expect(
      runExtract(undefined, { fetchImpl: fakeFetch(routes), puzzlesDir: dir }),
    ).rejects.toThrow(/\[conflict\]/);
  });

  it('applies a validated dateOverride', async () => {
    const dir = await tmpPuzzles();
    const result = await runExtract(undefined, {
      fetchImpl: fakeFetch(routes), puzzlesDir: dir, dateOverride: '2025-01-15',
    });
    expect(result.file.endsWith('2025-01-15.json')).toBe(true);
    await expect(
      runExtract(undefined, { fetchImpl: fakeFetch(routes), puzzlesDir: dir, dateOverride: 'soon' }),
    ).rejects.toThrow(/dateOverride/);
  });

  it('imports an archive page: levelData config, hints, and faces from the main bundle', async () => {
    const archiveHtml = readFileSync(new URL('./lib/fixtures/archive-page.html', import.meta.url), 'utf8');
    const dir = await tmpPuzzles();
    // fakeFetch responses carry no res.url, so relative resolution falls back
    // to the request URL (the real site 301s to .../s/play/?puzzleId=...).
    const result = await runExtract('b7f09e2713c3', {
      fetchImpl: fakeFetch({
        'https://cluesbysam.com/s/play?puzzleId=b7f09e2713c3': archiveHtml,
        'https://cluesbysam.com/s/assets/main-abc123.js': bundle,
      }),
      puzzlesDir: dir,
    });
    expect(result.status).toBe('written');
    const puzzle = JSON.parse(await readFile(path.join(dir, '2026-07-06.json'), 'utf8'));
    expect(puzzle.id).toBe('b7f09e2713c3');
    expect(puzzle.title).toBe('A tiny archive mystery');
    expect(puzzle.hints).toHaveLength(3);
    expect(puzzle.people[0].face).toBe('👨‍💻'); // faces still come from the bundle
  });

  it('reports fetch failures with their stage', async () => {
    const dir = await tmpPuzzles();
    await expect(
      runExtract(undefined, { fetchImpl: fakeFetch({}), puzzlesDir: dir }),
    ).rejects.toThrow(/\[page-fetch\].*404/);
    await expect(
      runExtract(undefined, {
        fetchImpl: fakeFetch({ 'https://cluesbysam.com/': html }), puzzlesDir: dir,
      }),
    ).rejects.toThrow(/\[bundle-fetch\]/);
  });
});
