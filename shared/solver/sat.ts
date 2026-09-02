/**
 * A CDCL SAT solver, enough to answer the two questions the puzzle solver
 * actually asks: is this clue set satisfiable, and is a given card's trait the
 * same in every assignment that satisfies it.
 *
 * `enumerate.ts` answers both by materialising all 2^(width*height) assignments,
 * which is why the shipped board is 4x5: a 5x6 board is 2^30 assignments, a 4.3
 * GB allocation, and roughly 1024x the work per call. Search costs what the
 * clauses cost instead of what the board costs, so board size stops being the
 * thing that decides feasibility.
 *
 * This started as plain DPLL — unit propagation over two watched literals,
 * chronological backtracking, no learning — on the reasoning that instances of
 * tens of primary variables plus a few hundred from the cardinality encodings
 * were too small to repay the machinery. Generating boards up to 7x7 disproved
 * that. The costs did not grow, they scattered: two 6x7 boards a day apart came
 * in at 29 seconds and over 26 minutes. The expensive half of the work is
 * proving *un*satisfiability — `forcedGivenSat` asks "can this card flip?" and a
 * pinned card is a refutation — and refutation is exactly what chronological
 * backtracking is worst at, because it rediscovers the same conflict down every
 * branch that shares its cause.
 *
 * So: first-UIP clause learning with non-chronological backjumping, an activity
 * heuristic over the variables, saved phases, Luby restarts, and a periodic cull
 * of the learnt clauses that have stopped earning their keep. `enumerate.ts`
 * stays the reference implementation, and `sat.differential.test.ts` holds the
 * two engines to the same answers.
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

/** Restart spacing: 1 1 2 1 1 2 4 1 ..., in units of `RESTART_BASE` conflicts. */
function luby(i: number): number {
  let size = 1;
  let seq = 0;
  while (size < i + 1) {
    seq++;
    size = 2 * size + 1;
  }
  while (size - 1 !== i) {
    size = (size - 1) >> 1;
    seq--;
    i %= size;
  }
  return 1 << seq;
}

const RESTART_BASE = 100;

/**
 * A satisfying assignment indexed by variable (element 0 unused), or null if
 * none exists. `assumptions` are literals forced for this call only; they are
 * never added to the clause set, so the same `Cnf` can be re-solved under
 * contradictory assumptions.
 *
 * Note: this reorders literals *within* clauses to maintain the watched-literal
 * invariant. That is semantically invisible — a clause is a set — but it does
 * mean the arrays handed to `add` are not preserved verbatim. What it does not
 * do is change which clauses the `Cnf` holds: everything learnt here lives in a
 * local database and dies with the call.
 */
export function solve(cnf: Cnf, assumptions: number[] = []): boolean[] | null {
  const n = cnf.nVars;

  /**
   * Given clauses first, then learnt ones. The outer array is a copy so that
   * learning cannot be seen by the caller — `isUniquelySolvableSat` adds a
   * clause of its own to the same `Cnf` and re-solves it, and would otherwise
   * inherit a few hundred thousand of ours. The inner arrays are shared, which
   * is what the note above is about.
   */
  const db: number[][] = cnf.clauses.slice();
  const given = db.length;

  // Literal -> watch-list slot. Positive v at 2v, negative v at 2v+1.
  const slot = (l: number) => (l > 0 ? 2 * l : 2 * -l + 1);
  const varOf = (l: number) => (l > 0 ? l : -l);

  const watches: number[][] = Array.from({ length: 2 * (n + 1) }, () => []);
  /**
   * How much of each watch list is live. The lists themselves never shrink.
   *
   * `propagate` rebuilds a list in place as it walks it, and the obvious way to
   * finish that is `ws.length = keep`. That assignment was the single hottest
   * store in the solver and it is not a store at all: `length` is an accessor on
   * JSArray, so V8 routes it through `Runtime_StoreCallbackProperty` and
   * `Accessors::ArrayLengthSetter` every time. Profiling a 6x7 board found the
   * run buried in exactly that path, for about a quarter of its wall clock.
   * Keeping the length beside the list, in an Int32Array, makes the same
   * bookkeeping a plain indexed store. Anything at or past `wlen[s]` is stale
   * and never read.
   */
  const wlen = new Int32Array(2 * (n + 1));

  const watch = (s: number, ci: number): void => {
    watches[s][wlen[s]++] = ci;
  };

  const attach = (ci: number): void => {
    const c = db[ci];
    watch(slot(c[0]), ci);
    watch(slot(c[1]), ci);
  };

  const value = new Int8Array(n + 1); // 0 unknown, 1 true, -1 false
  const level = new Int32Array(n + 1);
  const reason = new Int32Array(n + 1).fill(-1); // clause that forced it, or -1
  /**
   * The value each variable last held before being unassigned. Re-deciding a
   * variable the way it went last time keeps the solver near the region it was
   * already working in, which matters most right after a restart.
   */
  const phase = new Int8Array(n + 1);

  const trail: number[] = [];
  const limits: number[] = []; // trail length at the start of each decision level
  let qhead = 0;

  const litValue = (l: number): number => (l > 0 ? value[l] : -value[-l]);

  const enqueue = (l: number, from: number): void => {
    const v = varOf(l);
    value[v] = l > 0 ? 1 : -1;
    level[v] = limits.length;
    reason[v] = from;
    trail.push(l);
  };

  // --- variable order ------------------------------------------------------
  // A binary max-heap on activity. The predecessor scanned 1..n for the first
  // unassigned variable, which both picked badly and cost a fifth of the run
  // once the decision count got into the millions.
  const activity = new Float64Array(n + 1);
  let bump = 1;
  const heap: number[] = [];
  const pos = new Int32Array(n + 1).fill(-1);

  const hotter = (a: number, b: number) => activity[a] > activity[b];

  const siftUp = (i: number): void => {
    const v = heap[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!hotter(v, heap[p])) break;
      heap[i] = heap[p];
      pos[heap[i]] = i;
      i = p;
    }
    heap[i] = v;
    pos[v] = i;
  };

  const siftDown = (i: number): void => {
    const v = heap[i];
    for (;;) {
      let c = 2 * i + 1;
      if (c >= heap.length) break;
      if (c + 1 < heap.length && hotter(heap[c + 1], heap[c])) c++;
      if (!hotter(heap[c], v)) break;
      heap[i] = heap[c];
      pos[heap[i]] = i;
      i = c;
    }
    heap[i] = v;
    pos[v] = i;
  };

  const heapPush = (v: number): void => {
    if (pos[v] >= 0) return;
    heap.push(v);
    pos[v] = heap.length - 1;
    siftUp(heap.length - 1);
  };

  const heapPop = (): number => {
    const top = heap[0];
    const last = heap.pop() as number;
    pos[top] = -1;
    if (heap.length > 0) {
      heap[0] = last;
      pos[last] = 0;
      siftDown(0);
    }
    return top;
  };

  const bumpVar = (v: number): void => {
    activity[v] += bump;
    if (activity[v] > 1e100) {
      // Rescale rather than let the increment lose its resolution.
      for (let i = 1; i <= n; i++) activity[i] *= 1e-100;
      bump *= 1e-100;
    }
    if (pos[v] >= 0) siftUp(pos[v]);
  };

  for (let v = 1; v <= n; v++) heapPush(v);

  // --- propagation ---------------------------------------------------------
  /** Index of a clause falsified by the current assignment, or -1. */
  const propagate = (): number => {
    while (qhead < trail.length) {
      const assigned = trail[qhead++];
      const falseLit = -assigned; // clauses watching this literal just lost it
      const s = slot(falseLit);
      const ws = watches[s];
      // Safe to fix the bound: `falseLit` is false and every literal moved onto
      // a new watch below is not, so nothing lands back in this list mid-walk.
      const live = wlen[s];
      let keep = 0;
      for (let k = 0; k < live; k++) {
        const ci = ws[k];
        const c = db[ci];
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
          watch(slot(c[1]), ci); // moved; drop from this list
          continue;
        }
        ws[keep++] = ci;
        if (litValue(c[0]) === -1) {
          for (let m = k + 1; m < live; m++) ws[keep++] = ws[m];
          wlen[s] = keep;
          qhead = trail.length; // nothing after a conflict is worth propagating
          return ci;
        }
        // The clause is down to its last unfalsified literal, so it is forced.
        // c[0] stays put while it is a reason: a satisfied watch is never the
        // one swapped away above, which is what lets `analyze` trust index 0.
        enqueue(c[0], ci);
      }
      wlen[s] = keep;
    }
    return -1;
  };

  const cancelUntil = (lvl: number): void => {
    if (limits.length <= lvl) return;
    const from = limits[lvl];
    while (trail.length > from) {
      const l = trail.pop() as number;
      const v = varOf(l);
      phase[v] = value[v];
      value[v] = 0;
      reason[v] = -1;
      heapPush(v);
    }
    while (limits.length > lvl) limits.pop();
    qhead = from;
  };

  // --- conflict analysis ---------------------------------------------------
  const seen = new Uint8Array(n + 1);

  /**
   * The first-UIP clause for `confl`: a clause implied by the formula that the
   * current assignment falsifies, with the literal to assert at index 0 and the
   * deepest of the rest at index 1. Empty if the conflict does not depend on any
   * decision, which means the formula is unsatisfiable outright.
   */
  const analyze = (confl: number): number[] => {
    const learnt: number[] = [0]; // index 0 is filled in at the end
    const depth = limits.length;
    let counter = 0; // literals of the conflict still open at the current level
    let p = 0;
    let idx = trail.length - 1;
    let ci = confl;

    for (;;) {
      const c = db[ci];
      // On the reason clauses, index 0 is the literal we just resolved away.
      for (let j = p === 0 ? 0 : 1; j < c.length; j++) {
        const q = c[j];
        const v = varOf(q);
        if (seen[v] === 1 || level[v] === 0) continue;
        seen[v] = 1;
        bumpVar(v);
        if (level[v] >= depth) counter++;
        else learnt.push(q);
      }
      while (idx >= 0 && seen[varOf(trail[idx])] === 0) idx--;
      if (idx < 0) {
        for (const q of learnt) seen[varOf(q)] = 0;
        seen[0] = 0;
        return [];
      }
      p = trail[idx];
      idx--;
      const pv = varOf(p);
      seen[pv] = 0;
      counter--;
      if (counter <= 0) break;
      ci = reason[pv];
    }

    learnt[0] = -p;
    for (const q of learnt) seen[varOf(q)] = 0;
    return learnt;
  };

  /** Level to jump back to, after moving the deepest non-asserting literal to index 1. */
  const backjumpLevel = (learnt: number[]): number => {
    if (learnt.length === 1) return 0;
    let deepest = 1;
    for (let i = 2; i < learnt.length; i++) {
      if (level[varOf(learnt[i])] > level[varOf(learnt[deepest])]) deepest = i;
    }
    const swap = learnt[1];
    learnt[1] = learnt[deepest];
    learnt[deepest] = swap;
    return level[varOf(learnt[1])];
  };

  // --- learnt clause database ----------------------------------------------
  /**
   * Literal block distance: how many decision levels a clause spans. The
   * standard proxy for how useful a learnt clause will be — a clause tying
   * together few levels propagates often, one tying together many rarely does.
   */
  const lbds: number[] = [];
  const lbdStamp = new Int32Array(n + 2);
  let lbdGen = 0;

  const lbdOf = (c: number[]): number => {
    lbdGen++;
    let k = 0;
    for (const q of c) {
      const lv = level[varOf(q)];
      if (lbdStamp[lv] !== lbdGen) {
        lbdStamp[lv] = lbdGen;
        k++;
      }
    }
    return k;
  };

  let maxLearnt = Math.max(1000, given >> 1);

  /**
   * Drops the least useful half of the learnt clauses. Only ever called with the
   * trail back at level 0, which is what makes renumbering safe: no clause is
   * anyone's reason there, since `analyze` never reads the reason of a level-0
   * variable.
   */
  const reduce = (): void => {
    const count = db.length - given;
    if (count <= maxLearnt) return;

    const order = Array.from({ length: count }, (_, i) => i);
    order.sort((a, b) => lbds[a] - lbds[b]);
    const keep = new Uint8Array(count);
    for (let i = 0; i < count >> 1; i++) keep[order[i]] = 1;
    for (let i = 0; i < count; i++) if (lbds[i] <= 2) keep[i] = 1; // glue clauses stay

    const clauses: number[][] = [];
    const scores: number[] = [];
    for (let i = 0; i < count; i++) {
      if (!keep[i]) continue;
      clauses.push(db[given + i]);
      scores.push(lbds[i]);
    }

    while (db.length > given) db.pop();
    lbds.length = 0;
    for (let i = 0; i < clauses.length; i++) {
      db.push(clauses[i]);
      lbds.push(scores[i]);
    }

    wlen.fill(0);
    for (let ci = 0; ci < db.length; ci++) if (db[ci].length >= 2) attach(ci);
    // Rebuilt watches can sit on literals that are already false at level 0, so
    // replay the trail rather than trust the lists to be in a settled state.
    qhead = 0;

    maxLearnt = Math.floor(maxLearnt * 1.3);
  };

  // --- setup ---------------------------------------------------------------
  for (let ci = 0; ci < given; ci++) {
    const c = db[ci];
    if (c.length === 0) return null;
    if (c.length >= 2) attach(ci);
  }
  // Units and assumptions are facts, not choices: they go straight in at level 0.
  for (let ci = 0; ci < given; ci++) {
    const c = db[ci];
    if (c.length !== 1) continue;
    if (litValue(c[0]) === -1) return null;
    if (litValue(c[0]) === 0) enqueue(c[0], -1);
  }
  for (const l of assumptions) {
    if (litValue(l) === -1) return null;
    if (litValue(l) === 0) enqueue(l, -1);
  }

  // --- search --------------------------------------------------------------
  let conflicts = 0;
  let restarts = 0;
  let restartAt = RESTART_BASE * luby(0);

  for (;;) {
    const confl = propagate();

    if (confl >= 0) {
      conflicts++;
      if (limits.length === 0) return null; // conflict with no decision to undo

      const learnt = analyze(confl);
      if (learnt.length === 0) return null;

      const back = backjumpLevel(learnt);
      cancelUntil(back);

      if (learnt.length === 1) {
        enqueue(learnt[0], -1);
      } else {
        const ci = db.length;
        db.push(learnt);
        lbds.push(lbdOf(learnt));
        attach(ci);
        enqueue(learnt[0], ci);
      }

      bump /= 0.95; // decay: later conflicts weigh more than earlier ones
      continue;
    }

    if (conflicts >= restartAt) {
      cancelUntil(0);
      restarts++;
      restartAt = conflicts + RESTART_BASE * luby(restarts);
      reduce();
      continue;
    }

    let v = 0;
    while (heap.length > 0) {
      const cand = heapPop();
      if (value[cand] === 0) {
        v = cand;
        break;
      }
    }

    if (v === 0) {
      const model = new Array<boolean>(n + 1).fill(false);
      for (let i = 1; i <= n; i++) model[i] = value[i] === 1;
      return model;
    }

    limits.push(trail.length);
    enqueue(phase[v] === 1 ? v : -v, -1);
  }
}
