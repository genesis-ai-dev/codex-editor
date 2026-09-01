import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    resolve: {
        alias: {
            // Directory (not index.ts) so `@sharedUtils/exportOptionsEligibility` resolves like Vite
            '@sharedUtils': resolve(__dirname, '../../sharedUtils'),
            'types': resolve(__dirname, '../../types'),
        },
    },
    test: {
        environment: 'jsdom',
        include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            // Local IDML diagnostics: they read unpublished files under
            // `Test Files/` and must not run on pre-push / CI.
            '**/*.debug.test.ts',
            '**/bible-swap/scripts/neh8-*.test.ts',
            '**/bible-swap/scripts/verify-mr-export.test.ts',
            '**/bible-swap/scripts/jos-est-analysis.test.ts',
            '**/bible-swap/scripts/validatorHarness.test.ts',
            '**/bible-swap/scripts/1co-boundary-bleed.test.ts',
        ],
        globals: true,
        setupFiles: ['src/test-setup.ts'],
    },
});



