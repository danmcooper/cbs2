import { describe, expect, it } from 'vitest';
import type { Person, Puzzle } from '../../../shared/puzzle';
import { isDeducible } from './deduce';

const person = (overrides: Partial<Person>): Person => ({
  name: 'X',
  profession: 'cook',
  gender: 'male',
  criminal: false,
  clue: null,
  origHint: null,
  paths: [],
  ...overrides,
});

/**
 * A 2x2 board whose card 3 is innocent, announced outright by two different
 * cards. Card 3's stored `paths` records only the route through card 2, so
 * flipping card 1 is a route the generator never wrote down.
 */
const puzzle = (paths: number[][] | null): Puzzle => ({
  formatVersion: 1,
  id: '0123456789ab',
  date: '2026-01-01',
  title: 'T',
  difficulty: 'Easy',
  width: 2,
  height: 2,
  initialReveals: [0],
  source: 'generated',
  variant: 'dan',
  people: [
    person({ criminal: true, paths: [] }),
    person({ origHint: 'has_trait(3,innocent)', clue: 'c', paths: [[0]] }),
    person({ origHint: 'has_trait(3,innocent)', clue: 'c', paths: [[0]] }),
    person({ paths }),
  ],
});

describe('isDeducible', () => {
  it('accepts a card whose stored path is fully flipped', () => {
    expect(isDeducible(puzzle([[2]]), [0, 2], 3)).toBe(true);
  });

  it('accepts any card when paths are absent', () => {
    expect(isDeducible(puzzle(null), [0], 3)).toBe(true);
  });

  it('rejects a card that no flipped clue forces', () => {
    expect(isDeducible(puzzle([[2]]), [0], 3)).toBe(false);
  });

  // The generator samples a few minimal paths per card rather than enumerating
  // every one, so a player who deduces a card by a route it never recorded had
  // their correct answer counted as a mistake.
  it('accepts a route the stored paths never recorded', () => {
    expect(isDeducible(puzzle([[2]]), [0, 1], 3)).toBe(true);
  });

  it('still rejects an unforced card when the stored paths are empty', () => {
    expect(isDeducible(puzzle([]), [0], 3)).toBe(false);
  });
});
