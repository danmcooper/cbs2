import { useMemo, useState } from 'react';
import type { ManifestEntry } from '../../../scripts/manifest.mts';
import { VARIANTS, type Variant } from '../../../shared/puzzle';
import { useFetch } from '../useFetch';
import { filterEntries, groupByMonth, groupByYear, sortDifficulties, statusFor, type PuzzleStatus } from './archiveData';

// Real, then one entry per generated variant, then Both. Driven off the variant
// table so a new variant reaches the dropdown with its own name on it rather
// than hiding inside "Both".
const SOURCES = ['real', ...(Object.keys(VARIANTS) as Variant[]), 'both'] as const;
type Source = (typeof SOURCES)[number];

const SOURCE_LABELS: Record<Source, string> = {
  real: 'Real',
  both: 'Both',
  ...(Object.fromEntries(
    Object.entries(VARIANTS).map(([v, spec]) => [v, spec.label]),
  ) as Record<Variant, string>),
};

/** Real for a first visit; after that, whatever was picked last. */
const SOURCE_KEY = 'cbs:pref:archiveSource';

function loadSource(): Source {
  const saved = localStorage.getItem(SOURCE_KEY);
  return SOURCES.includes(saved as Source) ? (saved as Source) : 'real';
}

export default function Archive() {
  const { data, error, retry } = useFetch<ManifestEntry[]>('puzzles/index.json');
  const [difficulty, setDifficulty] = useState('');
  const [status, setStatus] = useState<PuzzleStatus | ''>('');
  const [source, setSource] = useState<Source>(loadSource);
  // `both` means no variant filter at all.
  const variant = source === 'both' ? undefined : source;
  // Difficulty options are scoped to the current source, so a selection made
  // under one source may not exist under the next; drop it on change rather
  // than leave the <select> holding a value with no matching option.
  const chooseSource = (next: Source) => {
    setSource(next);
    setDifficulty('');
    localStorage.setItem(SOURCE_KEY, next);
  };

  const difficulties = useMemo(
    () =>
      sortDifficulties([
        ...new Set((data ?? []).filter((e) => !variant || e.variant === variant).map((e) => e.difficulty)),
      ]),
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
          <label>
            Source
            <select value={source} onChange={(e) => chooseSource(e.target.value as Source)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
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
                      {source === 'both' && entry.variant !== 'real' && (
                        <span className="arch-source">{VARIANTS[entry.variant].label}</span>
                      )}
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
