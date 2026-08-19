import type { HintStep, Puzzle } from '../../../shared/puzzle';
import { isDeducible } from './deduce';

export type Guess = 'criminal' | 'innocent';

/** First press outlines the clue ('hint'); second press outlines the deducible
 * cards too ('second-hint'). The level taints the next correct flip. */
export type HintLevel = 'hint' | 'second-hint';

export type Tag = 'yellow' | 'red' | 'green' | 'orange' | 'magenta' | 'cyan';

/** Picker order, matching the real site's color strip (null = no mark). */
export const TAG_COLORS: (Tag | null)[] = [null, 'yellow', 'red', 'green', 'orange', 'magenta', 'cyan'];

export interface GameState {
  flipped: number[];
  mistakes: number;
  elapsedMs: number;
  lastActionAt: number | null;
  /** Wall-clock time the puzzle was first started (for the elapsed display). */
  startedAt: number | null;
  /** Wall-clock time of the final flip; stops the elapsed display. */
  completedAt: number | null;
  rejectedIndex: number | null;
  /** The verdict the player picked when rejectedIndex was set. */
  rejectedGuess: Guess | null;
  /** Rejected verdicts per card, disabled until the next suspect is revealed. */
  blocked: Record<number, Guess[]>;
  completed: boolean;
  tags: Record<number, Tag>;
  /** Bottom-right corner marks, set via the color picker. */
  marks: Record<number, Tag>;
  /** Cards that ever received a bad answer (for the results grid). */
  wrong: number[];
  /** Cards whose clue the player marked as used (dimmed). */
  consumed: number[];
  /** Active hint step: its clue cards are outlined on the board. */
  hint: HintStep | null;
  /** The second press also outlined the hint's deducible cards. */
  hintRevealed: boolean;
  /** Hint level charged to the next correct flip. */
  pendingHint: HintLevel | null;
  /** Cards flipped with hint help (for the results grid). */
  hinted: Record<number, HintLevel>;
}

export type GameAction =
  | { type: 'start'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'tick'; now: number }
  | { type: 'reset' }
  | { type: 'guess'; index: number; guess: Guess; now: number }
  | { type: 'hint'; now: number }
  | { type: 'clearRejection' }
  | { type: 'cycleTag'; index: number }
  | { type: 'setMark'; index: number; mark: Tag | null }
  | { type: 'clearTags' }
  | { type: 'toggleConsumed'; index: number }
  | {
      type: 'restore';
      flipped: number[];
      mistakes: number;
      elapsedMs: number;
      startedAt?: number | null;
      completedAt?: number | null;
      tags?: Record<number, Tag>;
      marks?: Record<number, Tag>;
      wrong?: number[];
      consumed?: number[];
      hinted?: Record<number, HintLevel>;
      pendingHint?: HintLevel | null;
    };

const TAG_CYCLE: (Tag | undefined)[] = [undefined, 'yellow', 'red', 'green'];

const MAX_TICK_MS = 60_000;

export function initialGameState(puzzle: Puzzle): GameState {
  return {
    flipped: [...puzzle.initialReveals],
    mistakes: 0,
    elapsedMs: 0,
    lastActionAt: null,
    startedAt: null,
    completedAt: null,
    rejectedIndex: null,
    rejectedGuess: null,
    blocked: {},
    completed: false,
    tags: {},
    marks: {},
    wrong: [],
    consumed: [],
    hint: null,
    hintRevealed: false,
    pendingHint: null,
    hinted: {},
  };
}

/**
 * The next hint to offer: the cheapest applicable step (fewest clues, then
 * fewest reveals, then most prerequisites) whose prerequisite cards are all
 * flipped and which still reveals something new. Mirrors the source site.
 */
export function pickHint(puzzle: Puzzle, flipped: number[]): HintStep | null {
  const steps = [...(puzzle.hints ?? [])].sort(
    (a, b) =>
      a.clues.length - b.clues.length ||
      a.reveals.length - b.reveals.length ||
      b.flipped.length - a.flipped.length,
  );
  return (
    steps.find(
      (s) => s.flipped.every((i) => flipped.includes(i)) && !s.reveals.every((i) => flipped.includes(i)),
    ) ?? null
  );
}

/** Elapsed time as of `now`, using the same capped-idle rule the reducer applies. */
export function liveElapsedMs(state: GameState, now: number): number {
  if (state.completed || state.lastActionAt === null) return state.elapsedMs;
  return state.elapsedMs + Math.max(0, Math.min(now - state.lastActionAt, MAX_TICK_MS));
}

function tick(state: GameState, now: number): GameState {
  const delta = state.lastActionAt === null ? 0 : Math.min(now - state.lastActionAt, MAX_TICK_MS);
  return {
    ...state,
    elapsedMs: state.elapsedMs + Math.max(delta, 0),
    lastActionAt: now,
    startedAt: state.startedAt ?? now,
  };
}

export function gameReducer(puzzle: Puzzle, state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'start':
      return state.lastActionAt === null
        ? { ...state, lastActionAt: action.now, startedAt: state.startedAt ?? action.now }
        : state;
    case 'pause':
      // Fold accrued time in, then stop the clock until the next start.
      return state.lastActionAt === null ? state : { ...tick(state, action.now), lastActionAt: null };
    case 'tick':
      // Periodic fold while the page is visible, so elapsed time persists.
      if (state.lastActionAt === null || state.completed) return state;
      return tick(state, action.now);
    case 'reset':
      return initialGameState(puzzle);
    case 'guess': {
      if (state.completed || state.flipped.includes(action.index)) return state;
      if ((state.blocked[action.index] ?? []).includes(action.guess)) return state;
      const person = puzzle.people[action.index];
      const correctTrait = (action.guess === 'criminal') === person.criminal;
      const allowed = correctTrait && isDeducible(puzzle, state.flipped, action.index);
      const timed = tick(state, action.now);
      if (!allowed) {
        // Same rejection for "wrong trait" and "not deducible" - never leak which.
        const wrong = timed.wrong.includes(action.index) ? timed.wrong : [...timed.wrong, action.index];
        return {
          ...timed,
          mistakes: timed.mistakes + 1,
          rejectedIndex: action.index,
          rejectedGuess: action.guess,
          blocked: {
            ...timed.blocked,
            [action.index]: [...(timed.blocked[action.index] ?? []), action.guess],
          },
          wrong,
        };
      }
      const flipped = [...timed.flipped, action.index];
      const completed = flipped.length === puzzle.people.length;
      return {
        ...timed,
        flipped,
        rejectedIndex: null,
        rejectedGuess: null,
        blocked: {}, // a new reveal is new evidence; blocked verdicts open back up
        completed,
        completedAt: completed ? action.now : null,
        // The real site's undim-all default: every clue undims at completion.
        consumed: completed ? [] : timed.consumed,
        // A pending hint taints exactly this flip, then everything resets.
        hinted: timed.pendingHint
          ? { ...timed.hinted, [action.index]: timed.pendingHint }
          : timed.hinted,
        hint: null,
        hintRevealed: false,
        pendingHint: null,
      };
    }
    case 'hint': {
      if (state.completed) return state;
      if (state.hint && state.hintRevealed) {
        // "Hide hint": outlines go away, but the charge already taken stays.
        return { ...tick(state, action.now), hint: null, hintRevealed: false };
      }
      if (state.hint) {
        // "Show more": also outline the deducible cards.
        return { ...tick(state, action.now), hintRevealed: true, pendingHint: 'second-hint' };
      }
      const step = pickHint(puzzle, state.flipped);
      if (!step) return state;
      return {
        ...tick(state, action.now),
        hint: step,
        // A repeat ask with a penalty still pending counts as digging deeper.
        pendingHint: state.pendingHint ? 'second-hint' : 'hint',
      };
    }
    case 'clearRejection':
      return state.rejectedIndex === null
        ? state
        : { ...state, rejectedIndex: null, rejectedGuess: null };
    case 'cycleTag': {
      const next = TAG_CYCLE[(TAG_CYCLE.indexOf(state.tags[action.index]) + 1) % TAG_CYCLE.length];
      const tags = { ...state.tags };
      if (next === undefined) delete tags[action.index];
      else tags[action.index] = next;
      return { ...state, tags };
    }
    case 'setMark': {
      const marks = { ...state.marks };
      if (action.mark === null) delete marks[action.index];
      else marks[action.index] = action.mark;
      return { ...state, marks };
    }
    case 'clearTags':
      return { ...state, tags: {}, marks: {} };
    case 'toggleConsumed':
      return {
        ...state,
        consumed: state.consumed.includes(action.index)
          ? state.consumed.filter((i) => i !== action.index)
          : [...state.consumed, action.index],
      };
    case 'restore': {
      const completed = action.flipped.length === puzzle.people.length;
      const startedAt = action.startedAt ?? null;
      return {
        ...initialGameState(puzzle),
        flipped: [...action.flipped],
        mistakes: action.mistakes,
        elapsedMs: action.elapsedMs,
        // Saves from before the elapsed display have no start time; the next
        // start/tick stamps one.
        startedAt,
        // Saves from before the finish time was recorded fall back to the
        // puzzle timer, so a solved puzzle still shows a settled elapsed time.
        completedAt:
          action.completedAt ??
          (completed && startedAt !== null ? startedAt + action.elapsedMs : null),
        completed,
        tags: { ...action.tags },
        marks: { ...action.marks },
        wrong: [...(action.wrong ?? [])],
        consumed: [...(action.consumed ?? [])],
        hinted: { ...action.hinted },
        pendingHint: action.pendingHint ?? null,
      };
    }
  }
}
