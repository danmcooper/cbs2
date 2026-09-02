/**
 * A small DPLL SAT solver, enough to answer the two questions the puzzle solver
 * actually asks: is this clue set satisfiable, and is a given card's trait the
 * same in every assignment that satisfies it.
 *
 * `enumerate.ts` answers both by materialising all 2^(width*height) assignments,
 * which is why the shipped board is 4x5: a 5x6 board is 2^30 assignments, a 4.3
 * GB allocation, and roughly 1024x the work per call. Search costs what the
 * clauses cost instead of what the board costs, so board size stops being the
 * thing that decides feasibility.
 *
 * Deliberately plain: unit propagation over two watched literals, chronological
 * backtracking, no clause learning and no activity heuristic. The instances are
 * tens of primary variables plus a few hundred from the cardinality encodings,
 * which is small enough that the machinery a real CDCL needs would cost more to
 * run than it saves. `enumerate.ts` stays the reference implementation, and
 * `sat.differential.test.ts` holds the two engines to the same answers.
 */

/** A clause is a list of literals: `v` for variable v true, `-v` for false. */
export class Cnf {
  nVars = 0;
  readonly clauses: number[][] = [];

  newVar(): number {
    return ++this.nVars;
  }

  add(clause: number[]): void {
    this.clauses.push([...clause]);
  }

  /** `lit` is true in every satisfying assignment of the result. */
  addUnit(lit: number): void {
    this.clauses.push([lit]);
  }
}

export function satisfies(cnf: Cnf, model: boolean[]): boolean {
  return cnf.clauses.every((c) => c.some((l) => (l > 0) === model[Math.abs(l)]));
}

/**
 * A satisfying assignment indexed by variable (element 0 unused), or null if
 * none exists. `assumptions` are literals forced for this call only; they are
 * never added to the clause set, so the same `Cnf` can be re-solved under
 * contradictory assumptions.
 *
 * Note: this reorders literals *within* clauses to maintain the watched-literal
 * invariant. That is semantically invisible — a clause is a set — but it does
 * mean the arrays handed to `add` are not preserved verbatim.
 */
export function solve(cnf: Cnf, assumptions: number[] = []): boolean[] | null {
  const n = cnf.nVars;
  const clauses = cnf.clauses;

  // Literal -> watch-list slot. Positive v at 2v, negative v at 2v+1.
  const slot = (l: number) => (l > 0 ? 2 * l : 2 * -l + 1);
  const watches: number[][] = Array.from({ length: 2 * (n + 1) }, () => []);

  const value = new Int8Array(n + 1); // 0 unknown, 1 true, -1 false
  const trail: number[] = [];
  let qhead = 0;

  const litValue = (l: number): number => (l > 0 ? value[l] : -value[-l]);

  const enqueue = (l: number): boolean => {
    const v = l > 0 ? l : -l;
    const want = l > 0 ? 1 : -1;
    if (value[v] !== 0) return value[v] === want;
    value[v] = want;
    trail.push(l);
    return true;
  };

  // Units and the empty clause never get watched; they are facts, not choices.
  const units: number[] = [];
  for (let ci = 0; ci < clauses.length; ci++) {
    const c = clauses[ci];
    if (c.length === 0) return null;
    if (c.length === 1) {
      units.push(c[0]);
      continue;
    }
    watches[slot(c[0])].push(ci);
    watches[slot(c[1])].push(ci);
  }

  const propagate = (): boolean => {
    while (qhead < trail.length) {
      const assigned = trail[qhead++];
      const falseLit = -assigned; // clauses watching this literal just lost it
      const ws = watches[slot(falseLit)];
      let keep = 0;
      for (let k = 0; k < ws.length; k++) {
        const ci = ws[k];
        const c = clauses[ci];
        // Normalise so the lost watch sits at c[1].
        if (c[0] === falseLit) {
          c[0] = c[1];
          c[1] = falseLit;
        }
        if (litValue(c[0]) === 1) {
          ws[keep++] = ci; // already satisfied by its other watch
          continue;
        }
        let found = -1;
        for (let t = 2; t < c.length; t++) {
          if (litValue(c[t]) !== -1) {
            found = t;
            break;
          }
        }
        if (found >= 0) {
          const swap = c[1];
          c[1] = c[found];
          c[found] = swap;
          watches[slot(c[1])].push(ci); // moved; drop from this list
          continue;
        }
        ws[keep++] = ci;
        if (!enqueue(c[0])) {
          for (let m = k + 1; m < ws.length; m++) ws[keep++] = ws[m];
          ws.length = keep;
          return false;
        }
      }
      ws.length = keep;
    }
    return true;
  };

  const cancelUntil = (len: number): void => {
    while (trail.length > len) {
      const l = trail.pop() as number;
      value[l > 0 ? l : -l] = 0;
    }
    qhead = trail.length;
  };

  for (const l of units) if (!enqueue(l)) return null;
  for (const l of assumptions) if (!enqueue(l)) return null;

  const decisions: number[] = [];
  const limits: number[] = [];
  const tried: boolean[] = [];
  let next = 1; // rotating scan pointer for the next unassigned variable

  for (;;) {
    if (!propagate()) {
      let recovered = false;
      while (decisions.length > 0) {
        const lvl = decisions.length - 1;
        cancelUntil(limits[lvl]);
        if (!tried[lvl]) {
          tried[lvl] = true;
          decisions[lvl] = -decisions[lvl];
          enqueue(decisions[lvl]);
          recovered = true;
          break;
        }
        decisions.pop();
        limits.pop();
        tried.pop();
      }
      if (!recovered) return null;
      next = 1;
      continue;
    }

    let v = 0;
    for (let i = next; i <= n; i++)
      if (value[i] === 0) {
        v = i;
        break;
      }
    if (v === 0)
      for (let i = 1; i < next && v === 0; i++)
        if (value[i] === 0) v = i;

    if (v === 0) {
      const model = new Array<boolean>(n + 1).fill(false);
      for (let i = 1; i <= n; i++) model[i] = value[i] === 1;
      return model;
    }

    next = v + 1;
    limits.push(trail.length);
    tried.push(false);
    decisions.push(v);
    enqueue(v);
  }
}
