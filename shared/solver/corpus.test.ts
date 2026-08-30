import { describe, expect, it } from 'vitest';
import { parseHint } from './hint';
import { evaluate } from './predicates';
import { loadArchive } from './corpus';

const archive = loadArchive();

describe('archive', () => {
  it('loads every real puzzle', () => {
    expect(archive.length).toBeGreaterThanOrEqual(53);
    for (const { file, puzzle } of archive) {
      expect(puzzle.width, file).toBe(4);
      expect(puzzle.height, file).toBe(5);
    }
  });
});

describe('evaluator soundness', () => {
  it('every stored origHint is true of its own puzzle solution', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { file, puzzle, board } of archive) {
      puzzle.people.forEach((person, i) => {
        if (!person.origHint) return;
        checked++;
        if (!evaluate(board, parseHint(person.origHint))) {
          failures.push(`${file} people[${i}]: ${person.origHint}`);
        }
      });
    }
    expect(checked).toBeGreaterThan(600);
    expect(failures).toEqual([]);
  });
});
