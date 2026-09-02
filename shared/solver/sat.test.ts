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
