// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Archive from './Archive';

const manifest = [
  { date: '2026-07-03', slug: '2026-07-03', variant: 'real', id: 'bbbbbbbbbbbb', difficulty: 'Hard', title: 'Second' },
  { date: '2026-07-03', slug: '2026-07-03-dan', variant: 'dan', id: 'dddddddddddd', difficulty: 'Hard', title: 'Second (Dan)' },
  { date: '2026-07-01', slug: '2026-07-01', variant: 'real', id: 'aaaaaaaaaaaa', difficulty: 'Easy', title: 'First' },
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('Archive', () => {
  it('lists puzzles by month with difficulty, status, and play links', async () => {
    localStorage.setItem(
      'cbs:progress:aaaaaaaaaaaa',
      JSON.stringify({ flipped: [0, 1], mistakes: 0, elapsedMs: 1, completed: true }),
    );
    render(<Archive />);
    expect(await screen.findByText('July 2026')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links[0].getAttribute('href')).toBe('#/play/2026-07-03');
    expect(links[0].textContent).toContain('Hard');
    expect(links[0].textContent).toContain('unplayed');
    expect(links[1].textContent).toContain('done');
  });

  it('groups puzzles under a year section', async () => {
    render(<Archive />);
    const heading = await screen.findByText('2026');
    expect(heading.closest('summary')).toBeTruthy();
    expect(heading.closest('details')?.textContent).toContain('July 2026');
  });

  it('lists difficulty options from Easy to Brutal regardless of manifest order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { date: '2026-07-03', slug: '2026-07-03', variant: 'real', id: 'c', difficulty: 'Brutal', title: 'Third' },
              { date: '2026-07-02', slug: '2026-07-02', variant: 'real', id: 'b', difficulty: 'Tricky', title: 'Second' },
              { date: '2026-07-01', slug: '2026-07-01', variant: 'real', id: 'a', difficulty: 'Easy', title: 'First' },
            ]),
            { status: 200 },
          ),
      ),
    );
    render(<Archive />);
    await screen.findByText('July 2026');
    const options = within(screen.getByLabelText(/difficulty/i)).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['All', 'Easy', 'Tricky', 'Brutal']);
  });

  it('filters the list by difficulty', async () => {
    const user = userEvent.setup();
    render(<Archive />);
    await screen.findByText('July 2026');
    await user.selectOptions(screen.getByLabelText(/difficulty/i), 'Hard');
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.queryByText('First')).toBeFalsy();
  });

  it('filters the list by status', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'cbs:progress:aaaaaaaaaaaa',
      JSON.stringify({ flipped: [0, 1], mistakes: 0, elapsedMs: 1, completed: true }),
    );
    render(<Archive />);
    await screen.findByText('July 2026');
    await user.selectOptions(screen.getByLabelText(/status/i), 'done');
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.queryByText('Second')).toBeFalsy();
  });

  it('shows an error with retry when the manifest fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 500 })));
    render(<Archive />);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('offers Real, Dan, and Both as the source options, defaulting to Real', async () => {
    render(<Archive />);
    await screen.findByText('July 2026');
    const source = screen.getByLabelText(/source/i);
    expect(within(source).getAllByRole('option').map((o) => o.textContent)).toEqual(['Real', 'Dan', 'Both']);
    expect(source).toHaveProperty('value', 'real');
  });

  it('places the source dropdown after the other filters', async () => {
    render(<Archive />);
    await screen.findByText('July 2026');
    expect([...document.querySelectorAll('.archive-filters select')]).toEqual([
      screen.getByLabelText(/difficulty/i),
      screen.getByLabelText(/status/i),
      screen.getByLabelText(/source/i),
    ]);
  });

  it('remembers the chosen source for the next visit', async () => {
    const user = userEvent.setup();
    const first = render(<Archive />);
    await screen.findByText('July 2026');
    await user.selectOptions(screen.getByLabelText(/source/i), 'both');
    first.unmount();

    render(<Archive />);
    await screen.findByText('July 2026');
    expect(screen.getByLabelText(/source/i)).toHaveProperty('value', 'both');
  });

  it('falls back to Real when the saved source is missing or unrecognised', async () => {
    localStorage.setItem('cbs:pref:archiveSource', 'nonsense');
    render(<Archive />);
    await screen.findByText('July 2026');
    expect(screen.getByLabelText(/source/i)).toHaveProperty('value', 'real');
  });

  it('shows real puzzles by default and swaps to Dan puzzles from the source dropdown', async () => {
    const user = userEvent.setup();
    render(<Archive />);
    await screen.findByText('July 2026');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/play/2026-07-03',
      '#/play/2026-07-01',
    ]);

    await user.selectOptions(screen.getByLabelText(/source/i), 'dan');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/play/2026-07-03-dan']);
  });

  it('shows both variants interleaved by date when the source is Both', async () => {
    const user = userEvent.setup();
    render(<Archive />);
    await screen.findByText('July 2026');
    await user.selectOptions(screen.getByLabelText(/source/i), 'both');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/play/2026-07-03',
      '#/play/2026-07-03-dan',
      '#/play/2026-07-01',
    ]);
  });

  it('offers the difficulties of both variants when the source is Both', async () => {
    const user = userEvent.setup();
    render(<Archive />);
    await screen.findByText('July 2026');
    await user.selectOptions(screen.getByLabelText(/source/i), 'dan');
    expect(within(screen.getByLabelText(/difficulty/i)).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All',
      'Hard',
    ]);
    await user.selectOptions(screen.getByLabelText(/source/i), 'both');
    expect(within(screen.getByLabelText(/difficulty/i)).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All',
      'Easy',
      'Hard',
    ]);
  });

  it('clears the difficulty filter when the source changes', async () => {
    const user = userEvent.setup();
    render(<Archive />);
    await screen.findByText('July 2026');
    // 'Easy' only exists among the real puzzles (2026-07-01); select it, then
    // switch to Dan, which only has 'Hard' puzzles.
    await user.selectOptions(screen.getByLabelText(/difficulty/i), 'Easy');
    expect(screen.getByText('First')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText(/source/i), 'dan');
    expect(screen.getByLabelText(/difficulty/i)).toHaveProperty('value', '');
    expect(screen.getByText('Second (Dan)')).toBeTruthy();
    expect(screen.queryByText('No puzzles match those filters.')).toBeFalsy();
  });

  it('marks which rows are Dan puzzles only when both sources are shown', async () => {
    const user = userEvent.setup();
    render(<Archive />);
    await screen.findByText('July 2026');
    await user.selectOptions(screen.getByLabelText(/source/i), 'dan');
    expect(screen.queryByText('Dan', { selector: '.arch-source' })).toBeFalsy();
    await user.selectOptions(screen.getByLabelText(/source/i), 'both');
    const tags = screen.getAllByText('Dan', { selector: '.arch-source' });
    expect(tags.length).toBe(1);
    expect(tags[0].closest('a')?.getAttribute('href')).toBe('#/play/2026-07-03-dan');
  });
});
