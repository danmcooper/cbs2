import { defineConfig } from 'vitest/config';
import { GENERATION_TESTS } from './test-groups';

// Only the puzzle-generation tests — minutes, not seconds. See `test-groups.ts`.
// No React plugin: nothing in here renders a component.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: GENERATION_TESTS,
    // Generating a puzzle is CPU-bound and single-threaded; running the files
    // in parallel just makes them contend for the same cores.
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
