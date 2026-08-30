import { describe, expect, it } from 'vitest';
import { parseHint } from './hint';
import { evaluate } from './predicates';
import { loadArchive, isSelfReferential } from './corpus';
import { canRender, render } from './render';
import type { Shape } from './enumerate';
import { forcedGiven, isUniquelySolvable, parseClues } from './solve';
import { makeGrid } from './grid';

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

describe('renderer fidelity', () => {
  it('reproduces at least 95% of non-self-referential archive clues exactly', () => {
    const mismatches: string[] = [];
    let comparable = 0;
    let selfReferential = 0;
    let unsupported = 0;

    for (const { file, puzzle } of archive) {
      puzzle.people.forEach((person, i) => {
        if (!person.origHint || !person.clue) return;
        if (isSelfReferential(puzzle, i)) {
          selfReferential++;
          return;
        }
        const hint = parseHint(person.origHint);
        if (!canRender(hint)) {
          unsupported++;
          return;
        }
        comparable++;
        const got = render(hint);
        if (got !== person.clue) {
          mismatches.push(`${file} [${i}] ${person.origHint}\n  want: ${person.clue}\n  got:  ${got}`);
        }
      });
    }

    const ratio = (comparable - mismatches.length) / comparable;
    console.log(
      `fidelity ${(ratio * 100).toFixed(1)}% of ${comparable} comparable ` +
        `(${selfReferential} self-referential, ${unsupported} unsupported shapes)`,
    );
    expect(ratio).toBeGreaterThanOrEqual(0.95);
    expect(mismatches.sort()).toMatchSnapshot();
  });
});

function shapeOf(puzzle: (typeof archive)[number]['puzzle']): Shape {
  return {
    grid: makeGrid(puzzle.width, puzzle.height),
    professions: puzzle.people.map((p) => p.profession),
  };
}

describe('solver agreement', () => {
  it('every archived puzzle is uniquely solvable under its full clue set', { timeout: 600_000 }, () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { file, puzzle } of archive) {
      const clues = parseClues(puzzle.people.map((p) => p.origHint));
      const truth = puzzle.people.map((p) => p.criminal);
      checked++;
      if (!isUniquelySolvable(shapeOf(puzzle), clues, truth, puzzle.initialReveals)) {
        failures.push(file);
      }
    }
    console.log(`puzzles checked: ${checked}`);
    expect(checked).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });

  it('every stored path is genuinely sufficient', { timeout: 600_000 }, () => {
    const failures: string[] = [];
    let pathsChecked = 0;
    for (const { file, puzzle } of archive) {
      const shape = shapeOf(puzzle);
      const clues = parseClues(puzzle.people.map((p) => p.origHint));
      const truth = puzzle.people.map((p) => p.criminal);
      puzzle.people.forEach((person, i) => {
        if (person.paths === null) return;
        for (const path of person.paths) {
          if (path.includes(i)) continue; // trivially known once flipped
          pathsChecked++;
          if (forcedGiven(shape, clues, truth, path)[i] === null) {
            failures.push(`${file} [${i}] path ${path.join(',')}`);
          }
        }
      });
    }
    console.log(`paths checked: ${pathsChecked}`);
    expect(pathsChecked).toBeGreaterThan(1000);
    expect(failures).toEqual([]);
  });
});
