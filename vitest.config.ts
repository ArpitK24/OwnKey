import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        globalSetup: ['tests/helpers/global-setup.ts'],
        // Integration tests spawn the CLI several times per test; leave room for slow starts.
        testTimeout: 120000,
        hookTimeout: 120000,
        // CLI tests share a temp HOME per file; keep files isolated
        pool: 'forks',
    },
});
