import { useMemo, useState } from 'react';
import type { ManifestEntry } from '../../../scripts/manifest.mts';
import { useFetch } from '../useFetch';
import { filterEntries, groupByMonth, groupByYear, sortDifficulties, statusFor, type PuzzleStatus } from './archiveData';

export default function Archive() {
  const { data, error, retry } = useFetch<ManifestEntry[]>('puzzles/index.json');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState<PuzzleStatus | ''>('');
  const [variant, setVariant] = useState<'real' | 'dan'>('real');
  // Difficulty options are scoped to the current variant, so a selection made
  // under one variant may not exist under the other; drop it on toggle rather
  // than leave the <select> holding a value with no matching option.
  const chooseVariant = (next: 'real' | 'dan') => {
    setVariant(next);
    setDifficulty('');
  };

  const difficulties = useMemo(
    () => sortDifficulties([...new Set((data ?? []).filter((e) => e.variant === variant).map((e) => e.difficulty))]),
    [data, variant],
  );
  const filtered = useMemo(
    () =>
      filterEntries(data ?? [], {
        variant,
        difficulty: difficulty || undefined,
        status: status || undefined,
      }),
    [data, difficulty, status, variant],
  );

  if (error) {
    return (
      <main>
        <p>Failed to load the archive: {error}</p>
        <button onClick={retry}>Retry</button>
      </main>
    );
  }
  if (!data) return <p>Loading…</p>;
  return (
    <main className="archive">
      <h1>Puzzle Archive</h1>
      {data.length === 0 && <p>No puzzles yet — the scraper runs daily.</p>}
      {data.length > 0 && (
        <div className="archive-filters">
          <div className="variant-toggle" role="group" aria-label="Puzzle set">
            <button
              type="button"
              aria-pressed={variant === 'real'}
              onClick={() => chooseVariant('real')}
            >
              Real
            </button>
            <button type="button" aria-pressed={variant === 'dan'} onClick={() => chooseVariant('dan')}>
              Dan
            </button>
          </div>
          <label>
            Difficulty
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="">All</option>
              {difficulties.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as PuzzleStatus | '')}>
              <option value="">All</option>
              <option value="unplayed">Unplayed</option>
              <option value="in progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </label>
        </div>
      )}
      {data.length > 0 && filtered.length === 0 && <p>No puzzles match those filters.</p>}
      {groupByYear(filtered).map((yearGroup) => (
        <details key={yearGroup.year} open={yearGroup.open}>
          <summary>{yearGroup.year}</summary>
          {groupByMonth(yearGroup.entries).map((group) => (
            <section key={group.month}>
              <h2>{group.month}</h2>
              <ul>
                {group.entries.map((entry) => (
                  <li key={entry.slug}>
                    <a href={`#/play/${entry.slug}`}>
                      <span className="arch-date">{entry.date}</span>
                      <span className="arch-title">{entry.title}</span>
                      <span className="arch-difficulty">{entry.difficulty}</span>
                      <span className={`arch-status status-${statusFor(entry.id).replace(' ', '-')}`}>
                        {statusFor(entry.id)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      ))}
    </main>
  );
}
