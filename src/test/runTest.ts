import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as test from "@vscode/test-electron";

async function runTests() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, "../../");
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        const sharedStateCandidates = [
            path.join(extensionDevelopmentPath, "..", "shared-state-store"),
            path.join(extensionDevelopmentPath, "shared-state-store"),
        ];
        const extensionDevelopmentPaths: string[] = [extensionDevelopmentPath];
        for (const candidate of sharedStateCandidates) {
            if (fs.existsSync(path.join(candidate, "package.json"))) {
                extensionDevelopmentPaths.push(path.resolve(candidate));
                break;
            }
        }

        const testWorkspaceDir = path.join(os.tmpdir(), "codex-editor-vscode-test-workspace");
        fs.mkdirSync(testWorkspaceDir, { recursive: true });

        await test.runTests({
            extensionDevelopmentPath:
                extensionDevelopmentPaths.length === 1
                    ? extensionDevelopmentPaths[0]
                    : extensionDevelopmentPaths,
            extensionTestsPath,
            /** Real folder so the window has a workspace; tests may still add folders under /tmp. */
            launchArgs: [testWorkspaceDir],
        });
    } catch (err) {
        console.error("Failed to run tests", err);
        process.exit(1);
    }
}

runTests();
