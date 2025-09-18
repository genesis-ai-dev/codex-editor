import * as path from "path";
import * as vscode from "vscode";
import * as test from "@vscode/test-electron";

async function runTests() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, "../../");
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        // The path to your test workspace folder
        await test.runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [],
            // version: '1.90.0', // Use a more stable version
        });
    } catch (err) {
        console.error("Failed to run tests", err);
        process.exit(1);
    }
}

runTests();
