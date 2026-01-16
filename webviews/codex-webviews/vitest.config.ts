import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@sharedUtils': resolve(__dirname, '../../sharedUtils/index.ts'),
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



