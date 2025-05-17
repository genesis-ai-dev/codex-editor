declare module 'mocha/mocha' {
    export const suite: any;
    export const test: any;
    export const setup: any;
    export const teardown: any;
    export const suiteSetup: any;
    export const suiteTeardown: any;
    export const before: any;
    export const after: any;
    export const beforeEach: any;
    export const afterEach: any;
    export function run(callback: (failures: number) => void): void;
    export function setup(options: { ui: string; reporter: undefined }): void;
} 