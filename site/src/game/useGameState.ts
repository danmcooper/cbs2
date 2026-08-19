import { useEffect, useReducer } from 'react';
import type { Puzzle } from '../../../shared/puzzle';
import { gameReducer, initialGameState, type GameAction, type GameState } from './reducer';
import { loadProgress, saveProgress } from './storage';

export function useGameState(puzzle: Puzzle): {
  state: GameState;
  dispatch: (action: GameAction) => void;
} {
  const [state, dispatch] = useReducer(
    (s: GameState, a: GameAction) => gameReducer(puzzle, s, a),
    puzzle,
    (p: Puzzle): GameState => {
      const saved = loadProgress(p.id);
      const initial = initialGameState(p);
      if (!saved) return initial;
      return gameReducer(p, initial, { type: 'restore', ...saved });
    },
  );

  useEffect(() => {
    saveProgress(puzzle.id, {
      flipped: state.flipped,
      mistakes: state.mistakes,
      elapsedMs: state.elapsedMs,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      completed: state.completed,
      tags: state.tags,
      marks: state.marks,
      wrong: state.wrong,
      consumed: state.consumed,
      hinted: state.hinted,
      pendingHint: state.pendingHint,
    });
  }, [puzzle.id, state.flipped, state.mistakes, state.elapsedMs, state.startedAt, state.completedAt, state.completed, state.tags, state.marks, state.wrong, state.consumed, state.hinted, state.pendingHint]);

  return { state, dispatch };
}
