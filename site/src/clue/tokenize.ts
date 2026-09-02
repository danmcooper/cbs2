export type ClueSegment =
  | { kind: 'text'; text: string }
  | { kind: 'name'; index: number; possessive: boolean }
  /** `counted` prefixes the profession's whole cast: "3 cooks" rather than "cooks". */
  | { kind: 'prof'; word: string; plural: boolean; counted: boolean }
  | { kind: 'column'; column: number }
  | { kind: 'between'; a: number; b: number };

const TOKEN = /#([A-Z]+)(?::(pair\(\d+,\d+\)|\w+))?/g;

function parseToken(tag: string, arg: string | undefined): ClueSegment | null {
  switch (tag) {
    case 'NAME':
    case 'NAMES': {
      if (arg === undefined || !/^\d+$/.test(arg)) return null;
      return { kind: 'name', index: Number(arg), possessive: tag === 'NAMES' };
    }
    // #PROFN is ours, not the source's: "Exactly 1 of #PROFN:cook has …" reads as
    // "Exactly 1 of 3 cooks has …". The count comes from the board, so only the
    // site can fill it in — see RenderOptions.professionTotals.
    case 'PROF':
    case 'PROFS':
    case 'PROFN': {
      if (arg === undefined || /^\d/.test(arg)) return null;
      return { kind: 'prof', word: arg, plural: tag !== 'PROF', counted: tag === 'PROFN' };
    }
    case 'C': {
      if (arg === undefined || !/^\d+$/.test(arg)) return null;
      return { kind: 'column', column: Number(arg) };
    }
    case 'BETWEEN': {
      const m = arg?.match(/^pair\((\d+),(\d+)\)$/);
      if (!m) return null;
      return { kind: 'between', a: Number(m[1]), b: Number(m[2]) };
    }
    default:
      return null;
  }
}

export function tokenizeClue(clue: string): ClueSegment[] {
  const segments: ClueSegment[] = [];
  let last = 0;
  for (const m of clue.matchAll(TOKEN)) {
    if (m.index > last) segments.push({ kind: 'text', text: clue.slice(last, m.index) });
    const parsed = parseToken(m[1], m[2]);
    segments.push(parsed ?? { kind: 'text', text: m[0] }); // unknown token: raw text fallback
    last = m.index + m[0].length;
  }
  if (last < clue.length) segments.push({ kind: 'text', text: clue.slice(last) });
  return segments;
}
