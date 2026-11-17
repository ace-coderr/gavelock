import { defineConfig } from 'vitest/config';

// The rule compiler tests try every variable order, which is CPU-heavy on a busy machine.
export default defineConfig({ test: { testTimeout: 60_000 } });
