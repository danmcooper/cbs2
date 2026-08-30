import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAVOUR, NAMES, PROFESSIONS, TITLES, faceOf } from './vocab';

describe('vocab', () => {
  it('has enough distinct material to fill a 20-card grid', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(NAMES.map((n) => n.name)).size).toBe(NAMES.length);
    expect(PROFESSIONS.length).toBeGreaterThanOrEqual(10);
    expect(TITLES.length).toBeGreaterThanOrEqual(20);
    expect(FLAVOUR.length).toBeGreaterThanOrEqual(30);
  });
  it('uses only regularly pluralising professions', () => {
    for (const p of PROFESSIONS) {
      expect(p.key, `${p.key} does not pluralise with a plain -s`).toMatch(/[^sxz]$/);
      expect(p.key).not.toMatch(/(ch|sh)$/);
    }
  });
  it('gives every profession a face for both genders', () => {
    for (const p of PROFESSIONS) {
      expect(faceOf(p.key, 'male')).toBe(p.male);
      expect(faceOf(p.key, 'female')).toBe(p.female);
    }
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
