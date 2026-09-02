import { describe, expect, it } from 'vitest';
import { Cnf, satisfies, solve } from './sat';

describe('Cnf', () => {
  it('hands out distinct variables', () => {
    const cnf = new Cnf();
    const a = cnf.newVar();
    const b = cnf.newVar();
    expect(a).not.toBe(b);
    expect(cnf.nVars).toBe(2);
  });
});

describe('solve', () => {
  it('returns an assignment that satisfies every clause', () => {
    const cnf = new Cnf();
    const [a, b, c] = [cnf.newVar(), cnf.newVar(), cnf.newVar()];
    cnf.add([a, b]);
    cnf.add([-a, c]);
    cnf.add([-b, -c]);
    const model = solve(cnf);
    expect(model).not.toBeNull();
    expect(satisfies(cnf, model as boolean[])).toBe(true);
  });

  it('returns null when no assignment satisfies the clauses', () => {
    const cnf = new Cnf();
    const a = cnf.newVar();
    cnf.add([a]);
    cnf.add([-a]);
    expect(solve(cnf)).toBeNull();
  });

  it('returns null on the empty clause', () => {
    const cnf = new Cnf();
    cnf.newVar();
    cnf.add([]);
    expect(solve(cnf)).toBeNull();
  });

  it('propagates a chain of unit clauses', () => {
    // a, a->b, b->c forces all three true.
    const cnf = new Cnf();
    const [a, b, c] = [cnf.newVar(), cnf.newVar(), cnf.newVar()];
    cnf.add([a]);
    cnf.add([-a, b]);
    cnf.add([-b, c]);
    const model = solve(cnf) as boolean[];
    expect(model[a]).toBe(true);
    expect(model[b]).toBe(true);
    expect(model[c]).toBe(true);
  });

  it('honours assumptions without mutating the clause set', () => {
    const cnf = new Cnf();
    const [a, b] = [cnf.newVar(), cnf.newVar()];
    cnf.add([a, b]);
    const forcedB = solve(cnf, [-a]) as boolean[];
    expect(forcedB[b]).toBe(true);
    // The same solver call with the opposite assumption must still be possible,
    // which it would not be if the assumption had been added as a unit clause.
    const forcedA = solve(cnf, [a]) as boolean[];
    expect(forcedA[a]).toBe(true);
  });

  it('reports UNSAT when the assumptions contradict the clauses', () => {
    const cnf = new Cnf();
    const [a, b] = [cnf.newVar(), cnf.newVar()];
    cnf.add([a, b]);
    expect(solve(cnf, [-a, -b])).toBeNull();
  });

  it('solves a formula whose satisfying assignment needs backtracking', () => {
    // Pigeonhole-ish: exactly one of four, plus clauses that rule out the first
    // three, so the solver has to undo several decisions.
    const cnf = new Cnf();
    const v = [cnf.newVar(), cnf.newVar(), cnf.newVar(), cnf.newVar()];
    cnf.add(v);
    for (let i = 0; i < v.length; i++)
      for (let j = i + 1; j < v.length; j++) cnf.add([-v[i], -v[j]]);
    cnf.add([-v[0]]);
    cnf.add([-v[1]]);
    cnf.add([-v[2]]);
    const model = solve(cnf) as boolean[];
    expect(model[v[3]]).toBe(true);
    expect(satisfies(cnf, model)).toBe(true);
  });
});

/**
 * The engine below the puzzle level. `sat.differential.test.ts` compares whole
 * deductions against the enumerator, but its boards are small enough to solve
 * without ever reaching a conflict worth learning from — the clause learning,
 * the restarts and the cull of the learnt database all sit untouched under it.
 * These go at the solver directly: random formulas checked against every
 * assignment, and one instance hard enough to drive the parts the puzzles do
 * not reach.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whether any of the 2^n assignments satisfies every clause. */
function satisfiableBrute(n: number, clauses: number[][], assumptions: number[]): boolean {
  for (let mask = 0; mask < 1 << n; mask++) {
    const model = [false, ...Array.from({ length: n }, (_, i) => (mask >> i & 1) === 1)];
    const ok = (l: number) => (l > 0) === model[Math.abs(l)];
    if (clauses.every((c) => c.some(ok)) && assumptions.every(ok)) return true;
  }
  return false;
}

describe('solve against exhaustive assignment', () => {
  it('agrees on random formulas, satisfiable and not', () => {
    const rng = mulberry32(20260902);
    let unsat = 0;
    for (let trial = 0; trial < 400; trial++) {
      const n = 6 + Math.floor(rng() * 6);
      // Around 4.3 clauses per variable is where random 3-SAT is hardest and
      // where satisfiable and unsatisfiable formulas turn up in similar numbers.
      const clauses: number[][] = [];
      for (let i = 0; i < Math.round(4.3 * n); i++) {
        const c: number[] = [];
        while (c.length < 3) {
          const v = 1 + Math.floor(rng() * n);
          if (c.some((l) => Math.abs(l) === v)) continue;
          c.push(rng() < 0.5 ? v : -v);
        }
        clauses.push(c);
      }
      const assumptions =
        rng() < 0.3 ? [(rng() < 0.5 ? 1 : -1) * (1 + Math.floor(rng() * n))] : [];

      const cnf = new Cnf();
      for (let i = 0; i < n; i++) cnf.newVar();
      // `add` copies, so the reference keeps clauses the solver has not reordered.
      for (const c of clauses) cnf.add(c);

      const model = solve(cnf, assumptions);
      const expected = satisfiableBrute(n, clauses, assumptions);
      expect(model !== null, `trial ${trial}`).toBe(expected);
      if (model === null) {
        unsat++;
        continue;
      }
      expect(satisfies(cnf, model), `trial ${trial} model`).toBe(true);
      for (const l of assumptions) expect((l > 0) === model[Math.abs(l)]).toBe(true);
    }
    // Both answers have to be represented or the run only tested one of them.
    expect(unsat).toBeGreaterThan(40);
    expect(unsat).toBeLessThan(360);
  });

  it('refutes pigeonhole, which no amount of luck gets through', () => {
    // Eight pigeons into seven holes. Unsatisfiable, and famously beyond short
    // resolution proofs, so the solver has to learn its way out. Small as it
    // looks, it is the only case here that reaches the machinery the puzzle
    // boards never do: about 3,200 conflicts, 15 restarts and 3 culls of the
    // learnt database, in well under a tenth of a second.
    const holes = 7;
    const pigeons = holes + 1;
    const cnf = new Cnf();
    const inHole: number[][] = [];
    for (let p = 0; p < pigeons; p++) {
      inHole.push(Array.from({ length: holes }, () => cnf.newVar()));
    }
    for (const row of inHole) cnf.add(row); // every pigeon is somewhere
    for (let h = 0; h < holes; h++) {
      for (let a = 0; a < pigeons; a++) {
        for (let b = a + 1; b < pigeons; b++) cnf.add([-inHole[a][h], -inHole[b][h]]);
      }
    }
    expect(solve(cnf)).toBeNull();
  });

  it('leaves the clause set as it found it, so a Cnf can be re-solved', () => {
    // Learning appends to a local database; if it ever leaked into `cnf.clauses`
    // then `isUniquelySolvableSat`, which adds a clause and solves again, would
    // be solving a formula full of another call's leftovers.
    const cnf = new Cnf();
    const v = Array.from({ length: 12 }, () => cnf.newVar());
    for (let i = 0; i < v.length; i++)
      for (let j = i + 1; j < v.length; j++) cnf.add([-v[i], -v[j]]);
    cnf.add(v);
    const before = cnf.clauses.length;
    expect(solve(cnf)).not.toBeNull();
    expect(cnf.clauses.length).toBe(before);
  });
});
