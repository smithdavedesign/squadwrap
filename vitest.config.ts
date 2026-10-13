import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // PGlite boots a WASM Postgres per test file (~1 s).
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
})
