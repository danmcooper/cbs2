import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePuzzle } from '../puzzle';
import { type LabelBand, classify, loadBands } from './difficulty';
import { edgeMembers, makeGrid } from './grid';
import { formatHint, parseHint } from './hint';
import { hintFeatures, makeBoard, unitMembers } from './predicates';
import { render } from './render';
import { forcedGiven, isUniquelySolvable, parseClues, solveChain } from './solve';
import { candidateHints } from './candidates';
import { type ClueMix, archiveClueMix } from './corpus';
import {
  GenerationError,
  castOf,
  generatePuzzle,
  makeRng,
  orderPool,
  pickCriminals,
  professionShapesFor,
  shuffled,
} from './generate';
import { faceOf } from './vocab';

// Wide bands: this test proves the machinery works, not that it hits a target.
const band: LabelBand = {
  samples: 10,
  criminals: { min: 4, max: 7 },
  clueCards: { min: 4, max: 16 },
  chainLength: { min: 2, max: 19 },
  meanRevealsPerStep: { min: 1, max: 8 },
  meanPathSize: { min: 1, max: 12 },
  abstractShare: { min: 0, max: 1 },
};

// Generation draws clues in the archive's proportions, so every call needs it.
const mix = archiveClueMix();

/**
 * Generating a puzzle here uses a 4x4 board rather than the shipped 4x5.
 *
 * Solving enumerates every assignment of criminals to cards, so the cost is
 * 2^(width*height): dropping one row is sixteen times cheaper, which is the
 * difference between this file running in the ordinary suite and needing a
 * separate slow one. Nothing under test is 4x5-specific — rows of four, both
 * diagonals, corners, edges and every unit kind behave the same — and the one
 * check that the shipped size still generates soundly lives in
 * `npm run test:generate`.
 */
const BOARD = { width: 4, height: 4 };

/** An archive profession shape shrunk to `size` cards, smallest groups last.
 * Shaving the largest group repeatedly keeps the raggedness and the group count
 * that `castOf` exists to reproduce, rather than inventing a tidy shape. */
function trimShape(shape: readonly number[], size: number): number[] {
  const out = [...shape];
  while (out.reduce((a, b) => a + b, 0) > size) {
    out.sort((a, b) => b - a);
    if (out[0] === 1) out.pop();
    else out[0]--;
  }
  return out.sort((a, b) => b - a);
}

const boardMix: ClueMix = {
  ...mix,
  professionShapes: mix.professionShapes.map((s) => trimShape(s, BOARD.width * BOARD.height)),
};

describe('castOf', () => {
  // The archive names its cast in alphabetical reading order, one distinct
  // initial per card, so a clue that names someone can be found on the board
  // from its first letter instead of by scanning all twenty cards.
  it('names the cast in alphabetical order with one distinct initial each', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const cast = castOf(makeRng(seed), mix.professionShapes);
      expect(cast.names.length, `seed ${seed}`).toBe(20);
      expect(cast.names, `seed ${seed}`).toEqual([...cast.names].sort());
      const initials = cast.names.map((n) => n[0]);
      expect(new Set(initials).size, `seed ${seed}`).toBe(initials.length);
    }
  });

  it('varies the cast between seeds', () => {
    const a = castOf(makeRng(1), mix.professionShapes).names.join(',');
    const b = castOf(makeRng(2), mix.professionShapes).names.join(',');
    expect(a).not.toBe(b);
  });

  it('gives the cast one of the archive\'s ragged profession shapes', () => {
    // Not five professions of four apiece, which is what an `i % 5` fill gives
    // and what no real puzzle has ever looked like.
    const known = new Set(mix.professionShapes.map((s) => s.join(',')));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const cast = castOf(makeRng(seed), mix.professionShapes);
      const counts = new Map<string, number>();
      for (const p of cast.professions) counts.set(p, (counts.get(p) ?? 0) + 1);
      const shape = [...counts.values()].sort((a, b) => b - a).join(',');
      expect(known.has(shape), `seed ${seed}: ${shape}`).toBe(true);
      seen.add(shape);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('refuses a profession shape that does not cover the board', () => {
    // A shape is dealt out slot by slot, so one that comes up short would leave
    // cards with no profession at all — caught here rather than at validation.
    expect(() => castOf(makeRng(1), [[2]])).toThrow(GenerationError);
  });

  it('keeps each card\'s face agreeing with its own gender and profession', () => {
    const cast = castOf(makeRng(9), mix.professionShapes);
    for (let i = 0; i < cast.names.length; i++) {
      expect(cast.faces[i], cast.names[i]).toBe(faceOf(cast.professions[i], cast.genders[i]));
    }
  });

  // A 5x6 board wants thirty cards, and there are only twenty-six letters. The
  // one-initial-per-card rule cannot survive that, so it degrades rather than
  // breaks: still sorted, still every name distinct, still as few letters shared
  // as the alphabet allows.
  it('fills a thirty-card board, reusing initials only where it must', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const cast = castOf(makeRng(seed), professionShapesFor(mix.professionShapes, 30), 30);
      expect(cast.names.length, `seed ${seed}`).toBe(30);
      expect(cast.genders.length).toBe(30);
      expect(cast.professions.length).toBe(30);
      expect(cast.faces.length).toBe(30);
      expect(cast.names, `seed ${seed}`).toEqual([...cast.names].sort());
      expect(new Set(cast.names).size, `seed ${seed}`).toBe(30);
      // Thirty names over twenty-six letters shares four of them, and no more.
      expect(new Set(cast.names.map((n) => n[0])).size, `seed ${seed}`).toBe(26);
      for (let i = 0; i < 30; i++) {
        expect(cast.faces[i], cast.names[i]).toBe(faceOf(cast.professions[i], cast.genders[i]));
      }
    }
  });
});

describe('professionShapesFor', () => {
  it('passes the archive\'s own shapes through at the size they were measured', () => {
    const got = professionShapesFor(mix.professionShapes, 20);
    expect(got).toEqual(mix.professionShapes);
  });

  it('builds shapes covering a board the archive has none for', () => {
    const got = professionShapesFor(mix.professionShapes, 30);
    expect(got.length).toBeGreaterThan(10);
    for (const s of got) {
      expect(s.reduce((a, b) => a + b, 0), s.join(',')).toBe(30);
      expect(s.length).toBeLessThanOrEqual(16); // no more professions than exist
      expect(Math.min(...s)).toBeGreaterThan(0);
    }
  });

  it('keeps the archive\'s taste for small ragged groups', () => {
    // Real casts run groups of mostly two and three, which is what makes a
    // `#PROFS:` unit worth naming. Five groups of six would be a different game,
    // and so would fifteen groups of one — a "profession group" of one person is
    // just a card with a longer name, and a clue about it says nothing a clue
    // naming the card would not. Covering the ten extra cards by adding singleton
    // groups satisfies both "small" and "ragged" while doing exactly that, so
    // the archive's own two statistics are what this holds the refit to.
    const got = professionShapesFor(mix.professionShapes, 30);
    const sizes = got.flat();
    const archive = mix.professionShapes.flat();
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const singletons = (xs: number[]) => xs.filter((n) => n === 1).length / xs.length;

    expect(sizes.filter((n) => n <= 3).length / sizes.length).toBeGreaterThan(0.6);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(Math.max(...archive));
    expect(mean(sizes)).toBeGreaterThan(mean(archive) - 0.3);
    expect(singletons(sizes)).toBeLessThan(singletons(archive) + 0.05);
  });

  it('drops a shape naming more professions than the vocabulary has', () => {
    // `castOf` deals one profession per group, so a shape with more groups than
    // there are professions cannot be dealt. Passing it through would leave that
    // rejection to `castOf`, which can only throw.
    const tooMany = Array.from({ length: 20 }, () => 1);
    const usable = [3, 3, 3, 3, 2, 2, 2, 2];
    expect(professionShapesFor([tooMany, usable], 20)).toEqual([usable]);
  });

  it('covers a board smaller than the archive\'s too', () => {
    // The cheap 4x4 board the rest of this file generates on needs this as much
    // as a 5x6 does: twenty-card shapes do not deal out onto sixteen cards.
    const got = professionShapesFor(mix.professionShapes, 16);
    expect(got.length).toBeGreaterThan(10);
    for (const s of got) {
      expect(s.reduce((a, b) => a + b, 0), s.join(',')).toBe(16);
      expect(s.length).toBeLessThanOrEqual(16);
      expect(Math.min(...s)).toBeGreaterThan(0);
    }
    // Shrinking must not tidy the cast into a few big groups.
    expect(Math.max(...got.flat())).toBeLessThanOrEqual(Math.max(...mix.professionShapes.flat()));
  });
});

describe('pickCriminals', () => {
  // 70% of a 4x5 board is edge, so a uniform draw puts 70% of the criminals
  // there. The archive puts 65.8% (331 of 503, t = -2.30 against 70% over the 54
  // puzzles): a real if modest pull inward. It shows in play — a criminal in the
  // interior touches eight cards, so the neighbour clues that name it have more
  // to bite on than the same clue about a corner with three.
  it('leans criminals inward at the archive\'s rate', () => {
    const grid = makeGrid(4, 5);
    const edge = new Set(edgeMembers(grid));
    const rng = makeRng(11);
    let on = 0;
    let total = 0;
    for (let trial = 0; trial < 2000; trial++) {
      const picked = pickCriminals(rng, grid, 9);
      expect(new Set(picked).size).toBe(9);
      for (const i of picked) {
        total++;
        if (edge.has(i)) on++;
      }
    }
    // Wide enough to be about the lean rather than the third decimal place, tight
    // enough to fail on the uniform 0.70 this replaced.
    expect(on / total).toBeGreaterThan(0.63);
    expect(on / total).toBeLessThan(0.685);
  });

  it('still reaches every card, and hands back the whole board when asked for it', () => {
    // A weighted draw that never picks some corner would be a worse bug than the
    // bias it fixes, and the count is what the band asked for, not a suggestion.
    const grid = makeGrid(4, 5);
    const rng = makeRng(3);
    const seen = new Set<number>();
    for (let trial = 0; trial < 200; trial++) for (const i of pickCriminals(rng, grid, 5)) seen.add(i);
    expect(seen.size).toBe(20);
    expect(pickCriminals(rng, grid, 20).sort((a, b) => a - b)).toEqual([...Array(20).keys()]);
  });
});

describe('orderPool', () => {
  const poolBoard = makeBoard(
    makeGrid(4, 5),
    Array.from({ length: 20 }, (_, i) => ['cook', 'cop', 'pilot', 'painter', 'sleuth'][i % 5]),
    Array.from({ length: 20 }, (_, i) => [0, 3, 6, 9, 13, 19].includes(i)),
  );
  const pool = candidateHints(poolBoard);
  // buildChain walks the pool in order and takes the first candidate that makes
  // progress, so what the ordering puts near the front is what a puzzle ends up
  // made of. Measure the head of the ordering, not the whole thing.
  const HEAD = 400;
  const sharesOf = (hints: typeof pool) => {
    const pred = new Map<string, number>();
    const feature = new Map<string, number>();
    for (const h of hints) {
      pred.set(h.pred, (pred.get(h.pred) ?? 0) + 1);
      for (const f of hintFeatures(poolBoard, h)) feature.set(f, (feature.get(f) ?? 0) + 1);
    }
    const norm = (m: Map<string, number>) => {
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      return (k: string) => (m.get(k) ?? 0) / total;
    };
    return { pred: norm(pred), feature: norm(feature), raw: feature };
  };
  /** Total variation distance from the archive: 0 is a perfect match, 1 is disjoint. */
  const distance = (hints: typeof pool) => {
    const s = sharesOf(hints);
    const preds = new Set([...Object.keys(mix.pred), ...hints.map((h) => h.pred)]);
    let d = 0;
    for (const p of preds) d += Math.abs(s.pred(p) - (mix.pred[p] ?? 0));
    for (const k of Object.keys(mix.feature)) d += Math.abs(s.feature(k) - mix.feature[k]);
    return d / 2;
  };

  it('puts a head that resembles the archive far more than a uniform shuffle does', () => {
    const weighted = distance(orderPool(makeRng(4), poolBoard, pool, mix).slice(0, HEAD));
    const uniform = distance(shuffled(makeRng(4), pool).slice(0, HEAD));
    expect(uniform).toBeGreaterThan(0.6);
    expect(weighted).toBeLessThan(0.3);
  });

  it('rarely picks two units that share a single card', () => {
    // When a clue's two units overlap in exactly one card, the second unit is
    // scaffolding: "only 1 of the 3 criminals neighbouring Jonas is in row 2"
    // reduces to "that one shared card is criminal" the moment you notice the
    // overlap, and the row does no work. The archive keeps this to 14% of its
    // two-unit clues and centres on overlaps of 2 or 3 (78%); the pool's own
    // shape is full of near-disjoint pairs, and nothing in `hintFeatures`
    // modelled the overlap, so the head sat at nearly three times the rate.
    const head = orderPool(makeRng(11), poolBoard, pool, mix).slice(0, HEAD);
    const overlaps = head.flatMap((h) => {
      const us = h.args.filter((a) => a.t === 'unit');
      if (us.length !== 2 || us[0].t !== 'unit' || us[1].t !== 'unit') return [];
      const first = new Set(unitMembers(poolBoard, us[0].unit));
      return [unitMembers(poolBoard, us[1].unit).filter((i) => first.has(i)).length];
    });
    expect(overlaps.length).toBeGreaterThan(20);
    const ones = overlaps.filter((n) => n === 1).length / overlaps.length;
    expect(ones).toBeLessThan(0.25);
  });

  it('lands the rare unit kinds on their archive share instead of overshooting', () => {
    // Scaling each feature once by archiveShare/poolShare does not reach the
    // archive's marginals: a hint carrying the same feature twice gets the
    // factor squared, and profession groups are 0.4% of the pool's unit slots
    // against the archive's 7%, so that factor is large. The head came out at
    // three times the archive's profession rate — over-correcting a clue type
    // the player then sees far too much of. Every feature should land near its
    // target, not merely on the right side of the pool's own share.
    const head = orderPool(makeRng(11), poolBoard, pool, mix).slice(0, HEAD);
    const s = sharesOf(head);
    for (const k of ['unit:profession', 'unit:neighbor', 'unit:row', 'unit:col']) {
      expect(s.feature(k), k).toBeGreaterThan(mix.feature[k] * 0.5);
      expect(s.feature(k), k).toBeLessThan(mix.feature[k] * 1.6);
    }
  });

  it('holds `between` back and lets the rarer units through', () => {
    const head = orderPool(makeRng(11), poolBoard, pool, mix).slice(0, HEAD);
    const s = sharesOf(head);
    // Uniformly, `between` takes 58% of unit slots and `profession` 0.4%.
    const between = [2, 3, 4, 5].reduce((a, n) => a + s.feature(`unit:between:${n}`), 0);
    expect(between).toBeLessThan(0.4);
    expect(s.feature('unit:profession')).toBeGreaterThan(0.02);
    expect(s.feature('unit:edge')).toBeGreaterThan(0.02);
  });

  it('prefers long between spans, as the archive does', () => {
    // The pool is the other way up — a 4x5 board has 26 two-card segments
    // against 4 five-card ones — so an unweighted draw makes almost every
    // between clue the shortest and least informative kind.
    const head = orderPool(makeRng(11), poolBoard, pool, mix).slice(0, HEAD);
    const s = sharesOf(head);
    expect(s.feature('unit:between:4')).toBeGreaterThan(s.feature('unit:between:2'));
    const long = s.feature('unit:between:4') + s.feature('unit:between:5');
    const short = s.feature('unit:between:2') + s.feature('unit:between:3');
    expect(long).toBeGreaterThan(short);
  });

  it('spreads directional clues over all four directions', () => {
    const head = orderPool(makeRng(11), poolBoard, pool, mix).slice(0, HEAD * 4);
    const dirs = [...sharesOf(head).raw]
      .filter(([k]) => k.startsWith('dir:'))
      .map(([, v]) => v);
    expect(dirs.length).toBe(4);
    expect(Math.max(...dirs)).toBeLessThan(Math.min(...dirs) * 3);
  });

  it('keeps every candidate — it reorders the pool, it does not filter it', () => {
    const ordered = orderPool(makeRng(2), poolBoard, pool, mix);
    expect(ordered.length).toBe(pool.length);
    expect(new Set(ordered).size).toBe(pool.length);
  });

  it('is deterministic for a given seed', () => {
    const a = orderPool(makeRng(5), poolBoard, pool, mix).slice(0, 50).map(formatHint);
    const b = orderPool(makeRng(5), poolBoard, pool, mix).slice(0, 50).map(formatHint);
    expect(a).toEqual(b);
    expect(orderPool(makeRng(6), poolBoard, pool, mix).slice(0, 50).map(formatHint)).not.toEqual(a);
  });
});

describe('makeRng', () => {
  it('is deterministic and in range', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    for (let i = 0; i < 5; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('generatePuzzle', () => {
  const result = generatePuzzle({
    date: '2026-01-01', difficulty: 'Medium', band, seed: 1, mix: boardMix, ...BOARD,
  });
  const puzzle = result.puzzle;

  it('produces a valid, uniquely solvable, fully chained puzzle', () => {
    expect(() => validatePuzzle(puzzle)).not.toThrow();
    expect(puzzle.variant).toBe('dan');
    expect(puzzle.date).toBe('2026-01-01');
    expect(puzzle.difficulty).toBe('Medium');
    const shape = {
      grid: makeGrid(puzzle.width, puzzle.height),
      professions: puzzle.people.map((p) => p.profession),
    };
    const clues = parseClues(puzzle.people.map((p) => p.origHint));
    const truth = puzzle.people.map((p) => p.criminal);
    expect(isUniquelySolvable(shape, clues, truth)).toBe(true);
    expect(solveChain(shape, clues, truth, puzzle.initialReveals).solvedAll).toBe(true);
  });

  // The bands are calibrated on the archive's twenty-card board, so the counts
  // in them — how many criminals, how many clue cards — mean "out of twenty".
  // Sampling the criminal count straight out of an unscaled band gives a wider
  // board a thinner puzzle than any real one: a 5x6 came out 30% criminal
  // against the archive's 47%.
  it('scales the band it was given to the board it is filling', () => {
    // min === max, so the criminal count is decided entirely by the scaling:
    // ten of twenty is five of ten, and eight of the sixteen cards here.
    const tenOfTwenty: LabelBand = { ...band, criminals: { min: 10, max: 10 } };
    const { puzzle: p } = generatePuzzle({
      date: '2026-01-01', difficulty: 'Medium', band: tenOfTwenty, seed: 5,
      mix: boardMix, ...BOARD,
    });
    expect(p.people.filter((q) => q.criminal).length).toBe(8);
  });

  // Every caller passes the archive's own mix, whose shapes all sum to twenty.
  // A board that is not 4x5 has to fit them itself rather than making the caller
  // trim or grow them first — otherwise `castOf` throws and no board but the
  // archive's own can ever be generated.
  it('fits the archive\'s profession shapes to whatever board it was given', () => {
    const { puzzle: p } = generatePuzzle({
      date: '2026-01-01', difficulty: 'Medium', band, seed: 3, mix, ...BOARD,
    });
    expect(p.people.length).toBe(BOARD.width * BOARD.height);
    expect(p.people.every((q) => q.profession.length > 0)).toBe(true);
  });

  it('round-trips every generated clue exactly', () => {
    for (const person of puzzle.people) {
      if (!person.origHint) continue;
      expect(render(parseHint(person.origHint))).toBe(person.clue);
    }
  });

  it('never puts a clue on a card the clue talks about', () => {
    // Enforced by construction; assert on the rendered markup, which names cards.
    // The trailing (?!\d) matters: a plain substring test for "#NAMES:1" also
    // matches "#NAMES:11", and card 1 hosting a clue about card 11 is legal.
    puzzle.people.forEach((person, i) => {
      if (!person.clue) return;
      expect(person.clue).not.toMatch(new RegExp(`#NAMES?:${i}(?!\\d)`));
    });
  });

  it('gives every non-initial card at least one sufficient path', () => {
    puzzle.people.forEach((person, i) => {
      if (puzzle.initialReveals.includes(i)) return;
      expect(person.paths, `people[${i}]`).not.toBeNull();
      expect((person.paths as number[][]).length).toBeGreaterThan(0);
    });
  });

  it('ships hints a player can act on', () => {
    // Every non-initial card is hintable, every card a step claims is one the
    // player does not already hold, and the clues it outlines are the ones the
    // deduction actually needs — not every clue visible at the time, which is
    // what shipping `solveChain`'s wave-shaped steps used to do.
    const hints = puzzle.hints as NonNullable<typeof puzzle.hints>;
    const clues = parseClues(puzzle.people.map((p) => p.origHint));
    for (const step of hints) {
      expect(step.reveals.length).toBeGreaterThan(0);
      expect(step.clues.length).toBeLessThan(hints.length);
      for (const i of step.clues) {
        expect(step.flipped).toContain(i);
        expect(clues[i]).not.toBeNull();
      }
      for (const i of step.reveals) expect(step.flipped).not.toContain(i);
    }
    const hintable = new Set(hints.flatMap((s) => s.reveals));
    puzzle.people.forEach((_, i) => {
      if (!puzzle.initialReveals.includes(i)) expect(hintable, `card ${i}`).toContain(i);
    });
  });

  it('offers a hint as sharp as the position allows, not as sharp as it once was', () => {
    // A step's clue list is minimised against its own prerequisite, which is a
    // small set found during generation. Late in a puzzle the player holds far
    // more than that, and a deduction that needed five clues from six flipped
    // cards often needs one from seventeen. Offering the five-clue version then
    // is the "re-read the board" failure again, wearing a different hat: the
    // step is sound, it just argues for a position the player left long ago.
    //
    // So at each card's hardest honest position — every other card flipped —
    // work out how few clues would do, and require an offerable step to match.
    const shape = {
      grid: makeGrid(puzzle.width, puzzle.height),
      professions: puzzle.people.map((p) => p.profession),
    };
    const clues = parseClues(puzzle.people.map((p) => p.origHint));
    const truth = puzzle.people.map((p) => p.criminal);
    const hints = puzzle.hints as NonNullable<typeof puzzle.hints>;

    puzzle.people.forEach((_, card) => {
      if (puzzle.initialReveals.includes(card)) return;
      const flipped = puzzle.people.map((_, i) => i).filter((i) => i !== card);

      // Greedy drop: how few clues suffice from here. Greedy, so an upper bound
      // on the true minimum — which only makes the bar below more forgiving.
      let active = clues;
      let needed = 0;
      for (const i of flipped) {
        if (active[i] === null) continue;
        const without = [...active];
        without[i] = null;
        if (forcedGiven(shape, without, truth, flipped)[card] === truth[card]) active = without;
        else needed++;
      }

      const offerable = hints.filter(
        (s) => s.reveals.includes(card) && s.flipped.every((i) => flipped.includes(i)),
      );
      expect(offerable.length, `card ${card}`).toBeGreaterThan(0);
      const best = Math.min(...offerable.map((s) => s.clues.length));
      expect(best, `card ${card}: offered ${best} clues where ${needed} would do`).toBeLessThanOrEqual(needed);
    });
  }, 60_000);

  it('offers a hint from the opening position', () => {
    // The prerequisite of a step is the minimal path, not the solve state it was
    // found in, so the first hint has to be reachable with only the cards the
    // player is handed. A wave-shaped step whose prerequisite is a dozen cards
    // leaves the button dead on move one.
    const hints = puzzle.hints as NonNullable<typeof puzzle.hints>;
    const opening = hints.filter((s) =>
      s.flipped.every((i) => puzzle.initialReveals.includes(i)),
    );
    expect(opening.length).toBeGreaterThan(0);
  });

  it(
    'reproduces exactly from its seed',
    () => {
      const again = generatePuzzle({
        date: '2026-01-01', difficulty: 'Medium', band, seed: 1, mix: boardMix, ...BOARD,
      });
      expect(again.puzzle).toEqual(puzzle);
    },
    // A generation on this board takes about a second; the margin is for slower
    // machines, not for a regression that makes this minutes again.
    30_000,
  );

  it('spreads its clues over predicates instead of leaning on one', () => {
    // The archive averages 9.4 distinct predicates per puzzle over ~12 clues,
    // and its worst repeat across all 54 is 7. Weighting the pool toward the
    // archive's mix got Dan puzzles from 6.5 distinct to 8.4, but weights are a
    // property of the whole pool, not of one puzzle: nothing stopped a chain
    // from taking the same predicate eight times because it kept working.
    // Measured as distinct predicates per clue rather than as a raw count. The
    // raw count moves with how many clues a board happens to need — this one is
    // 4x4 and takes about nine where the shipped 4x5 takes about thirteen, and
    // even between seeds here it runs from six clues to ten — so a fixed count
    // fails on a puzzle that is simply short rather than repetitive. The ratio
    // holds still: 0.76 on this board, 0.73 at 4x5, 0.78 across the archive.
    const counts = (p: typeof puzzle) => {
      const m = new Map<string, number>();
      for (const person of p.people) {
        if (!person.origHint) continue;
        const { pred } = parseHint(person.origHint);
        m.set(pred, (m.get(pred) ?? 0) + 1);
      }
      return m;
    };
    const all = [1, 2, 3, 4, 5].map((seed) =>
      counts(generatePuzzle({
        date: '2026-01-01', difficulty: 'Medium', band, seed, mix: boardMix, ...BOARD,
      }).puzzle),
    );
    const clues = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    const pooled = all.reduce((a, m) => a + m.size, 0) / all.reduce((a, m) => a + clues(m), 0);
    expect(pooled).toBeGreaterThanOrEqual(0.7);
    // And no single puzzle allowed to be the repetitive one the pooled figure
    // would hide.
    for (const m of all) {
      expect(m.size / clues(m)).toBeGreaterThanOrEqual(0.6);
      expect(Math.max(...m.values())).toBeLessThanOrEqual(3);
    }
  }, 30_000);

  it('uses only original titles and flavour text', () => {
    expect(puzzle.source).toBe('generated');
    for (const person of puzzle.people) {
      if (person.origHint === null) expect(person.clue).not.toBeNull();
    }
  });

});

describe('labelOf', () => {
  // Same band as the fixture above, but chainLength narrowed to a single
  // unreachable value, so every attempt that clears every other check (chain
  // solved, uniquely solvable, every card path-reachable) still misses the
  // gate. That makes the band impossible to satisfy by construction — which is
  // exactly what distinguishes the two code paths under test.
  const impossibleBand: LabelBand = { ...band, chainLength: { min: 1000, max: 1000 } };

  // Enough attempts that at least one is sound — roughly half of them are, and
  // an attempt on this board costs about a second. Pinning maxAttempts to 1 and
  // hunting for a seed whose attempt 0 happens to work makes the pair fragile:
  // the throwing test then passes for the wrong reason (unsound attempt rather
  // than missed band) whenever clue selection changes. The two differ only in
  // whether labelOf is passed.
  const maxAttempts = 8;

  it(
    'without labelOf, an unsatisfiable band exhausts every attempt and throws',
    () => {
      expect(() =>
        generatePuzzle({
          date: '2026-01-01',
          difficulty: 'Medium',
          band: impossibleBand,
          seed: 1,
          mix: boardMix,
          ...BOARD,
          maxAttempts,
        }),
      ).toThrow(GenerationError);
    },
    30_000,
  );

  it(
    'with labelOf, the same unsatisfiable band still yields a sound puzzle carrying the label it earned',
    () => {
      const seen: number[] = [];
      const { puzzle: p } = generatePuzzle({
        date: '2026-01-01',
        difficulty: 'Medium',
        band: impossibleBand,
        seed: 1,
        mix: boardMix,
        ...BOARD,
        maxAttempts,
        labelOf: (m) => {
          seen.push(m.chainLength);
          return 'Whatever';
        },
      });

      // The label on the puzzle is the one labelOf returned, not `difficulty`,
      // and it was decided from metrics that genuinely miss the band.
      expect(p.difficulty).toBe('Whatever');
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toBe(1000);

      // Relaxing the band gate must not relax anything else: the puzzle is
      // still schema-valid, uniquely solvable, fully chained, and free of
      // guesses. This is the whole risk of accepting off-band puzzles.
      expect(() => validatePuzzle(p)).not.toThrow();
      const shape = { grid: makeGrid(p.width, p.height), professions: p.people.map((x) => x.profession) };
      const clues = parseClues(p.people.map((x) => x.origHint));
      const truth = p.people.map((x) => x.criminal);
      expect(isUniquelySolvable(shape, clues, truth)).toBe(true);
      expect(solveChain(shape, clues, truth, p.initialReveals).solvedAll).toBe(true);
      p.people.forEach((person, i) => {
        if (p.initialReveals.includes(i)) return;
        expect(person.paths, `people[${i}]`).not.toBeNull();
        expect((person.paths as number[][]).length).toBeGreaterThan(0);
      });
    },
    30_000,
  );
});

describe('generatePuzzle against the real calibrated bands', () => {
  // Loads the real calibrated config/difficulty.json rather than a synthetic
  // fixture, and exercises the way generation is actually driven: aim at a
  // real label's band, accept the first valid puzzle, and label it by what it
  // measured. Easy sits near the bottom and Brutal near the top of the
  // calibrated abstractShare range, so together they exercise the abstraction
  // bias in both directions.
  const bands = loadBands(
    JSON.parse(readFileSync(path.join(process.cwd(), 'config', 'difficulty.json'), 'utf8')),
  );

  it(
    'aims at Easy and at Brutal, returns a sound puzzle for each, and labels it by its own metrics',
    () => {
      const easy = generatePuzzle({
        date: '2026-01-01',
        difficulty: 'Easy',
        band: bands.Easy,
        seed: 1,
        mix: boardMix,
        ...BOARD,
        labelOf: (m) => classify(bands, m),
      });
      const brutal = generatePuzzle({
        date: '2026-01-01',
        difficulty: 'Brutal',
        band: bands.Brutal,
        seed: 1,
        mix: boardMix,
        ...BOARD,
        labelOf: (m) => classify(bands, m),
      });

      // The stored label must be reproducible from the puzzle's own metrics —
      // this is the invariant scripts/audit-dan.mts enforces across the whole
      // archive, asserted here at the point the label is assigned.
      for (const r of [easy, brutal]) {
        expect(Object.keys(bands)).toContain(r.puzzle.difficulty);
        expect(r.puzzle.difficulty).toBe(classify(bands, r.metrics));
      }

      // The bias still separates the two aims even though neither is now
      // required to land in band: Easy's calibrated share tops out around 0.23
      // and Brutal's starts around 0.45, so aiming at each should pull the
      // abstraction share in opposite directions rather than land on one
      // pool-average value for both.
      expect(brutal.metrics.abstractShare).toBeGreaterThan(easy.metrics.abstractShare);
    },
    // Two generations against the real bands.
    30_000,
  );
});
