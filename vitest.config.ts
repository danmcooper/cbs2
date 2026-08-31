import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { GENERATION_TESTS } from './test-groups';

// The default suite: everything except the puzzle-generation tests, which run
// separately via `npm run test:slow`. See `test-groups.ts` for why.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true, // lets @testing-library/react auto-cleanup between tests
    environment: 'node',
    include: [
      'shared/**/*.test.ts',
      'scripts/**/*.test.mts',
      'site/src/**/*.test.{ts,tsx}',
    ],
    exclude: [...configDefaults.exclude, ...GENERATION_TESTS],
  },
});
