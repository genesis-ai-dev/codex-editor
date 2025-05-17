// Remove invalid module augmentation
// declare module 'mocha/mocha';

// Import mocha and expose it globally
import * as mocha from 'mocha';
if (typeof window !== 'undefined') {
    (window as any).mocha = mocha;
}

// Initialize Mocha
mocha.setup('tdd');

// Assign Mocha globals
Object.assign(global, {
    suite: mocha.suite,
    test: mocha.test,
    setup: mocha.setup,
    teardown: mocha.teardown,
    suiteSetup: mocha.suiteSetup,
    suiteTeardown: mocha.suiteTeardown,
    before: mocha.before,
    after: mocha.after,
    beforeEach: mocha.beforeEach,
    afterEach: mocha.afterEach
});

// Define our own promisify function
function promisify<T>(fn: any): (...args: any[]) => Promise<T> {
    return (...args: any[]) => {
        return new Promise<T>((resolve, reject) => {
            fn(...args, (err: any, result: T) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
    };
}

export function run(): Promise<void> {
    // No tests for web
    return Promise.resolve();
}

export * from "./sourceImport.test";
export * from "./extension.web.test";
export * from "../testUtils";
