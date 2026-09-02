import type { Person } from '../../../shared/puzzle';
import { tokenizeClue, type ClueSegment } from './tokenize';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const columnLetter = (n: number) => String.fromCharCode(65 + n);

// "A1", "D5", … matching the corner labels on the cards.
export const gridLabel = (index: number, width: number) =>
  `${columnLetter(index % width)}${Math.floor(index / width) + 1}`;

interface ClueTextProps {
  clue: string;
  people: Person[];
  width: number;
  /** Index of the card this clue belongs to; its own references render as I/me/my. */
  selfIndex?: number;
}

// String-level rewrites the real renderer applies before token expansion:
// self-references get first-person grammar, "exactly 0" reads as "no".
function prepass(clue: string, self: number | undefined): string {
  let s = clue.replace(' exactly 0 ', ' no ');
  if (self === undefined) return s;
  s = s.replace(new RegExp(`#NAMES:${self}\\b`, 'g'), 'my');
  s = s.replace(/#NAME:(\d+) and #NAME:(\d+)\b/g, (m, x: string, y: string) => {
    if (Number(x) === self) return `#NAME:${y} and I`;
    if (Number(y) === self) return `#NAME:${x} and I`;
    return m;
  });
  s = s.replace(new RegExp(`^#NAME:${self} (is|has)\\b`), (_m, verb: string) =>
    verb === 'is' ? 'I am' : 'I have',
  );
  s = s.replace(new RegExp(`^#NAME:${self}\\b`), 'I');
  s = s.replace(new RegExp(`#NAME:${self}\\b`, 'g'), 'me');
  return s;
}

function nameRef(props: ClueTextProps, index: number): string {
  if (index === props.selfIndex) return 'me';
  return capitalize(props.people[index].name);
}

// Positional paraphrase of an inclusive card range, ported from the live
// bundle: describe the segment by row/column or by the cards just outside it.
// `refs` lists the boundary cards named in the phrase (self excluded).
function betweenParts(
  seg: { a: number; b: number },
  props: ClueTextProps,
): { text: string; refs: number[] } | null {
  const { people, width } = props;
  const height = people.length / width;
  const lo = Math.min(seg.a, seg.b);
  const hi = Math.max(seg.a, seg.b);
  if (hi >= people.length) return null;
  const loCol = lo % width;
  const loRow = Math.floor(lo / width);
  const hiCol = hi % width;
  const hiRow = Math.floor(hi / width);
  const sameRow = loRow === hiRow;
  const before = lo - (sameRow ? 1 : width);
  const after = hi + (sameRow ? 1 : width);
  const refs = (...indices: number[]) => indices.filter((i) => i !== props.selfIndex);
  if (sameRow) {
    if (loCol === 0 && hiCol === width - 1) return { text: `in row ${loRow + 1}`, refs: [] };
    if (loCol === 0) return { text: `to the left of ${nameRef(props, after)}`, refs: refs(after) };
    if (hiCol === width - 1) {
      return { text: `to the right of ${nameRef(props, before)}`, refs: refs(before) };
    }
  } else {
    if (loRow === 0 && hiRow === height - 1) {
      return { text: `in column ${columnLetter(loCol)}`, refs: [] };
    }
    if (loRow === 0) return { text: `above ${nameRef(props, after)}`, refs: refs(after) };
    if (hiRow === height - 1) return { text: `below ${nameRef(props, before)}`, refs: refs(before) };
  }
  if (props.selfIndex === before) {
    return { text: `in between ${nameRef(props, after)} and me`, refs: refs(after) };
  }
  if (props.selfIndex === after) {
    return { text: `in between ${nameRef(props, before)} and me`, refs: refs(before) };
  }
  return {
    text: `in between ${nameRef(props, before)} and ${nameRef(props, after)}`,
    refs: refs(before, after),
  };
}

/** Cards a clue mentions (by name, boundary phrase, or profession), excluding the clue's own card. */
export function clueReferencedIndices(
  clue: string,
  people: Person[],
  width: number,
  selfIndex: number,
): { names: number[]; profs: number[] } {
  const names = new Set<number>();
  const profs = new Set<number>();
  for (const seg of tokenizeClue(clue)) {
    if (seg.kind === 'name') {
      if (seg.index !== selfIndex && people[seg.index]) names.add(seg.index);
    } else if (seg.kind === 'prof') {
      people.forEach((p, i) => {
        if (p.profession === seg.word) profs.add(i);
      });
    } else if (seg.kind === 'between') {
      betweenParts(seg, { clue, people, width, selfIndex })?.refs.forEach((i) => names.add(i));
    }
  }
  return { names: [...names].sort((a, b) => a - b), profs: [...profs].sort((a, b) => a - b) };
}

function rawToken(seg: ClueSegment): string {
  // Reconstruct the original token for out-of-range references.
  switch (seg.kind) {
    case 'name':
      return `#${seg.possessive ? 'NAMES' : 'NAME'}:${seg.index}`;
    case 'between':
      return `#BETWEEN:pair(${seg.a},${seg.b})`;
    case 'column':
      return `#C:${seg.column}`;
    default:
      return '';
  }
}

function segmentText(seg: ClueSegment, props: ClueTextProps): string {
  switch (seg.kind) {
    case 'name': {
      const p = props.people[seg.index];
      if (!p) return rawToken(seg);
      const name = capitalize(p.name);
      return seg.possessive ? (name.endsWith('s') ? `${name}'` : `${name}'s`) : name;
    }
    case 'prof': {
      // A counted profession takes its number from the board, and its plural from
      // that number rather than from the token — a cast of one reads "1 cook".
      const n = seg.counted
        ? props.people.filter((p) => p.profession === seg.word).length
        : null;
      const plural = n === null ? seg.plural : n !== 1;
      const word = plural ? (seg.word === 'witch' ? 'witches' : `${seg.word}s`) : seg.word;
      return n === null ? word : `${n} ${word}`;
    }
    case 'column':
      // #C:n is 1-based ("column #C:1" is column A); the word "column" is in the source text.
      return seg.column >= 1 ? columnLetter(seg.column - 1) : rawToken(seg);
    case 'between':
      return betweenParts(seg, props)?.text ?? rawToken(seg);
    case 'text':
      return seg.text;
  }
}

export default function ClueText(props: ClueTextProps) {
  const segments = tokenizeClue(prepass(props.clue, props.selfIndex));
  // The real renderer capitalizes the first letter of the finished clue.
  const text = capitalize(segments.map((seg) => segmentText(seg, props)).join(''));
  return <span className="clue-text">{text}</span>;
}
