import { describe, expect, it } from 'vitest';
import {
  atLeast,
  atMost,
  counter,
  eqCount,
  exactly,
  geqCount,
  gtCount,
  parityOdd,
  reifyExactly,
} from './cardinality';
import { Cnf, solve } from './sat';

/**
 * An encoding introduces auxiliary variables, so "is it right" cannot be read
 * off the clauses. What has to hold is that fixing the *input* literals leaves
 * the formula satisfiable exactly when the condition is true of them — the aux
 * variables must always be completable, and never rescue a false input.
 */
function agreesWith(
  size: number,
  encode: (cnf: Cnf, lits: number[]) => void,
  want: (trueCount: number) => boolean,
): void {
  const cnf = new Cnf();
  const lits = Array.from({ length: size }, () => cnf.newVar());
  encode(cnf, lits);
  for (let combo = 0; combo < 1 << size; combo++) {
    const assumptions = lits.map((l, i) => ((combo >> i) & 1 ? l : -l));
    let count = 0;
    for (let i = 0; i < size; i++) if ((combo >> i) & 1) count++;
    const sat = solve(cnf, assumptions) !== null;
    expect(sat, `${size} lits, ${count} true`).toBe(want(count));
  }
}

describe('exactly', () => {
  it('admits an input assignment iff exactly k of it are true', () => {
    for (let size = 1; size <= 5; size++)
      for (let k = 0; k <= size; k++) agreesWith(size, (c, l) => exactly(c, l, k), (n) => n === k);
  });

  it('is unsatisfiable when k exceeds the number of literals', () => {
    const cnf = new Cnf();
    const lits = [cnf.newVar(), cnf.newVar()];
    exactly(cnf, lits, 3);
    expect(solve(cnf)).toBeNull();
  });

  it('treats exactly-0 over no literals as vacuously true', () => {
    const cnf = new Cnf();
    exactly(cnf, [], 0);
    expect(solve(cnf)).not.toBeNull();
  });

  it('treats exactly-1 over no literals as impossible', () => {
    const cnf = new Cnf();
    exactly(cnf, [], 1);
    expect(solve(cnf)).toBeNull();
  });
});

describe('atLeast', () => {
  it('admits an input assignment iff at least k of it are true', () => {
    for (let size = 1; size <= 5; size++)
      for (let k = 0; k <= size + 1; k++)
        agreesWith(size, (c, l) => atLeast(c, l, k), (n) => n >= k);
  });
});

describe('atMost', () => {
  it('admits an input assignment iff at most k of it are true', () => {
    for (let size = 1; size <= 5; size++)
      for (let k = 0; k <= size; k++) agreesWith(size, (c, l) => atMost(c, l, k), (n) => n <= k);
  });
});

describe('parityOdd', () => {
  it('admits an input assignment iff an odd number of it are true', () => {
    for (let size = 1; size <= 6; size++) agreesWith(size, parityOdd, (n) => n % 2 === 1);
  });

  it('treats an odd count over no literals as impossible', () => {
    const cnf = new Cnf();
    parityOdd(cnf, []);
    expect(solve(cnf)).toBeNull();
  });
});

describe('reifyExactly', () => {
  it('makes the flag track whether the count equals k', () => {
    for (let size = 1; size <= 4; size++) {
      for (let k = 0; k <= size; k++) {
        const cnf = new Cnf();
        const lits = Array.from({ length: size }, () => cnf.newVar());
        const flag = cnf.newVar();
        reifyExactly(cnf, lits, k, flag);
        for (let combo = 0; combo < 1 << size; combo++) {
          const assumptions = lits.map((l, i) => ((combo >> i) & 1 ? l : -l));
          let count = 0;
          for (let i = 0; i < size; i++) if ((combo >> i) & 1) count++;
          const model = solve(cnf, assumptions);
          expect(model, `${size} lits, ${count} true, k=${k}`).not.toBeNull();
          // The flag is not a free choice: it is pinned by the inputs both ways.
          expect((model as boolean[])[flag]).toBe(count === k);
          expect(solve(cnf, [...assumptions, count === k ? -flag : flag])).toBeNull();
        }
      }
    }
  });

  it('pins the flag false when k cannot be reached', () => {
    const cnf = new Cnf();
    const lits = [cnf.newVar(), cnf.newVar()];
    const flag = cnf.newVar();
    reifyExactly(cnf, lits, 5, flag);
    expect(solve(cnf, [flag])).toBeNull();
    expect(solve(cnf, [-flag])).not.toBeNull();
  });
});

/** Every assignment of two literal sets, checked against the intended relation. */
function comparesAs(
  sizeA: number,
  sizeB: number,
  encode: (cnf: Cnf, a: number[], b: number[]) => void,
  want: (countA: number, countB: number) => boolean,
): void {
  const cnf = new Cnf();
  const litsA = Array.from({ length: sizeA }, () => cnf.newVar());
  const litsB = Array.from({ length: sizeB }, () => cnf.newVar());
  encode(cnf, counter(cnf, litsA), counter(cnf, litsB));
  const all = [...litsA, ...litsB];
  for (let combo = 0; combo < 1 << all.length; combo++) {
    const assumptions = all.map((l, i) => ((combo >> i) & 1 ? l : -l));
    let a = 0;
    let b = 0;
    for (let i = 0; i < sizeA; i++) if ((combo >> i) & 1) a++;
    for (let i = 0; i < sizeB; i++) if ((combo >> (sizeA + i)) & 1) b++;
    expect(solve(cnf, assumptions) !== null, `a=${a}/${sizeA} b=${b}/${sizeB}`).toBe(want(a, b));
  }
}

describe('counter comparisons', () => {
  it('geqCount holds exactly when the first count is at least the second', () => {
    for (let a = 0; a <= 3; a++)
      for (let b = 0; b <= 3; b++) comparesAs(a, b, geqCount, (x, y) => x >= y);
  });

  it('gtCount holds exactly when the first count exceeds the second', () => {
    for (let a = 0; a <= 3; a++)
      for (let b = 0; b <= 3; b++) comparesAs(a, b, gtCount, (x, y) => x > y);
  });

  it('eqCount holds exactly when the counts match', () => {
    for (let a = 0; a <= 3; a++)
      for (let b = 0; b <= 3; b++) comparesAs(a, b, eqCount, (x, y) => x === y);
  });

  it('compares counts over literals that share variables', () => {
    // "as many criminals as innocents in this unit" counts v and -v over the
    // same cards, so the two counters are not independent.
    const cnf = new Cnf();
    const vars = [cnf.newVar(), cnf.newVar(), cnf.newVar(), cnf.newVar()];
    eqCount(
      cnf,
      counter(cnf, vars),
      counter(cnf, vars.map((v) => -v)),
    );
    for (let combo = 0; combo < 16; combo++) {
      const assumptions = vars.map((v, i) => ((combo >> i) & 1 ? v : -v));
      let crim = 0;
      for (let i = 0; i < 4; i++) if ((combo >> i) & 1) crim++;
      expect(solve(cnf, assumptions) !== null).toBe(crim === 4 - crim);
    }
  });
});

describe('encodings over negative literals', () => {
  it('counts a negated literal as true when its variable is false', () => {
    // Innocent cards enter the encoding as -v, so this is the common case, not
    // an edge case.
    const cnf = new Cnf();
    const vars = [cnf.newVar(), cnf.newVar(), cnf.newVar()];
    exactly(cnf, vars.map((v) => -v), 2);
    for (let combo = 0; combo < 8; combo++) {
      const assumptions = vars.map((v, i) => ((combo >> i) & 1 ? v : -v));
      let falses = 0;
      for (let i = 0; i < 3; i++) if (!((combo >> i) & 1)) falses++;
      expect(solve(cnf, assumptions) !== null).toBe(falses === 2);
    }
  });
});
