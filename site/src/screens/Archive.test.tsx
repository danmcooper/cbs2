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

  it('shows real puzzles by default and swaps to Dan puzzles on the toggle', async () => {
    render(<Archive />);
    await screen.findByText('July 2026');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/play/2026-07-03',
      '#/play/2026-07-01',
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Dan' }));
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/play/2026-07-03-dan',
    ]);
  });
});
