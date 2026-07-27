import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as test from "@vscode/test-electron";

async function runTests() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, "../../");
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");
        // VS Code derives an IPC socket inside its user-data directory. A
        // deeply nested worktree can exceed macOS's Unix-socket path limit
        // before the extension tests even start, so keep only ephemeral profile
        // data in a short system-temporary path.
        const userDataDir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "codex-editor-test-"),
        );

        try {
            // The path to your test workspace folder
            await test.runTests({
                extensionDevelopmentPath,
                extensionTestsPath,
                launchArgs: [`--user-data-dir=${userDataDir}`],
            });
        } finally {
            await fs.promises.rm(userDataDir, { recursive: true, force: true });
        }
    } catch (err) {
        console.error("Failed to run tests", err);
        process.exit(1);
    }
}

runTests();
