import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ExtractError,
  extractFaces,
  extractHints,
  extractLevelData,
  extractMetadata,
  extractPeopleArray,
  findBundleUrl,
  normalizePuzzle,
} from './extract-core.mts';

const html = readFileSync(new URL('./fixtures/page.html', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('./fixtures/bundle-index-abc123.js', import.meta.url), 'utf8');
const archiveHtml = readFileSync(new URL('./fixtures/archive-page.html', import.meta.url), 'utf8');

describe('findBundleUrl', () => {
  it('resolves the module script relative to the page URL', () => {
    expect(findBundleUrl(html, 'https://cluesbysam.com/')).toBe(
      'https://cluesbysam.com/assets/index-abc123.js',
    );
  });

  it('resolves relative to archive-page URLs too', () => {
    expect(findBundleUrl(html, 'https://cluesbysam.com/s/play?puzzleId=a6f09e2713b2')).toBe(
      'https://cluesbysam.com/s/assets/index-abc123.js',
    );
  });

  it('accepts archive pages: main-*.js resolved against the redirected play URL', () => {
    expect(findBundleUrl(archiveHtml, 'https://cluesbysam.com/s/play/?puzzleId=b7f09e2713c3')).toBe(
      'https://cluesbysam.com/s/play/assets/main-abc123.js',
    );
  });

  it('throws a bundle-discovery ExtractError when no matching script exists', () => {
    expect(() => findBundleUrl('<html></html>', 'https://x.test/')).toThrowError(ExtractError);
    expect(() => findBundleUrl('<html></html>', 'https://x.test/')).toThrow(/\[bundle-discovery\]/);
  });
});

describe('extractPeopleArray', () => {
  it('extracts and evaluates the people array', () => {
    const people = extractPeopleArray(bundle) as Record<string, unknown>[];
    expect(people).toHaveLength(4);
    expect(people[0]).toMatchObject({ criminal: false, name: 'banda', profession: 'coder' });
    expect(people[1]).toMatchObject({ criminal: true, name: 'mira' });
    expect(people[2].paths).toEqual([[0, 1], [3]]);
  });

  it('bracket-matches through strings containing brackets', () => {
    const tricky = 'x=[{criminal:!1,profession:"a",name:"n",gender:"m",hint:"weird ] [ text",paths:[]}];';
    const people = extractPeopleArray(tricky) as Record<string, unknown>[];
    expect(people).toHaveLength(1);
    expect(people[0].hint).toBe('weird ] [ text');
  });

  it('throws array-parse when the signature is missing', () => {
    expect(() => extractPeopleArray('var x=1;')).toThrow(/\[array-parse\]/);
  });

  it('throws array-parse on unbalanced brackets', () => {
    expect(() => extractPeopleArray('x=[{criminal:!1,')).toThrow(/\[array-parse\]/);
  });
});

describe('extractMetadata', () => {
  it('extracts width/height/difficulty/title from constants before the array', () => {
    const meta = extractMetadata(bundle);
    expect(meta).toMatchObject({
      width: 2,
      height: 2,
      difficulty: 'Easy',
      title: 'A tiny test mystery',
    });
  });

  it('extracts date, puzzleId (adjacent to /log constant), and initial reveals', () => {
    const meta = extractMetadata(bundle);
    expect(meta.date).toBe('2026-07-07');
    expect(meta.id).toBe('a6f09e2713b2');
    expect(meta.initialReveals).toEqual([0]);
  });

  it('supports inline initial_reveals arrays', () => {
    const inline = bundle.replace('initial_reveals:fv', 'initial_reveals:[1,2]');
    expect(extractMetadata(inline).initialReveals).toEqual([1, 2]);
  });

  it('throws metadata-parse naming the missing piece', () => {
    expect(() => extractMetadata('var x=[{criminal:!1}];')).toThrow(/\[metadata-parse\]/);
    expect(() => extractMetadata(bundle.replace('"2026-07-07"', '"nope"'))).toThrow(/date/);
    expect(() => extractMetadata(bundle.replace('a6f09e2713b2', 'ZZZ'))).toThrow(/puzzleId/);
  });
});

describe('extractFaces', () => {
  it('collects every profession -> emoji pair assigned to the map variable', () => {
    const faces = extractFaces(bundle);
    expect(faces.police).toEqual(['👮‍♂️', '👮‍♀️']);
    expect(faces.coder).toEqual(['👨‍💻', '👩‍💻']);
    expect(faces.chef).toEqual(['👨‍🍳', '👩‍🍳']);
    expect(faces.nurse).toBeUndefined();
  });

  it('throws faces-parse when the police anchor is missing', () => {
    expect(() => extractFaces('var x=1;')).toThrow(/\[faces-parse\]/);
  });
});

describe('extractHints', () => {
  it('extracts the hint steps referenced by the config hints key', () => {
    expect(extractHints(bundle)).toEqual([
      { flipped: [0], clues: [0], reveals: [1] },
      { flipped: [0, 1], clues: [1], reveals: [2] },
      { flipped: [0, 1, 2], clues: [2], reveals: [3] },
    ]);
  });

  it('supports inline hints arrays', () => {
    const inline = bundle.replace('hints:dv', 'hints:[{flipped:[0],clues:[0],reveals:[1]}]');
    expect(extractHints(inline)).toEqual([{ flipped: [0], clues: [0], reveals: [1] }]);
  });

  it('supports hints arrays the bundler emitted as JSON.parse strings', () => {
    const steps = '[{"flipped":[0],"clues":[0],"reveals":[1]}]';
    const viaIdent = bundle.replace(/dv=\[.*?\],hv=/, `dv=JSON.parse('${steps}'),hv=`);
    expect(extractHints(viaIdent)).toEqual([{ flipped: [0], clues: [0], reveals: [1] }]);
    const inline = bundle.replace('hints:dv', `hints:JSON.parse('${steps}')`);
    expect(extractHints(inline)).toEqual([{ flipped: [0], clues: [0], reveals: [1] }]);
  });

  it('returns null when the bundle has no hints (or an empty list)', () => {
    expect(extractHints(bundle.replace('hints:dv,supportsHints:hv,', ''))).toBeNull();
    expect(extractHints(bundle.replace('hints:dv', 'hints:[]'))).toBeNull();
  });

  it('fails loudly when the bundle claims supportsHints but no hints parse', () => {
    // Drop only the hints key; supportsHints:hv (hv=!0) stays behind.
    const broken = bundle.replace('hints:dv,', '');
    expect(() => extractHints(broken)).toThrow(/\[hints-parse\]/);
  });

  it('is not fooled by hint/orig_hint keys on cards', () => {
    const noHints = bundle.replace('hints:dv,supportsHints:hv,', '');
    expect(noHints).toContain('hint:'); // cards still carry clue text
    expect(extractHints(noHints)).toBeNull();
  });
});

describe('extractLevelData', () => {
  it('parses the archive page config: metadata, cards, and hints', () => {
    const level = extractLevelData(archiveHtml);
    expect(level).not.toBeNull();
    expect(level?.meta).toEqual({
      width: 2,
      height: 2,
      difficulty: 'Easy',
      title: 'A tiny archive mystery',
      date: '2026-07-06',
      id: 'b7f09e2713c3',
      initialReveals: [0],
    });
    expect(level?.cards).toHaveLength(4);
    expect(level?.hints).toEqual([
      { flipped: [0], clues: [0], reveals: [1] },
      { flipped: [0, 1], clues: [1], reveals: [2] },
      { flipped: [0, 1, 2], clues: [2], reveals: [3] },
    ]);
  });

  it('returns null on pages without embedded levelData (the daily page)', () => {
    expect(extractLevelData(html)).toBeNull();
  });

  it('normalizes into a valid puzzle with hints', () => {
    const level = extractLevelData(archiveHtml)!;
    const puzzle = normalizePuzzle(level.meta, level.cards, {}, level.hints);
    expect(puzzle.id).toBe('b7f09e2713c3');
    expect(puzzle.date).toBe('2026-07-06');
    expect(puzzle.hints).toHaveLength(3);
    expect(puzzle.people[1].clue).toBe('The #PROF:chef sits beside #NAME:0');
  });

  it('throws metadata-parse when the id or dated save key is missing', () => {
    expect(() => extractLevelData(archiveHtml.replace('window.puzzleLogId = "b7f09e2713c3";', ''))).toThrow(
      /\[metadata-parse\]/,
    );
    expect(() =>
      extractLevelData(archiveHtml.replace('"2026-07-06-archive"', '"weekly-special"')),
    ).toThrow(/\[metadata-parse\]/);
  });

  it('throws hints-parse when supportsHints is set but the hints are missing', () => {
    const noHints = archiveHtml.replace(/"hints": \[[\s\S]*?\],\s*(?="supportsHints")/, '');
    expect(() => extractLevelData(noHints)).toThrow(/\[hints-parse\]/);
  });
});

describe('normalizePuzzle', () => {
  it('produces a valid Puzzle from the fixture bundle', () => {
    const puzzle = normalizePuzzle(extractMetadata(bundle), extractPeopleArray(bundle));
    expect(puzzle.formatVersion).toBe(1);
    expect(puzzle.id).toBe('a6f09e2713b2');
    expect(puzzle.source).toBe('cluesbysam.com');
    expect(puzzle.people).toHaveLength(4);
    // hint:"" and orig_hint map to clue/origHint with empty→null
    expect(puzzle.people[0].clue).toBeNull();
    expect(puzzle.people[0].origHint).toBe('number_of_traits_in_unit(unit(row,0),criminal,1)');
    expect(puzzle.people[1].clue).toBe('The #PROF:chef sits beside #NAME:0');
    expect(puzzle.people[2].paths).toEqual([[0, 1], [3]]);
  });

  it('includes hints when provided, omits the key when null', () => {
    const meta = extractMetadata(bundle);
    const people = extractPeopleArray(bundle);
    const withHints = normalizePuzzle(meta, people, {}, extractHints(bundle));
    expect(withHints.hints).toHaveLength(3);
    expect(withHints.hints?.[0]).toEqual({ flipped: [0], clues: [0], reveals: [1] });
    const without = normalizePuzzle(meta, people, {}, null);
    expect('hints' in without).toBe(false);
  });

  it('fills each person face from the map by gender, null when unmapped', () => {
    const puzzle = normalizePuzzle(extractMetadata(bundle), extractPeopleArray(bundle), extractFaces(bundle));
    expect(puzzle.people[0].face).toBe('👨‍💻'); // banda: male coder
    expect(puzzle.people[1].face).toBe('👩‍🍳'); // mira: female chef
    expect(puzzle.people[3].face).toBeNull(); // lena: nurse, not in the map
  });

  it('treats missing paths as null and rejects invalid results as validation errors', () => {
    const meta = extractMetadata(bundle);
    const people = extractPeopleArray(bundle).map((p) => ({ ...(p as object), paths: undefined }));
    const puzzle = normalizePuzzle(meta, people);
    expect(puzzle.people[0].paths).toBeNull();
    expect(() => normalizePuzzle(meta, people.slice(0, 2))).toThrow(/\[validation\]/);
  });
});
