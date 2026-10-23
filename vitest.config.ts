import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        testTimeout: 30000,
        hookTimeout: 30000,
        // CLI tests share a temp HOME per file; keep files isolated
        pool: 'forks',
    },
});
