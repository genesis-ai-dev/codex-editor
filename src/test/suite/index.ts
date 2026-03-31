// Imports mocha for the browser, defining the `mocha` global.
require("mocha/mocha");

import * as fs from "fs";

// Ensure a minimal location object exists for mocha in non-browser contexts
if (typeof (globalThis as any).location === "undefined") {
    (globalThis as any).location = { search: "" } as any;
} else if (typeof (globalThis as any).location.search === "undefined") {
    (globalThis as any).location.search = "";
}

// Ensure OS temp directory exists for tests (memfs may lack '/tmp')
try {
    if (typeof (fs as any)?.mkdirSync === "function") {
        fs.mkdirSync("/tmp", { recursive: true });
    }
} catch (e) {
    // non-fatal; environments without memfs/root permissions will ignore
}

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
        const importAll = (r: { keys: () => string[]; (key: string): any; }) => {
            const patternSource = (globalThis as any).process?.env?.CODEX_TEST_GLOB as string | undefined;
            const runtimeFilter = patternSource ? new RegExp(patternSource) : undefined;
            r.keys()
                .filter((key) => (runtimeFilter ? runtimeFilter.test(key) : true))
                .forEach((key) => r(key));
        };
        // Use webpack's require without accessing context property
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

export * from "../testUtils";
