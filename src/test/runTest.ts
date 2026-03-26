import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    downloadAndUnzipVSCode,
    resolveCliArgsFromVSCodeExecutablePath,
    TestRunFailedError,
} from "@vscode/test-electron";

async function runTests(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index.js");

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

    /**
     * @vscode/test-electron's runTests spawns .../MacOS/Electron with a workspace folder as the
     * first argv entry. On Node 22+ / current VS Code that path is run as the main module
     * (MODULE_NOT_FOUND). Spawning the `code` CLI with the same flags avoids that.
     */
    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    const [codeCli, ...profileArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

    const extensionDevArgs =
        extensionDevelopmentPaths.length === 1
            ? [`--extensionDevelopmentPath=${extensionDevelopmentPaths[0]}`]
            : extensionDevelopmentPaths.map((p) => `--extensionDevelopmentPath=${p}`);

    const args = [
        ...profileArgs,
        "--no-sandbox",
        "--disable-gpu-sandbox",
        "--disable-updates",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        `--extensionTestsPath=${extensionTestsPath}`,
        ...extensionDevArgs,
        testWorkspaceDir,
    ];

    const shell = process.platform === "win32";
    const executable = shell ? `"${codeCli}"` : codeCli;

    await new Promise<void>((resolve, reject) => {
        const child = cp.spawn(executable, args, {
            env: {
                ...process.env,
                // Skips long Frontier Authentication wait / Git download at startup; tests use
                // embedded dugite from node_modules (see extension activate).
                CODEX_EXTENSION_TEST: "1",
            },
            shell,
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("close", (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new TestRunFailedError(code ?? undefined, signal ?? undefined));
            }
        });
    });
}

async function main(): Promise<void> {
    try {
        await runTests();
    } catch (err) {
        console.error("Failed to run tests", err);
        process.exit(1);
    }
}

void main();
