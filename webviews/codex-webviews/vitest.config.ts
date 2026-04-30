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
        exclude: ['**/node_modules/**', '**/dist/**'],
        globals: true,
        setupFiles: ['src/test-setup.ts'],
    },
});



