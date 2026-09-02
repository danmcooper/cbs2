import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_NAMES, ALL_PROFESSIONS, BASE_PROFESSION_LIMIT, FLAVOUR, NAMES, PROFESSIONS,
  TITLES, WIDER_PROFESSIONS, WIDE_PROFESSION_LIMIT, faceOf, namesFor, professionsFor,
} from './vocab';

describe('vocab', () => {
  it('has enough distinct material to fill a 20-card grid', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(NAMES.map((n) => n.name)).size).toBe(NAMES.length);
    expect(PROFESSIONS.length).toBeGreaterThanOrEqual(10);
    expect(TITLES.length).toBeGreaterThanOrEqual(20);
    expect(FLAVOUR.length).toBeGreaterThanOrEqual(30);
  });
  // Every tier, not just the base sixteen: the renderer pluralises a profession
  // by sticking an -s on it, with `witch` the one special case the site knows
  // about. A profession that needed a second special case would render wrong on
  // whatever board dealt it in.
  it('uses only regularly pluralising professions', () => {
    for (const p of ALL_PROFESSIONS) {
      expect(p.key, `${p.key} does not pluralise with a plain -s`).toMatch(/[^sxz]$/);
      expect(p.key).not.toMatch(/(ch|sh)$/);
    }
  });
  it('gives every profession a face for both genders', () => {
    for (const p of ALL_PROFESSIONS) {
      expect(faceOf(p.key, 'male')).toBe(p.male);
      expect(faceOf(p.key, 'female')).toBe(p.female);
    }
  });
});

describe('professionsFor', () => {
  it('keys every profession once, across all three tiers', () => {
    expect(new Set(ALL_PROFESSIONS.map((p) => p.key)).size).toBe(ALL_PROFESSIONS.length);
  });

  // Each tier exists to stop the cast running too many cards to a profession.
  // The archive's own board sits near two cards each; a 10x10 on twenty-one
  // professions would be five, which is what the third tier is for.
  it('keeps a 10x10 under three cards to a profession', () => {
    expect(100 / professionsFor(100).length).toBeLessThan(3);
  });

  // The gate is the point: a board that never needed the wider sets still draws
  // from exactly what it always did, so no shipped puzzle changes.
  it('deals each tier in only above the board size that needs it', () => {
    expect(professionsFor(BASE_PROFESSION_LIMIT)).toBe(PROFESSIONS);
    expect(professionsFor(BASE_PROFESSION_LIMIT + 1)).toBe(WIDER_PROFESSIONS);
    expect(professionsFor(WIDE_PROFESSION_LIMIT)).toBe(WIDER_PROFESSIONS);
    expect(professionsFor(WIDE_PROFESSION_LIMIT + 1)).toBe(ALL_PROFESSIONS);
  });

  // The weekday schedule tops out at a 6x6, so nothing a daily puzzle can draw
  // ever reaches the third tier.
  it('never reaches the third tier on a scheduled board', () => {
    expect(professionsFor(6 * 6)).toBe(WIDER_PROFESSIONS);
  });
});

describe('namesFor', () => {
  it('has a distinct name for every card of the largest board', () => {
    expect(ALL_NAMES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ALL_NAMES.map((n) => n.name)).size).toBe(ALL_NAMES.length);
  });

  // The gate is what makes the extra names safe to add at all: `castOf` deals
  // round-robin out of shuffled per-initial buckets, so a name added to a
  // bucket changes which name that bucket deals first. Handing the extras to
  // every board would re-roll the cast of every puzzle already generated.
  it('hands a board no more names than it needs, so existing casts are untouched', () => {
    expect(namesFor(20)).toBe(NAMES);
    expect(namesFor(NAMES.length)).toBe(NAMES);
    expect(namesFor(NAMES.length + 1)).toBe(ALL_NAMES);
    expect(namesFor(100)).toBe(ALL_NAMES);
  });
});

describe('originality', () => {
  it('shares no title or flavour line with the scraped archive', () => {
    const dir = path.join(process.cwd(), 'puzzles');
    const scraped = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
      const puzzle = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      scraped.add(puzzle.title.trim().toLowerCase());
      for (const person of puzzle.people) {
        if (person.clue && !person.origHint) scraped.add(person.clue.trim().toLowerCase());
      }
    }
    for (const t of TITLES) expect(scraped.has(t.trim().toLowerCase()), t).toBe(false);
    for (const f of FLAVOUR) expect(scraped.has(f.trim().toLowerCase()), f).toBe(false);
  });
});
