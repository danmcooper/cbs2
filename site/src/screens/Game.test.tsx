// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Game from './Game';

const puzzle = {
  formatVersion: 1,
  id: 'a6f09e2713b2',
  date: '2026-07-07',
  title: 'A tiny test mystery',
  difficulty: 'Easy',
  width: 2,
  height: 2,
  initialReveals: [0],
  source: 'cluesbysam.com',
  people: [
    { name: 'banda', profession: 'coder', gender: 'male', criminal: false, clue: 'Start here', origHint: null, paths: [] },
    { name: 'mira', profession: 'chef', gender: 'female', criminal: true, clue: 'Clue of #NAME:1', origHint: null, paths: [[0]] },
    { name: 'ozan', profession: 'pilot', gender: 'male', criminal: false, clue: null, origHint: null, paths: [[0, 1]] },
    { name: 'lena', profession: 'nurse', gender: 'female', criminal: true, clue: null, origHint: null, paths: [[0, 2]] },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(puzzle), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function renderGame(user: ReturnType<typeof userEvent.setup> = userEvent.setup()) {
  render(<Game slug="2026-07-07" />);
  await screen.findAllByRole('group');
  // Fresh puzzles open with the start popup; click through it.
  const start = screen.queryByRole('button', { name: 'Start' });
  if (start) await user.click(start);
}

// The results popup opens 2.7s after the final flip (like the real site), so
// completion tests run on fake timers and jump past the delay explicitly.
// shouldAdvanceTime keeps testing-library's own polling alive.
function fakeTimersUser() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}
const finishDelay = () => act(() => void vi.advanceTimersByTime(2700));

describe('Game', () => {
  it('loads the puzzle and renders the grid with initial reveals flipped, clue on the card', async () => {
    await renderGame();
    const cards = screen.getAllByRole('group');
    expect(cards).toHaveLength(4);
    expect(cards[0].className).toContain('flipped');
    expect(cards[0].textContent).toContain('Start here');
    expect(cards[1].className).not.toContain('flipped');
  });

  it('opens a guess modal with the suspect and a Close button that just dismisses', async () => {
    const user = userEvent.setup();
    await renderGame();
    await user.click(screen.getByText('ozan'));
    const modal = screen.getByRole('dialog');
    expect(modal.textContent).toContain('ozan');
    expect(modal.textContent).toContain('pilot');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('group')[2].className).not.toContain('flipped');
  });

  it('flips a deducible card on a correct guess and shows its clue on the card', async () => {
    const user = userEvent.setup();
    await renderGame();
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const card = screen.getAllByRole('group')[1];
    expect(card.className).toContain('flipped');
    // The clue is shown on mira's own card, so #NAME:1 self-renders as "me".
    expect(card.textContent).toContain('Clue of me');
  });

  it('shows the same "Not enough evidence!" popup for wrong trait and non-deducible guesses', async () => {
    const user = userEvent.setup();
    await renderGame();
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Innocent' })); // wrong trait
    let dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Not enough evidence!');
    expect(dialog.textContent).toContain("mira can't be logically identified as innocent");
    expect(dialog.textContent).toContain('mira could be criminal');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByText('lena'));
    await user.click(screen.getByRole('button', { name: 'Criminal' })); // correct but not deducible
    dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain("lena can't be logically identified as criminal");
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables a rejected verdict for that suspect until the next reveal', async () => {
    const user = userEvent.setup();
    await renderGame();
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Innocent' })); // wrong trait
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByText('mira'));
    expect(screen.getByRole('button', { name: 'Innocent' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Criminal' })).toHaveProperty('disabled', false);
    await user.click(screen.getByRole('button', { name: 'Criminal' })); // reveals mira
    await user.click(screen.getByText('lena'));
    expect(screen.getByRole('button', { name: 'Innocent' })).toHaveProperty('disabled', false);
    await user.click(screen.getByRole('button', { name: 'Close' }));
  });

  it('delays the results popup 2.7s while the board settles, like the real site', async () => {
    const user = fakeTimersUser();
    await renderGame(user);
    expect(document.querySelector('.grid')?.className).not.toContain('completed');
    for (const [name, verdict] of [['mira', 'Criminal'], ['ozan', 'Innocent'], ['lena', 'Criminal']] as const) {
      await user.click(screen.getByText(name));
      await user.click(screen.getByRole('button', { name: verdict }));
    }
    // Right after the final flip: settle animation runs, no popup or banner yet.
    expect(document.querySelector('.grid')?.className).toContain('completed');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/solved!/i)).toBeNull();
    finishDelay();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText(/solved!/i)).toBeTruthy();
  });

  it('shows an error screen with retry when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    render(<Game slug="2026-07-07" />);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
  });
});

describe('corner tags', () => {
  it('clicking the tag corner cycles yellow/red/green/none without opening the modal', async () => {
    const user = userEvent.setup();
    await renderGame();
    const tag = document.querySelectorAll('.tag')[1] as HTMLElement;
    await user.click(tag);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(tag.className).toContain('tag-yellow');
    await user.click(tag);
    expect(tag.className).toContain('tag-red');
    await user.click(tag);
    expect(tag.className).toContain('tag-green');
    await user.click(tag);
    expect(tag.className).toBe('tag');
  });
});

describe('results popup', () => {
  async function solveWithOneWrong() {
    const user = fakeTimersUser();
    await renderGame(user);
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    await user.click(screen.getByText('ozan'));
    await user.click(screen.getByRole('button', { name: 'Criminal' })); // wrong: ozan is innocent
    await user.click(screen.getByRole('button', { name: 'Continue' })); // dismiss the evidence popup
    await user.click(screen.getByText('ozan'));
    await user.click(screen.getByRole('button', { name: 'Innocent' }));
    await user.click(screen.getByText('lena'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    finishDelay();
    return user;
  }

  it('opens on completion with date, level, color grid, and solve time', async () => {
    await solveWithOneWrong();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Jul 7th 2026 (Easy)');
    expect(dialog.textContent).toMatch(/Solved in \d{2}:\d{2}/);
    const cells = dialog.querySelectorAll('.share-cell');
    expect(cells).toHaveLength(4);
    expect(cells[0].className).toContain('share-green'); // banda: initial reveal
    expect(cells[1].className).toContain('share-green'); // mira: clean
    expect(cells[2].className).toContain('share-yellow'); // ozan: had a bad answer
    expect(cells[3].className).toContain('share-green'); // lena: clean
  });

  it('Copy Text puts the emoji summary on the clipboard and Close dismisses', async () => {
    const user = await solveWithOneWrong();
    // userEvent installs its own clipboard stub; spy on it after setup.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: /copy text/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toMatch(
      /^I solved the daily #CluesBySam, Jul 7th 2026 \(Easy\), in \d{2}:\d{2}\n🟩🟩\n🟨🟩\nhttps:\/\/cluesbysam\.com$/,
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Reopenable via the results button next to the solved banner.
    await user.click(screen.getByRole('button', { name: /results/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('revisiting a completed puzzle', () => {
  it('shows the results popup immediately on load, without the completion delay', async () => {
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({ flipped: [0, 1, 2, 3], mistakes: 1, elapsedMs: 65_000, completed: true }),
    );
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelectorAll('.share-cell')).toHaveLength(4);
    expect(dialog.textContent).toMatch(/Solved in 01:05/);
    // Close leaves the solved banner in place.
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText(/solved!/i)).toBeTruthy();
  });
});

describe('start popup', () => {
  it('welcomes on a fresh puzzle and dismisses on Start', async () => {
    const user = userEvent.setup();
    render(<Game slug="2026-07-07" />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Welcome to Clues by Sam!');
    expect(dialog.textContent).toContain('Jul 7th 2026');
    expect(dialog.textContent).toContain('Difficulty: Easy');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not show when localStorage already has guesses', async () => {
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({ flipped: [0, 1], mistakes: 1, elapsedMs: 5_000, completed: false }),
    );
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('timer display', () => {
  it('tapping cycles minutes -> seconds -> elapsed -> minutes', async () => {
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({
        flipped: [0, 1],
        mistakes: 1,
        elapsedMs: 125_000,
        startedAt: Date.now() - 3 * 86_400_000 - 4 * 3_600_000,
        completed: false,
      }),
    );
    const user = userEvent.setup();
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    const timer = screen.getByText('Timed: < 3 min');
    await user.click(timer);
    expect(timer.textContent).toBe('Timed: 02:05');
    await user.click(timer);
    // Wall-clock since the start, not the (paused-aware) puzzle timer.
    expect(timer.textContent).toMatch(/^Elapsed: 03d:04h:00m:0\ds$/);
    await user.click(timer);
    expect(timer.textContent).toBe('Timed: < 3 min');
  });

  it('elapsed trims the units it does not need', async () => {
    localStorage.setItem('cbs:pref:timerMode', 'elapsed');
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({
        flipped: [0, 1],
        mistakes: 1,
        elapsedMs: 5_000,
        startedAt: Date.now() - 3 * 3_600_000 - 6 * 60_000 - 12_000,
        completed: false,
      }),
    );
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.timer')?.textContent).toMatch(/^Elapsed: 03h:06m:1\ds$/);
  });

  it('elapsed stops when the puzzle is solved', async () => {
    localStorage.setItem('cbs:pref:timerMode', 'elapsed');
    const user = fakeTimersUser();
    await renderGame(user);
    act(() => void vi.advanceTimersByTime(9_000));
    for (const [name, verdict] of [['mira', 'Criminal'], ['ozan', 'Innocent'], ['lena', 'Criminal']] as const) {
      await user.click(screen.getByText(name));
      await user.click(screen.getByRole('button', { name: verdict }));
    }
    const timer = document.querySelector('.timer');
    const atSolve = timer?.textContent;
    expect(atSolve).toMatch(/^Elapsed: 00:0\d$/);
    finishDelay();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(timer?.textContent).toBe(atSolve);
  });

  it('elapsed on a solved puzzle survives a refresh', async () => {
    localStorage.setItem('cbs:pref:timerMode', 'elapsed');
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({
        flipped: [0, 1, 2, 3],
        mistakes: 0,
        elapsedMs: 125_000,
        startedAt: Date.now() - 60 * 60_000,
        completedAt: Date.now() - 55 * 60_000,
        completed: true,
      }),
    );
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    const timer = document.querySelector('.timer');
    expect(timer?.textContent).toBe('Elapsed: 05:00');
    await new Promise((r) => setTimeout(r, 1200));
    expect(timer?.textContent).toBe('Elapsed: 05:00');
  });

  // Saves from before the finish time was recorded have nothing better to
  // fall back on than the puzzle timer.
  it('a solved puzzle with no recorded finish time shows the timed total', async () => {
    localStorage.setItem('cbs:pref:timerMode', 'elapsed');
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({
        flipped: [0, 1, 2, 3],
        mistakes: 0,
        elapsedMs: 125_000,
        startedAt: Date.now() - 5 * 60_000 - 22_000,
        completed: true,
      }),
    );
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.timer')?.textContent).toBe('Elapsed: 02:05');
  });
});

describe('timer under a minute', () => {
  it('shows 0 min from the start so seconds are reachable', async () => {
    const user = userEvent.setup();
    await renderGame();
    const timer = screen.getByText('Timed: < 1 min');
    await user.click(timer);
    expect(timer.textContent).toMatch(/^Timed: 00:0\d$/);
    await user.click(timer);
    expect(timer.textContent).toMatch(/^Elapsed: 00:0\d$/);
    await user.click(timer);
    expect(timer.textContent).toBe('Timed: < 1 min');
  });
});

describe('consumed clues', () => {
  it('clicking a clue dims it and drops name emphasis; clicking again restores', async () => {
    const user = userEvent.setup();
    await renderGame();
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    const card = screen.getAllByRole('group')[1];
    // Active clue: its own card name is emphasized.
    expect(card.querySelector('.card-name')?.className).toContain('referenced');
    await user.click(screen.getByText('Clue of me'));
    expect(card.className).toContain('consumed');
    expect(card.querySelector('.card-name')?.className).not.toContain('referenced');
    await user.click(screen.getByText('Clue of me'));
    expect(card.className).not.toContain('consumed');
    expect(card.querySelector('.card-name')?.className).toContain('referenced');
  });
});

describe('control bar', () => {
  it('shows the date line with date left and time right', async () => {
    await renderGame();
    const line = document.querySelector('.date-line');
    expect(line?.textContent).toBe('Jul 7th 2026 (Easy)Timed: < 1 min');
    expect(screen.getByRole('button', { name: /show hint/i })).toBeTruthy();
  });

  it('the play/pause icon button dims the board and shows the action it performs', async () => {
    const user = userEvent.setup();
    await renderGame();
    const pause = screen.getByRole('button', { name: 'Pause' });
    // Running: two bars, no triangle.
    expect(pause.querySelectorAll('svg rect')).toHaveLength(2);
    expect(pause.querySelector('svg path')).toBeNull();
    expect(pause.className).toContain('btn-pause');
    await user.click(pause);
    expect(document.querySelector('.pause-overlay')).toBeTruthy();
    const unpause = screen.getByRole('button', { name: 'Unpause' });
    // Paused: the play triangle instead.
    expect(unpause.querySelector('svg path')).toBeTruthy();
    expect(unpause.querySelectorAll('svg rect')).toHaveLength(0);
    expect(unpause.textContent).toBe(''); // no text swap
    await user.click(unpause);
    expect(document.querySelector('.pause-overlay')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('Clear Tags sits left of Reset and wipes tags and marks; disabled when there are none', async () => {
    const user = userEvent.setup();
    await renderGame();
    const clear = screen.getByRole('button', { name: 'Clear Tags' });
    expect(clear).toHaveProperty('disabled', true); // nothing to clear yet
    const buttons = [...document.querySelectorAll('.button-row button')].map((b) => b.textContent);
    expect(buttons.indexOf('Clear Tags')).toBe(buttons.indexOf('Reset') - 1);

    const tag = document.querySelectorAll('.tag')[1] as HTMLElement;
    await user.click(tag); // yellow tag on card 1
    expect(clear).toHaveProperty('disabled', false);
    await user.click(clear);
    expect(tag.className).toBe('tag');
    expect(clear).toHaveProperty('disabled', true);
  });

  it('Reset asks for confirmation; Cancel keeps progress, Reset wipes it', async () => {
    const user = userEvent.setup();
    await renderGame();
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    expect(screen.getAllByRole('group')[1].className).toContain('flipped');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('group')[1].className).toContain('flipped');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    const confirm = screen.getByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Reset' }));
    expect(screen.getAllByRole('group')[1].className).not.toContain('flipped');
    // Back to a fresh puzzle: the start popup returns.
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });
});

describe('hint button', () => {
  // Same puzzle with the precomputed hint ladder attached.
  const hintedPuzzle = {
    ...puzzle,
    hints: [
      { flipped: [0], clues: [0], reveals: [1] },
      { flipped: [0, 1], clues: [1], reveals: [2] },
      { flipped: [0, 1, 2], clues: [2], reveals: [3] },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(hintedPuzzle), { status: 200 })),
    );
  });

  it('is disabled when the puzzle has no hints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(puzzle), { status: 200 })));
    await renderGame();
    expect(screen.getByRole('button', { name: /show hint/i })).toHaveProperty('disabled', true);
  });

  it('cycles show hint -> show more -> hide hint, outlining clue then deducible cards', async () => {
    const user = userEvent.setup();
    await renderGame();
    const cards = screen.getAllByRole('group');

    await user.click(screen.getByRole('button', { name: /show hint/i }));
    expect(cards[0].className).toContain('hint-clue'); // banda's clue is the hint
    expect(cards[1].className).not.toContain('hint-card'); // not revealed yet

    await user.click(screen.getByRole('button', { name: /show more/i }));
    expect(cards[0].className).toContain('hint-clue');
    expect(cards[1].className).toContain('hint-card'); // mira is deducible from it

    await user.click(screen.getByRole('button', { name: /hide hint/i }));
    expect(cards[0].className).not.toContain('hint-clue');
    expect(cards[1].className).not.toContain('hint-card');
    expect(screen.getByRole('button', { name: /show hint/i })).toBeTruthy();
  });

  it('clears the outlines when the hinted card flips', async () => {
    const user = userEvent.setup();
    await renderGame();
    await user.click(screen.getByRole('button', { name: /show hint/i }));
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    expect(screen.getAllByRole('group')[0].className).not.toContain('hint-clue');
    expect(screen.getByRole('button', { name: /show hint/i })).toBeTruthy();
  });

  async function solveRest(user: ReturnType<typeof userEvent.setup>) {
    for (const [name, verdict] of [['mira', 'Criminal'], ['ozan', 'Innocent'], ['lena', 'Criminal']] as const) {
      await user.click(screen.getByText(name));
      await user.click(screen.getByRole('button', { name: verdict }));
    }
  }

  it('a first-level hint shows a yellow circle for that card in the results', async () => {
    const user = fakeTimersUser();
    await renderGame(user);
    await user.click(screen.getByRole('button', { name: /show hint/i }));
    await solveRest(user);
    finishDelay();
    const cells = screen.getByRole('dialog').querySelectorAll('.share-cell');
    expect(cells[1].className).toContain('share-hint'); // mira flipped under a hint
    expect(cells[2].className).toContain('share-green');
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: /copy text/i }));
    expect(String(writeText.mock.calls[0]?.[0])).toContain('🟩🟡\n🟩🟩');
  });

  it('a second-level hint shows an orange circle, beating a wrong answer', async () => {
    const user = fakeTimersUser();
    await renderGame(user);
    await user.click(screen.getByRole('button', { name: /show hint/i }));
    await user.click(screen.getByRole('button', { name: /show more/i }));
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Innocent' })); // wrong first
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await solveRest(user);
    finishDelay();
    const cells = screen.getByRole('dialog').querySelectorAll('.share-cell');
    expect(cells[1].className).toContain('share-second-hint');
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: /copy text/i }));
    expect(String(writeText.mock.calls[0]?.[0])).toContain('🟩🟠\n🟩🟩');
  });
});

describe('timer resume', () => {
  it('resumes ticking after a refresh of a started puzzle', async () => {
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({ flipped: [0, 1], mistakes: 1, elapsedMs: 125_000, completed: false }),
    );
    const user = userEvent.setup();
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    const timer = screen.getByText('Timed: < 3 min');
    await user.click(timer);
    expect(timer.textContent).toBe('Timed: 02:05');
    await new Promise((r) => setTimeout(r, 1200));
    expect(timer.textContent).toBe('Timed: 02:06');
  });
});

describe('seconds preference', () => {
  it('remembers the seconds display across a refresh', async () => {
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({ flipped: [0, 1], mistakes: 1, elapsedMs: 125_000, completed: false }),
    );
    const user = userEvent.setup();
    const first = render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    await user.click(screen.getByText('Timed: < 3 min'));
    expect(document.querySelector('.timer')?.textContent).toMatch(/^Timed: \d{2}:\d{2}$/);
    first.unmount();

    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.timer')?.textContent).toMatch(/^Timed: \d{2}:\d{2}$/);
  });
});

describe('correct-guess animation', () => {
  it('pops a Correct! speech bubble on the freshly flipped card only', async () => {
    const user = userEvent.setup();
    await renderGame();
    expect(document.querySelector('.speech-bubble')).toBeNull(); // none on initial reveals
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    const cards = screen.getAllByRole('group');
    expect(cards[1].querySelector('.speech-bubble')?.textContent).toBe('Correct!');
    expect(cards[0].querySelector('.speech-bubble')).toBeNull();
  });

  it('flashes on the most recently correct suspect when reloading a puzzle', async () => {
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({ flipped: [0, 1], mistakes: 0, elapsedMs: 5_000, completed: false }),
    );
    render(<Game slug="2026-07-07" />);
    const cards = await screen.findAllByRole('group');
    expect(cards[1].querySelector('.speech-bubble')?.textContent).toBe('Correct!');
    expect(cards[0].querySelector('.speech-bubble')).toBeNull(); // initial reveal, not a guess
  });

  it('flashes again on the most recently correct suspect after unpausing', async () => {
    const user = userEvent.setup();
    await renderGame(user);
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    // Let the flip's own flash expire first.
    await new Promise((r) => setTimeout(r, 1400));
    expect(document.querySelector('.speech-bubble')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Unpause' }));
    const cards = screen.getAllByRole('group');
    expect(cards[1].querySelector('.speech-bubble')?.textContent).toBe('Correct!');
  });
});

describe('pause persistence', () => {
  it('stays paused across a refresh', async () => {
    const user = userEvent.setup();
    const first = render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    const start = screen.queryByRole('button', { name: 'Start' });
    if (start) await user.click(start);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(document.querySelector('.pause-overlay')).toBeTruthy();
    first.unmount();

    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.pause-overlay')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unpause' })).toBeTruthy();
  });

  // jsdom has no real page lifecycle, so hiding is simulated the way the
  // browser reports it: visibilityState plus the event.
  function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'visibilityState', {
      value: hidden ? 'hidden' : 'visible',
      configurable: true,
    });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
  }

  async function startAndPlay(user: ReturnType<typeof userEvent.setup>) {
    await screen.findAllByRole('group');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
  }

  it('pauses on the spot when the page is hidden, and reopens paused', async () => {
    const user = userEvent.setup();
    const first = render(<Game slug="2026-07-07" />);
    await startAndPlay(user);
    expect(document.querySelector('.pause-overlay')).toBeNull();

    setHidden(true); // locking the phone, switching apps, switching tabs
    expect(document.querySelector('.pause-overlay')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unpause' })).toBeTruthy();
    setHidden(false);
    first.unmount();

    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.pause-overlay')).toBeTruthy();
  });

  it('unpausing after an auto-pause clears it, so a refresh keeps playing', async () => {
    const user = userEvent.setup();
    const first = render(<Game slug="2026-07-07" />);
    await startAndPlay(user);
    setHidden(true);
    setHidden(false);
    await user.click(screen.getByRole('button', { name: 'Unpause' }));
    first.unmount();

    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.pause-overlay')).toBeNull();
  });

  it('parks the puzzle when the page is left, so reopening it is paused', async () => {
    const user = userEvent.setup();
    const first = render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' })); // progress: now parkable
    act(() => void window.dispatchEvent(new Event('pagehide')));
    first.unmount();

    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.pause-overlay')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unpause' })).toBeTruthy();
  });

  it('a plain refresh ignores the park and keeps playing', async () => {
    const user = userEvent.setup();
    const first = render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    act(() => void window.dispatchEvent(new Event('pagehide')));
    first.unmount();

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'reload' } as PerformanceNavigationTiming,
    ]);
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.pause-overlay')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('an unstarted puzzle is not parked', async () => {
    const first = render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    first.unmount();

    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.pause-overlay')).toBeNull();
  });

  it('a solved puzzle is never paused, and cannot be paused', async () => {
    // Paused mid-solve on the previous visit, then reopened already solved.
    localStorage.setItem('cbs:paused:a6f09e2713b2', '1');
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({ flipped: [0, 1, 2, 3], mistakes: 0, elapsedMs: 65_000, completed: true }),
    );
    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.pause-overlay')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveProperty('disabled', true);
  });

  it('disables the pause button as soon as the puzzle is solved', async () => {
    const user = fakeTimersUser();
    await renderGame(user);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveProperty('disabled', false);
    for (const [name, verdict] of [['mira', 'Criminal'], ['ozan', 'Innocent'], ['lena', 'Criminal']] as const) {
      await user.click(screen.getByText(name));
      await user.click(screen.getByRole('button', { name: verdict }));
    }
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveProperty('disabled', true);
  });

  it('does not stay paused after a reset', async () => {
    const user = userEvent.setup();
    const first = render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    const start = screen.queryByRole('button', { name: 'Start' });
    if (start) await user.click(start);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    const confirm = screen.getByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Reset' }));
    first.unmount();

    render(<Game slug="2026-07-07" />);
    await screen.findAllByRole('group');
    expect(document.querySelector('.pause-overlay')).toBeNull();
  });
});

describe('reference bounce animation', () => {
  // mira's clue references ozan by name, instead of the default self-reference.
  const crossRefPuzzle = {
    ...puzzle,
    people: puzzle.people.map((p, i) => (i === 1 ? { ...p, clue: 'Clue about #NAME:2' } : p)),
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(crossRefPuzzle), { status: 200 })),
    );
  });

  it('bounces the referenced suspect, not the clue owner, when the clue is revealed', async () => {
    const user = userEvent.setup();
    await renderGame(user);
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    const cards = screen.getAllByRole('group');
    const miraName = cards[1].querySelector('.card-name');
    const ozanName = cards[2].querySelector('.card-name');
    expect(miraName?.className).toContain('referenced');
    expect(miraName?.className).not.toContain('bounce'); // the clue's own card: no bounce
    expect(ozanName?.className).toContain('referenced');
    expect(ozanName?.className).toContain('bounce'); // the referenced suspect: bounces
  });

  it('does not replay the bounce for a reference that was already active on load', async () => {
    localStorage.setItem(
      'cbs:progress:a6f09e2713b2',
      JSON.stringify({ flipped: [0, 1], mistakes: 0, elapsedMs: 5_000, completed: false }),
    );
    render(<Game slug="2026-07-07" />);
    const cards = await screen.findAllByRole('group');
    const ozanName = cards[2].querySelector('.card-name');
    expect(ozanName?.className).toContain('referenced'); // still statically highlighted
    expect(ozanName?.className).not.toContain('bounce'); // no replay on refresh
  });

  it('bounces again when the clue is hidden and unhidden', async () => {
    const user = userEvent.setup();
    await renderGame(user);
    await user.click(screen.getByText('mira'));
    await user.click(screen.getByRole('button', { name: 'Criminal' }));
    await user.click(screen.getByText('Clue about Ozan'));
    let cards = screen.getAllByRole('group');
    expect(cards[2].querySelector('.card-name')?.className).not.toContain('referenced');
    await user.click(screen.getByText('Clue about Ozan'));
    cards = screen.getAllByRole('group');
    expect(cards[2].querySelector('.card-name')?.className).toContain('bounce');
  });
});

describe('mark color picker', () => {
  const longPress = async (user: ReturnType<typeof userEvent.setup>, el: HTMLElement) => {
    await user.pointer({ keys: '[MouseLeft>]', target: el });
    await new Promise((r) => setTimeout(r, 500));
    await user.pointer('[/MouseLeft]');
  };

  it('long-pressing the bottom-right mark opens the picker; picking a swatch sets that color', async () => {
    const user = userEvent.setup();
    await renderGame();
    const mark = document.querySelectorAll('.mark')[1] as HTMLElement;
    await longPress(user, mark);
    const picker = document.querySelector('.tag-picker');
    expect(picker).toBeTruthy();
    expect(picker?.querySelectorAll('.tag-swatch')).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: 'magenta mark' }));
    expect(mark.className).toContain('mark-magenta');
    expect(document.querySelector('.tag-picker')).toBeNull();
  });

  it('picking the blank swatch clears the mark; a short click opens nothing', async () => {
    const user = userEvent.setup();
    await renderGame();
    const mark = document.querySelectorAll('.mark')[1] as HTMLElement;
    await longPress(user, mark);
    await user.click(screen.getByRole('button', { name: 'clear mark' }));
    expect(mark.className).toBe('mark');
    expect(document.querySelector('.tag-picker')).toBeNull();
    await user.click(mark);
    expect(document.querySelector('.tag-picker')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the top-right tag cycles on click and never opens the picker', async () => {
    const user = userEvent.setup();
    await renderGame();
    const tag = document.querySelectorAll('.tag')[1] as HTMLElement;
    await user.click(tag);
    expect(document.querySelector('.tag-picker')).toBeNull();
    expect(tag.className).toContain('tag-yellow');
    await user.click(tag);
    expect(tag.className).toContain('tag-red');
  });
});
