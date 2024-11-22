// Imports mocha for the browser, defining the `mocha` global.
require("mocha/mocha");

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
    return new Promise((c, e) => {
        mocha.setup({
            ui: "tdd",
            reporter: undefined,
        });

        // Bundles all files in the current directory matching `*.test`
        const importAll = (r: { keys: () => string[]; (key: string): any }) =>
            r.keys().forEach((key) => r(key));
        // Use webpack's require without accessing context property
        // @ts-expect-error: webpack require.context is not typed
        importAll(require.context(".", true, /\.test$/));

        try {
            // Run the mocha test
            mocha.run((failures: number) => {
                if (failures > 0) {
                    e(new Error(`${failures} tests failed.`));
                } else {
                    c();
                }
            });
        } catch (err) {
            console.error(err);
            e(err);
        }
    });
}

export * from "./sourceImport.test";
export * from "../testUtils";
