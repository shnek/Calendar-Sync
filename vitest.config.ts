import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Fixed zone so all-day and DST tests are deterministic on every machine.
    env: { TZ: 'America/New_York' },
  },
})
