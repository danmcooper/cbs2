import type { ManifestEntry } from '../../../scripts/manifest.mts';
import { loadProgress } from '../game/storage';

export type PuzzleStatus = 'unplayed' | 'in progress' | 'done';

export function statusFor(puzzleId: string): PuzzleStatus {
  const progress = loadProgress(puzzleId);
  if (!progress) return 'unplayed';
  return progress.completed ? 'done' : 'in progress';
}

export function groupByMonth(entries: ManifestEntry[]): { month: string; entries: ManifestEntry[] }[] {
  const groups: { month: string; entries: ManifestEntry[] }[] = [];
  for (const entry of entries) {
    const month = new Date(`${entry.date}T00:00:00`).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.entries.push(entry);
    else groups.push({ month, entries: [entry] });
  }
  return groups;
}

export function groupByYear(
  entries: ManifestEntry[],
  currentYear: number = new Date().getFullYear(),
): { year: string; open: boolean; entries: ManifestEntry[] }[] {
  const groups: { year: string; open: boolean; entries: ManifestEntry[] }[] = [];
  for (const entry of entries) {
    const year = entry.date.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.entries.push(entry);
    else groups.push({ year, open: year === String(currentYear), entries: [entry] });
  }
  return groups;
}

const DIFFICULTY_ORDER = ['Easy', 'Medium', 'Tricky', 'Hard', 'Brutal'];

export function sortDifficulties(difficulties: string[]): string[] {
  return [...difficulties].sort((a, b) => {
    const ai = DIFFICULTY_ORDER.indexOf(a);
    const bi = DIFFICULTY_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

export interface ArchiveFilters {
  difficulty?: string;
  status?: PuzzleStatus;
  variant?: 'real' | 'dan';
}

export function filterEntries(entries: ManifestEntry[], filters: ArchiveFilters): ManifestEntry[] {
  return entries.filter((entry) => {
    if (filters.variant && entry.variant !== filters.variant) return false;
    if (filters.difficulty && entry.difficulty !== filters.difficulty) return false;
    if (filters.status && statusFor(entry.id) !== filters.status) return false;
    return true;
  });
}
