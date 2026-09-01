// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ManifestEntry } from '../../../scripts/manifest.mts';
import { saveProgress } from '../game/storage';
import { filterEntries, groupByMonth, groupByYear, sortDifficulties, statusFor } from './archiveData';

const entry = (
  date: string,
  overrides: Partial<{ id: string; difficulty: string; title: string; slug: string; variant: 'real' | 'dan' }> = {},
): ManifestEntry => ({
  date,
  slug: overrides.slug ?? date,
  variant: overrides.variant ?? 'real',
  id: overrides.id ?? 'a6f09e2713b2',
  difficulty: overrides.difficulty ?? 'Easy',
  title: overrides.title ?? 'T',
});

beforeEach(() => localStorage.clear());

describe('groupByMonth', () => {
  it('groups date-descending entries into labeled months', () => {
    const groups = groupByMonth([entry('2026-07-03'), entry('2026-07-01'), entry('2026-06-30')]);
    expect(groups.map((g) => g.month)).toEqual(['July 2026', 'June 2026']);
    expect(groups[0].entries.map((e) => e.date)).toEqual(['2026-07-03', '2026-07-01']);
  });
});

describe('groupByYear', () => {
  it('groups date-descending entries into labeled years, marking only the current year open', () => {
    const groups = groupByYear([entry('2026-01-05'), entry('2025-12-30'), entry('2025-01-01')], 2026);
    expect(groups.map((g) => g.year)).toEqual(['2026', '2025']);
    expect(groups[0].entries.map((e) => e.date)).toEqual(['2026-01-05']);
    expect(groups[1].entries.map((e) => e.date)).toEqual(['2025-12-30', '2025-01-01']);
    expect(groups[0].open).toBe(true);
    expect(groups[1].open).toBe(false);
  });
});

describe('sortDifficulties', () => {
  it('orders known difficulties from Easy to Brutal regardless of input order', () => {
    expect(sortDifficulties(['Brutal', 'Easy', 'Tricky', 'Medium', 'Hard'])).toEqual([
      'Easy',
      'Medium',
      'Tricky',
      'Hard',
      'Brutal',
    ]);
  });

  it('sorts unrecognized difficulties alphabetically after the known ones', () => {
    expect(sortDifficulties(['Impossible', 'Easy', 'Ultra'])).toEqual(['Easy', 'Impossible', 'Ultra']);
  });
});

describe('filterEntries', () => {
  it('returns all entries when no filters are set', () => {
    const entries = [entry('2026-07-03'), entry('2026-07-01')];
    expect(filterEntries(entries, {})).toEqual(entries);
  });

  it('filters by difficulty', () => {
    const entries = [entry('2026-07-03', { difficulty: 'Hard' }), entry('2026-07-01', { difficulty: 'Easy' })];
    expect(filterEntries(entries, { difficulty: 'Hard' }).map((e) => e.date)).toEqual(['2026-07-03']);
  });

  it('filters by status', () => {
    const entries = [entry('2026-07-03', { id: 'done-id' }), entry('2026-07-01', { id: 'unplayed-id' })];
    saveProgress('done-id', { flipped: [0, 1], mistakes: 0, elapsedMs: 1, completed: true });
    expect(filterEntries(entries, { status: 'done' }).map((e) => e.date)).toEqual(['2026-07-03']);
  });
});

describe('statusFor', () => {
  it('maps missing/in-progress/completed progress to statuses', () => {
    expect(statusFor('a6f09e2713b2')).toBe('unplayed');
    saveProgress('a6f09e2713b2', { flipped: [0], mistakes: 0, elapsedMs: 0, completed: false });
    expect(statusFor('a6f09e2713b2')).toBe('in progress');
    saveProgress('a6f09e2713b2', { flipped: [0, 1], mistakes: 1, elapsedMs: 5, completed: true });
    expect(statusFor('a6f09e2713b2')).toBe('done');
  });
});

describe('filterEntries variant', () => {
  const entries: ManifestEntry[] = [
    { date: '2026-07-03', slug: '2026-07-03', variant: 'real', id: 'aaaaaaaaaaaa', difficulty: 'Easy', title: 'Real' },
    { date: '2026-07-03', slug: '2026-07-03-dan', variant: 'dan', id: 'bbbbbbbbbbbb', difficulty: 'Easy', title: 'Dan' },
  ];

  it('keeps only the requested variant', () => {
    expect(filterEntries(entries, { variant: 'real' }).map((e) => e.slug)).toEqual(['2026-07-03']);
    expect(filterEntries(entries, { variant: 'dan' }).map((e) => e.slug)).toEqual(['2026-07-03-dan']);
  });

  it('keeps both when no variant is requested', () => {
    expect(filterEntries(entries, {}).length).toBe(2);
  });
});
