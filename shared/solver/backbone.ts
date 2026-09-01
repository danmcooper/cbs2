/**
 * `forcedGiven` without the enumeration.
 *
 * The question is the backbone of the clue set: which cards carry the same trait
 * in every satisfying assignment. `enumerate.ts` answers it by building all of
 * them and folding; this asks the solver one card at a time, and each answer
 * that comes back satisfiable is a counter-model that frees every other card it
 * disagrees with. So the usual cost is far below one solver call per card, and
 * none of it depends on how many assignments there are.
 */
import { type Clues, activeHints, knownFrom } from './clues';
import { ContradictionError, type Known, type Shape } from './enumerate';
import { encode } from './encode';
import { solve } from './sat';

export { SUPPORTED, UnsupportedPredicateError, supports } from './encode';

/**
 * Same contract as `solve.ts`'s `forcedGiven`, including the precondition that
 * `truth` satisfies the clues on the flipped cards, and the `ContradictionError`
 * when it does not.
 */
export function forcedGivenSat(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  flipped: number[],
): Known {
  const size = shape.grid.size;
  const { cnf, vars } = encode(shape, activeHints(clues, flipped), knownFrom(truth, flipped));

  const first = solve(cnf);
  if (first === null) throw new ContradictionError('no assignment satisfies the clue set');

  const value = vars.map((v) => first[v]);
  const forced = new Array<boolean>(size).fill(true);

  for (let i = 0; i < size; i++) {
    if (!forced[i]) continue; // already freed by an earlier counter-model
    const other = solve(cnf, [value[i] ? -vars[i] : vars[i]]);
    if (other === null) continue; // no assignment flips it, so it is pinned
    // A model that disagrees with the first one about card j proves j is open.
    // Reading the whole model rather than just card i is what keeps this well
    // under one call per card.
    for (let j = 0; j < size; j++) if (forced[j] && other[vars[j]] !== value[j]) forced[j] = false;
  }

  return Array.from({ length: size }, (_, i) => (forced[i] ? value[i] : null));
}

/** Whether the clue set pins exactly one assignment: solve, forbid it, re-solve. */
export function isUniquelySolvableSat(
  shape: Shape,
  clues: Clues,
  truth: boolean[],
  revealed: number[] = [],
): boolean {
  const all = clues.flatMap((h) => (h ? [h] : []));
  const { cnf, vars } = encode(shape, all, knownFrom(truth, revealed));
  const first = solve(cnf);
  if (first === null) return false;
  cnf.add(vars.map((v) => (first[v] ? -v : v)));
  return solve(cnf) === null;
}
