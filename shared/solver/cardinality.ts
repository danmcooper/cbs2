/**
 * Counting constraints over literals, which is what almost every clue in the
 * archive turns out to be. Of 685 clues across the real puzzles, 39% are a
 * count over one fixed set of cards, 14% compare two such counts, and a further
 * 23% are a count with a literal or a second count attached — so a correct
 * totalizer plus a parity chain covers the bulk of the game.
 *
 * The sets are small (a column is `height` cards, a profession a handful), so
 * the totalizer's O(m^2) clauses are cheap and its arc-consistency under unit
 * propagation is worth more than a tighter encoding would be.
 */
import type { Cnf } from './sat';

/**
 * Unary counter over `lits`: element `j - 1` of the result is true exactly when
 * at least `j` of `lits` are. Built as a balanced merge tree, both directions
 * encoded, so propagation flows from inputs to count and back.
 */
export function totalizer(cnf: Cnf, lits: number[]): number[] {
  if (lits.length === 0) return [];
  if (lits.length === 1) return [lits[0]];

  const mid = lits.length >> 1;
  const left = totalizer(cnf, lits.slice(0, mid));
  const right = totalizer(cnf, lits.slice(mid));
  const a = left.length;
  const b = right.length;
  const out = Array.from({ length: a + b }, () => cnf.newVar());

  for (let i = 0; i <= a; i++) {
    for (let j = 0; j <= b; j++) {
      // at least i on the left and j on the right => at least i + j overall
      if (i + j >= 1 && i + j <= a + b) {
        const clause: number[] = [];
        if (i >= 1) clause.push(-left[i - 1]);
        if (j >= 1) clause.push(-right[j - 1]);
        clause.push(out[i + j - 1]);
        cnf.add(clause);
      }
      // fewer than i+1 on the left and fewer than j+1 on the right
      // => fewer than i + j + 1 overall
      if (i + j + 1 <= a + b) {
        const clause: number[] = [];
        if (i + 1 <= a) clause.push(left[i]);
        if (j + 1 <= b) clause.push(right[j]);
        clause.push(-out[i + j]);
        cnf.add(clause);
      }
    }
  }
  return out;
}

/** A counter reused across several constraints on the same literals. */
export function counter(cnf: Cnf, lits: number[]): number[] {
  return totalizer(cnf, lits);
}

export function atLeastCount(cnf: Cnf, count: number[], k: number): void {
  if (k <= 0) return; // any assignment has at least zero
  if (k > count.length) {
    cnf.add([]); // impossible
    return;
  }
  cnf.addUnit(count[k - 1]);
}

export function atMostCount(cnf: Cnf, count: number[], k: number): void {
  if (k >= count.length) return; // any assignment has at most all of them
  if (k < 0) {
    cnf.add([]);
    return;
  }
  cnf.addUnit(-count[k]);
}

export function atLeast(cnf: Cnf, lits: number[], k: number): void {
  if (k <= 0) return;
  atLeastCount(cnf, counter(cnf, lits), k);
}

export function atMost(cnf: Cnf, lits: number[], k: number): void {
  if (k >= lits.length) return;
  atMostCount(cnf, counter(cnf, lits), k);
}

export function exactly(cnf: Cnf, lits: number[], k: number): void {
  if (k < 0 || k > lits.length) {
    cnf.add([]);
    return;
  }
  if (lits.length === 0) return; // k is 0, which no clause is needed to say
  const count = counter(cnf, lits);
  atLeastCount(cnf, count, k);
  atMostCount(cnf, count, k);
}

/**
 * True when an odd number of `lits` are true. A chain of XOR gates rather than a
 * read off the totalizer: it is linear in the number of literals where picking
 * the odd positions out of a unary count is quadratic, and parity is the one
 * counting predicate that never needs the count itself.
 */
export function parityOdd(cnf: Cnf, lits: number[]): void {
  if (lits.length === 0) {
    cnf.add([]); // zero is even
    return;
  }
  let acc = lits[0];
  for (let i = 1; i < lits.length; i++) {
    const x = lits[i];
    const next = cnf.newVar();
    // next <-> acc XOR x
    cnf.add([-acc, -x, -next]);
    cnf.add([acc, x, -next]);
    cnf.add([acc, -x, next]);
    cnf.add([-acc, x, next]);
    acc = next;
  }
  cnf.addUnit(acc);
}

/**
 * Comparisons between two unary counters. 14% of the archive's clues are one
 * count set against another — "more criminals in row 2 than in column 3", "as
 * many criminal doctors as criminal clerks" — and the two literal sets are
 * often not disjoint, so these constrain the counters rather than the cards.
 *
 * `a` at index j-1 means "at least j", which makes each comparison a chain of
 * implications between the two unary encodings. A threshold past the end of a
 * counter is unreachable, so the implication collapses to forbidding the
 * antecedent.
 */
export function geqCount(cnf: Cnf, a: number[], b: number[]): void {
  for (let j = 1; j <= b.length; j++) {
    if (j <= a.length) cnf.add([-b[j - 1], a[j - 1]]);
    else cnf.addUnit(-b[j - 1]);
  }
}

export function gtCount(cnf: Cnf, a: number[], b: number[]): void {
  // b holds at least 0 unconditionally, so a must hold at least 1.
  if (a.length === 0) {
    cnf.add([]);
    return;
  }
  cnf.addUnit(a[0]);
  for (let j = 1; j <= b.length; j++) {
    if (j + 1 <= a.length) cnf.add([-b[j - 1], a[j]]);
    else cnf.addUnit(-b[j - 1]);
  }
}

export function eqCount(cnf: Cnf, a: number[], b: number[]): void {
  geqCount(cnf, a, b);
  geqCount(cnf, b, a);
}

/** `flag` is true exactly when the number of true `lits` equals `k`. */
export function reifyExactly(cnf: Cnf, lits: number[], k: number, flag: number): void {
  if (k < 0 || k > lits.length) {
    cnf.addUnit(-flag);
    return;
  }
  if (lits.length === 0) {
    // k is 0, so the count always equals it
    cnf.addUnit(flag);
    return;
  }
  const count = counter(cnf, lits);
  // flag -> count >= k and count <= k
  if (k >= 1) cnf.add([-flag, count[k - 1]]);
  if (k < count.length) cnf.add([-flag, -count[k]]);
  // count >= k and count <= k -> flag
  const clause = [flag];
  if (k >= 1) clause.push(-count[k - 1]);
  if (k < count.length) clause.push(count[k]);
  cnf.add(clause);
}
