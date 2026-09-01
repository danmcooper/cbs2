import { describe, expect, it } from 'vitest';
import type { Puzzle } from '../../../shared/puzzle';
import { isDeducible } from './deduce';
import { gameReducer, initialGameState, liveElapsedMs, pickHint, type GameState } from './reducer';

// 2x2 fixture matching the extractor fixture: 0=banda(innocent, revealed),
// 1=mira(criminal, needs [0]), 2=ozan(innocent, needs [0,1] or [3]), 3=lena(criminal, needs [0,2])
const puzzle: Puzzle = {
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
    { name: 'banda', profession: 'coder', gender: 'male', criminal: false, clue: null, origHint: null, paths: [] },
    { name: 'mira', profession: 'chef', gender: 'female', criminal: true, clue: 'c1', origHint: null, paths: [[0]] },
    { name: 'ozan', profession: 'pilot', gender: 'male', criminal: false, clue: 'c2', origHint: null, paths: [[0, 1], [3]] },
    { name: 'lena', profession: 'nurse', gender: 'female', criminal: true, clue: 'c3', origHint: null, paths: [[0, 2]] },
  ],
};

const guess = (s: GameState, index: number, g: 'criminal' | 'innocent', now = 1000) =>
  gameReducer(puzzle, s, { type: 'guess', index, guess: g, now });

describe('isDeducible', () => {
  it('is true when some path is fully flipped, false otherwise', () => {
    expect(isDeducible(puzzle, [0], 1)).toBe(true);
    expect(isDeducible(puzzle, [], 1)).toBe(false);
    expect(isDeducible(puzzle, [0], 2)).toBe(false);
    expect(isDeducible(puzzle, [3], 2)).toBe(true); // alternative path
  });

  // `paths: []` used to mean "never deducible" outright. It now means only
  // that no *recorded* route reaches this card, and an empty list of routes
  // can never match — so what keeps card 0 undeducible here is that the
  // flipped cards genuinely fail to force it, which is the real invariant.
  it('paths [] is not deducible while nothing forces it; paths null always is', () => {
    expect(isDeducible(puzzle, [1, 2, 3], 0)).toBe(false);
    const loose = { ...puzzle, people: puzzle.people.map((p) => ({ ...p, paths: null })) };
    expect(isDeducible(loose, [], 3)).toBe(true);
  });
});

describe('gameReducer', () => {
  it('starts with initialReveals flipped', () => {
    const s = initialGameState(puzzle);
    expect(s.flipped).toEqual([0]);
    expect(s.mistakes).toBe(0);
    expect(s.completed).toBe(false);
  });

  it('flips on a correct guess of a deducible card', () => {
    const s = guess(initialGameState(puzzle), 1, 'criminal');
    expect(s.flipped).toEqual([0, 1]);
    expect(s.mistakes).toBe(0);
    expect(s.rejectedIndex).toBeNull();
  });

  it('rejects a wrong trait on a deducible card: mistake, no flip', () => {
    const s = guess(initialGameState(puzzle), 1, 'innocent');
    expect(s.flipped).toEqual([0]);
    expect(s.mistakes).toBe(1);
    expect(s.rejectedIndex).toBe(1);
  });

  it('rejects a CORRECT trait on a non-deducible card identically (no-guessing rule)', () => {
    const s = guess(initialGameState(puzzle), 3, 'criminal');
    expect(s.flipped).toEqual([0]);
    expect(s.mistakes).toBe(1);
    expect(s.rejectedIndex).toBe(3);
  });

  it('ignores guesses on already-flipped cards and after completion', () => {
    const s0 = initialGameState(puzzle);
    expect(guess(s0, 0, 'innocent')).toBe(s0);
    const done = { ...s0, completed: true };
    expect(guess(done, 1, 'criminal')).toBe(done);
  });

  it('detects completion when all cards are flipped', () => {
    let s = initialGameState(puzzle);
    s = guess(s, 1, 'criminal');
    s = guess(s, 2, 'innocent');
    s = guess(s, 3, 'criminal');
    expect(s.flipped).toEqual([0, 1, 2, 3]);
    expect(s.completed).toBe(true);
  });

  it('accumulates elapsed time between actions, capping idle gaps at 60s', () => {
    let s = initialGameState(puzzle);
    s = guess(s, 1, 'criminal', 5_000); // first action: starts the clock, no elapsed yet
    expect(s.elapsedMs).toBe(0);
    s = guess(s, 2, 'innocent', 15_000);
    expect(s.elapsedMs).toBe(10_000);
    s = guess(s, 3, 'criminal', 500_000); // 485s idle gap capped at 60s
    expect(s.elapsedMs).toBe(70_000);
  });

  it('blocks a rejected verdict for that card until the next reveal', () => {
    let s = guess(initialGameState(puzzle), 1, 'innocent'); // wrong trait
    expect(s.blocked).toEqual({ 1: ['innocent'] });
    const repeat = guess(s, 1, 'innocent'); // blocked: ignored, no extra mistake
    expect(repeat).toBe(s);
    s = guess(s, 3, 'criminal'); // correct but not deducible: also blocked
    expect(s.blocked).toEqual({ 1: ['innocent'], 3: ['criminal'] });
    s = guess(s, 1, 'criminal'); // reveal opens everything back up
    expect(s.flipped).toContain(1);
    expect(s.blocked).toEqual({});
  });

  it('clearRejection resets rejectedIndex and rejectedGuess; restore rebuilds state', () => {
    const rejected = guess(initialGameState(puzzle), 1, 'innocent');
    expect(rejected.rejectedGuess).toBe('innocent');
    const cleared = gameReducer(puzzle, rejected, { type: 'clearRejection' });
    expect(cleared.rejectedIndex).toBeNull();
    expect(cleared.rejectedGuess).toBeNull();
    const restored = gameReducer(puzzle, initialGameState(puzzle), {
      type: 'restore', flipped: [0, 1], mistakes: 2, elapsedMs: 9_000,
    });
    expect(restored).toMatchObject({ flipped: [0, 1], mistakes: 2, elapsedMs: 9_000, completed: false });
  });
});

describe('tags', () => {
  it('cycleTag cycles none -> yellow -> red -> green -> none', () => {
    let s = initialGameState(puzzle);
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 2 });
    expect(s.tags).toEqual({ 2: 'yellow' });
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 2 });
    expect(s.tags).toEqual({ 2: 'red' });
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 2 });
    expect(s.tags).toEqual({ 2: 'green' });
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 2 });
    expect(s.tags).toEqual({});
  });

  it('clearTags wipes all tags and marks, leaving the rest of the state alone', () => {
    let s = initialGameState(puzzle);
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 1 });
    s = gameReducer(puzzle, s, { type: 'setMark', index: 2, mark: 'magenta' });
    s = gameReducer(puzzle, s, { type: 'toggleConsumed', index: 3 });
    s = gameReducer(puzzle, s, { type: 'clearTags' });
    expect(s.tags).toEqual({});
    expect(s.marks).toEqual({});
    expect(s.consumed).toEqual([3]); // dimmed clues are not tags
  });

  it('tags are independent per card and survive restore', () => {
    let s = initialGameState(puzzle);
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 1 });
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 3 });
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 3 });
    expect(s.tags).toEqual({ 1: 'yellow', 3: 'red' });
    const restored = gameReducer(puzzle, initialGameState(puzzle), {
      type: 'restore', flipped: [0], mistakes: 0, elapsedMs: 0, tags: { 2: 'green' },
    });
    expect(restored.tags).toEqual({ 2: 'green' });
  });
});

describe('per-card wrong answers', () => {
  it('records each card that ever got a bad answer, once', () => {
    let s = initialGameState(puzzle);
    s = guess(s, 1, 'innocent'); // wrong trait
    s = guess(s, 3, 'criminal'); // correct but not deducible
    s = guess(s, 3, 'innocent'); // wrong trait, same card again
    expect(s.wrong).toEqual([1, 3]);
    expect(s.mistakes).toBe(3);
    s = guess(s, 1, 'criminal'); // finally right
    expect(s.wrong).toEqual([1, 3]);
  });

  it('restores wrong indices', () => {
    const restored = gameReducer(puzzle, initialGameState(puzzle), {
      type: 'restore', flipped: [0], mistakes: 2, elapsedMs: 0, wrong: [2],
    });
    expect(restored.wrong).toEqual([2]);
  });
});

describe('liveElapsedMs', () => {
  it('adds the capped time since the last action while playing', () => {
    let s = initialGameState(puzzle);
    expect(liveElapsedMs(s, 5_000)).toBe(0); // clock starts at first action
    s = guess(s, 1, 'criminal', 10_000);
    expect(liveElapsedMs(s, 25_000)).toBe(15_000);
    expect(liveElapsedMs(s, 500_000)).toBe(60_000); // idle gap capped
  });

  it('freezes at the recorded time once completed', () => {
    let s = initialGameState(puzzle);
    s = guess(s, 1, 'criminal', 10_000);
    s = guess(s, 2, 'innocent', 40_000);
    s = guess(s, 3, 'criminal', 70_000);
    expect(s.completed).toBe(true);
    expect(liveElapsedMs(s, 999_000)).toBe(s.elapsedMs);
  });
});

describe('start action', () => {
  it('starts the clock so time accrues before the first guess', () => {
    let s = initialGameState(puzzle);
    s = gameReducer(puzzle, s, { type: 'start', now: 10_000 });
    expect(liveElapsedMs(s, 30_000)).toBe(20_000);
    s = guess(s, 1, 'criminal', 40_000);
    expect(s.elapsedMs).toBe(30_000);
  });

  it('is idempotent once the clock is running', () => {
    let s = gameReducer(puzzle, initialGameState(puzzle), { type: 'start', now: 10_000 });
    s = gameReducer(puzzle, s, { type: 'start', now: 99_000 });
    expect(s.lastActionAt).toBe(10_000);
  });
});

describe('consumed clues', () => {
  it('undims every clue when the puzzle completes (real site undim-all default)', () => {
    let s = initialGameState(puzzle);
    s = gameReducer(puzzle, s, { type: 'toggleConsumed', index: 0 });
    s = guess(s, 1, 'criminal');
    expect(s.consumed).toEqual([0]); // mid-game flips keep the dimming
    s = guess(s, 2, 'innocent');
    s = guess(s, 3, 'criminal');
    expect(s.completed).toBe(true);
    expect(s.consumed).toEqual([]);
  });

  it('toggleConsumed toggles per card and survives restore', () => {
    let s = initialGameState(puzzle);
    s = gameReducer(puzzle, s, { type: 'toggleConsumed', index: 1 });
    expect(s.consumed).toEqual([1]);
    s = gameReducer(puzzle, s, { type: 'toggleConsumed', index: 3 });
    s = gameReducer(puzzle, s, { type: 'toggleConsumed', index: 1 });
    expect(s.consumed).toEqual([3]);
    const restored = gameReducer(puzzle, initialGameState(puzzle), {
      type: 'restore', flipped: [0], mistakes: 0, elapsedMs: 0, consumed: [2],
    });
    expect(restored.consumed).toEqual([2]);
  });
});

describe('pause and reset', () => {
  it('pause folds elapsed time and freezes the clock; start resumes', () => {
    let s = gameReducer(puzzle, initialGameState(puzzle), { type: 'start', now: 10_000 });
    s = gameReducer(puzzle, s, { type: 'pause', now: 25_000 });
    expect(s.elapsedMs).toBe(15_000);
    expect(s.lastActionAt).toBeNull();
    expect(liveElapsedMs(s, 500_000)).toBe(15_000); // frozen while paused
    s = gameReducer(puzzle, s, { type: 'start', now: 100_000 });
    expect(liveElapsedMs(s, 110_000)).toBe(25_000);
  });

  it('reset returns to the initial state', () => {
    let s = gameReducer(puzzle, initialGameState(puzzle), { type: 'start', now: 1_000 });
    s = guess(s, 1, 'innocent', 2_000);
    s = gameReducer(puzzle, s, { type: 'cycleTag', index: 2 });
    s = gameReducer(puzzle, s, { type: 'reset' });
    expect(s).toEqual(initialGameState(puzzle));
  });
});

describe('tick action', () => {
  it('accrues time while running, no-op when stopped or completed', () => {
    let s = initialGameState(puzzle);
    expect(gameReducer(puzzle, s, { type: 'tick', now: 5_000 })).toBe(s); // not started
    s = gameReducer(puzzle, s, { type: 'start', now: 10_000 });
    s = gameReducer(puzzle, s, { type: 'tick', now: 11_000 });
    s = gameReducer(puzzle, s, { type: 'tick', now: 12_000 });
    expect(s.elapsedMs).toBe(2_000);
    const done = { ...s, completed: true };
    expect(gameReducer(puzzle, done, { type: 'tick', now: 99_000 })).toBe(done);
  });
});

// Same puzzle plus the fixture's precomputed hint ladder.
const hintPuzzle: Puzzle = {
  ...puzzle,
  hints: [
    { flipped: [0], clues: [0], reveals: [1] },
    { flipped: [0, 1], clues: [1], reveals: [2] },
    { flipped: [0, 1, 2], clues: [2], reveals: [3] },
  ],
};

const hint = (s: GameState, now = 1000) => gameReducer(hintPuzzle, s, { type: 'hint', now });

describe('pickHint', () => {
  it('picks the applicable step whose prerequisites are flipped and reveals something new', () => {
    expect(pickHint(hintPuzzle, [0])).toEqual({ flipped: [0], clues: [0], reveals: [1] });
    expect(pickHint(hintPuzzle, [0, 1])).toEqual({ flipped: [0, 1], clues: [1], reveals: [2] });
  });

  it('prefers fewer clues, then fewer reveals, then more prerequisites', () => {
    const p: Puzzle = {
      ...puzzle,
      hints: [
        { flipped: [0], clues: [0, 1], reveals: [2] },
        { flipped: [0], clues: [0], reveals: [1, 2] },
        { flipped: [0], clues: [0], reveals: [1] },
      ],
    };
    expect(pickHint(p, [0])).toEqual({ flipped: [0], clues: [0], reveals: [1] });
  });

  it('returns null when nothing applies or the puzzle has no hints', () => {
    expect(pickHint(hintPuzzle, [])).toBeNull(); // no step's prerequisites met
    expect(pickHint(hintPuzzle, [0, 1, 2, 3])).toBeNull(); // everything already revealed
    expect(pickHint(puzzle, [0])).toBeNull();
  });
});

describe('hint action', () => {
  it('cycles show hint -> show more -> hide, escalating the pending penalty', () => {
    let s = hint(initialGameState(hintPuzzle));
    expect(s.hint).toEqual({ flipped: [0], clues: [0], reveals: [1] });
    expect(s.hintRevealed).toBe(false);
    expect(s.pendingHint).toBe('hint');
    s = hint(s); // "Show more"
    expect(s.hintRevealed).toBe(true);
    expect(s.pendingHint).toBe('second-hint');
    s = hint(s); // "Hide hint": outlines go away, penalty stays
    expect(s.hint).toBeNull();
    expect(s.hintRevealed).toBe(false);
    expect(s.pendingHint).toBe('second-hint');
  });

  it('records the pending penalty on the next correct flip, then clears hint state', () => {
    let s = hint(initialGameState(hintPuzzle));
    s = gameReducer(hintPuzzle, s, { type: 'guess', index: 1, guess: 'criminal', now: 2000 });
    expect(s.flipped).toContain(1);
    expect(s.hinted).toEqual({ 1: 'hint' });
    expect(s.hint).toBeNull();
    expect(s.pendingHint).toBeNull();
  });

  it('records second-hint when the reveal level was used', () => {
    let s = hint(hint(initialGameState(hintPuzzle)));
    s = gameReducer(hintPuzzle, s, { type: 'guess', index: 1, guess: 'criminal', now: 2000 });
    expect(s.hinted).toEqual({ 1: 'second-hint' });
    expect(s.hintRevealed).toBe(false);
  });

  it('keeps the pending penalty through a wrong guess', () => {
    let s = hint(initialGameState(hintPuzzle));
    s = gameReducer(hintPuzzle, s, { type: 'guess', index: 1, guess: 'innocent', now: 2000 });
    expect(s.pendingHint).toBe('hint');
    expect(s.hinted).toEqual({});
    s = gameReducer(hintPuzzle, s, { type: 'guess', index: 1, guess: 'criminal', now: 3000 });
    expect(s.hinted).toEqual({ 1: 'hint' });
    expect(s.wrong).toEqual([1]);
  });

  it('asking for a fresh hint while a penalty is pending escalates to second-hint', () => {
    let s = hint(hint(hint(initialGameState(hintPuzzle)))); // shown, revealed, hidden
    s = hint(s); // fresh hint while second-hint pending
    expect(s.hint).not.toBeNull();
    expect(s.pendingHint).toBe('second-hint');
  });

  it('is a no-op when completed or when no hint applies', () => {
    const done = { ...initialGameState(hintPuzzle), completed: true };
    expect(hint(done)).toBe(done);
    const s = initialGameState(puzzle); // no hints in puzzle
    expect(gameReducer(puzzle, s, { type: 'hint', now: 1000 })).toBe(s);
  });

  it('restores hinted marks and pending penalty', () => {
    const restored = gameReducer(hintPuzzle, initialGameState(hintPuzzle), {
      type: 'restore', flipped: [0, 1], mistakes: 0, elapsedMs: 0,
      hinted: { 1: 'second-hint' }, pendingHint: 'hint',
    });
    expect(restored.hinted).toEqual({ 1: 'second-hint' });
    expect(restored.pendingHint).toBe('hint');
  });
});

describe('setMark', () => {
  it('sets any picker color directly and null clears, without touching tags', () => {
    let s = initialGameState(puzzle);
    s = gameReducer(puzzle, s, { type: 'setMark', index: 2, mark: 'magenta' });
    expect(s.marks).toEqual({ 2: 'magenta' });
    s = gameReducer(puzzle, s, { type: 'setMark', index: 2, mark: 'cyan' });
    expect(s.marks).toEqual({ 2: 'cyan' });
    expect(s.tags).toEqual({});
    s = gameReducer(puzzle, s, { type: 'setMark', index: 2, mark: null });
    expect(s.marks).toEqual({});
  });
});
