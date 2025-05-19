// No Mocha for web extension tests

export function run(): Promise<void> {
    // No tests for web extension
    return Promise.resolve();
}

export * from "./sourceImport.test";
export * from "./extension.web.test";
export * from "../testUtils";
