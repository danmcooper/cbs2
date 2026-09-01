export interface Grid {
  width: number;
  height: number;
  size: number;
}

export function makeGrid(width: number, height: number): Grid {
  return { width, height, size: width * height };
}

export function rowOf(g: Grid, i: number): number {
  return Math.floor(i / g.width);
}

export function colOf(g: Grid, i: number): number {
  return i % g.width;
}

export function offsetIndex(g: Grid, i: number, dx: number, dy: number): number | null {
  const x = colOf(g, i) + dx;
  const y = rowOf(g, i) + dy;
  if (x < 0 || x >= g.width || y < 0 || y >= g.height) return null;
  return y * g.width + x;
}

export function neighbors(g: Grid, i: number): number[] {
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const j = offsetIndex(g, i, dx, dy);
      if (j !== null) out.push(j);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Inclusive line segment from a to b. Row-run when they share a row, column-run
 * stepping by width when they share a column, [] otherwise. */
export function segment(g: Grid, a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const step = rowOf(g, a) === rowOf(g, b) ? 1 : colOf(g, a) === colOf(g, b) ? g.width : 0;
  if (step === 0) return [];
  const out: number[] = [];
  for (let i = lo; i <= hi; i += step) out.push(i);
  return out;
}

/** n is 1-based. */
export function rowMembers(g: Grid, n: number): number[] {
  const start = (n - 1) * g.width;
  return Array.from({ length: g.width }, (_, k) => start + k);
}

/** n is 1-based. */
export function colMembers(g: Grid, n: number): number[] {
  return Array.from({ length: g.height }, (_, k) => k * g.width + (n - 1));
}

export function edgeMembers(g: Grid): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.size; i++) {
    const x = colOf(g, i);
    const y = rowOf(g, i);
    if (x === 0 || y === 0 || x === g.width - 1 || y === g.height - 1) out.push(i);
  }
  return out;
}

export function cornerMembers(g: Grid): number[] {
  return [0, g.width - 1, g.size - g.width, g.size - 1].sort((a, b) => a - b);
}

export function isConnected(g: Grid, members: number[]): boolean {
  if (members.length <= 1) return true;
  const set = new Set(members);
  const seen = new Set<number>([members[0]]);
  const queue = [members[0]];
  while (queue.length > 0) {
    const i = queue.pop() as number;
    for (const j of neighbors(g, i)) {
      if (set.has(j) && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen.size === set.size;
}
