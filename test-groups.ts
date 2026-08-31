/**
 * Test files that generate real puzzles.
 *
 * Everything in here calls `generatePuzzle` or `runGenerate`, each of which
 * builds a forcing chain and then solves it by enumerating all 2^20
 * assignments — tens of seconds per puzzle, and more when a chain stalls and
 * has to be rebuilt. These files alone are the difference between a suite that
 * runs in seconds and one that runs in minutes, so the default `npm test`
 * skips them and `npm run test:slow` runs them on their own. `npm run
 * test:all` runs both and is what CI should use.
 *
 * Add a file here only if it is slow *because it generates puzzles*. Anything
 * slow for another reason is a bug worth fixing rather than a file to hide.
 */
export const GENERATION_TESTS = [
  'shared/solver/generate.test.ts',
  'scripts/generate.test.mts',
];
