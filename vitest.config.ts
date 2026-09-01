import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// One suite. The puzzle-generation tests used to live in a separate slow config
// because generating a 4x5 puzzle means enumerating 2^20 assignments — minutes
// per file. They now generate on a 4x4 board, which is sixteen times cheaper and
// seconds per file, so they run here with everything else. The check that the
// shipped 4x5 size still generates soundly is `npm run test:generate`.
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
  },
});
