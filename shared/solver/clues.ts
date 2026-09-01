/**
 * The clue set and the two ways a position is described to a solver.
 *
 * Split out of `solve.ts` so that the SAT engine can express its own version of
 * `forcedGiven` without importing the module that now calls it. Both engines
 * need to turn a position into "what is known" and "which hints are live", and
 * neither of those depends on how the question is then answered.
 */
import { type Known } from './enumerate';
import { type Hint, parseHint } from './hint';

export type Clues = (Hint | null)[];

/** Convenience for tests and scripts: origHint strings -> Clues. */
export function parseClues(origHints: (string | null)[]): Clues {
  return origHints.map((s) => (s === null ? null : parseHint(s)));
}

export function knownFrom(truth: boolean[], flipped: number[]): Known {
  const known: Known = truth.map(() => null);
  for (const i of flipped) known[i] = truth[i];
  return known;
}

/**
 * A card's clue is readable only once the card is face up, so the live hints are
 * exactly those on flipped cards.
 */
export function activeHints(clues: Clues, flipped: number[]): Hint[] {
  const out: Hint[] = [];
  for (const i of flipped) {
    const hint = clues[i];
    if (hint) out.push(hint);
  }
  return out;
}
