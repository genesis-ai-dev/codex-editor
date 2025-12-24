import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import sinon from "sinon";

import { StartupFlowProvider } from "../../providers/StartupFlow/StartupFlowProvider";
import { createMockExtensionContext, swallowDuplicateCommandRegistrations } from "../testUtils";

import * as directoryConflicts from "../../projectManager/utils/merge/directoryConflicts";
import * as mergeResolvers from "../../projectManager/utils/merge/resolvers";
import * as projectLocationUtils from "../../utils/projectLocationUtils";

suite("StartupFlowProvider Heal - triggers LFS-aware sync", () => {
    suiteSetup(() => {
        swallowDuplicateCommandRegistrations();
    });

    test("performProjectHeal sets workspace and calls stageAndCommitAllAndSync", async function () {
        this.timeout(15000);

        const tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-heal-sync-"));

        // Ensure we don't actually pop UI
        const infoStub = sinon.stub(vscode.window, "showInformationMessage").resolves(undefined as any);

        // Prevent background preflight/auth initialization from running during this test
        const initStub = sinon.stub(StartupFlowProvider.prototype as any, "initializeComponentsAsync").resolves();

        // Frontier auth extension activation stub (also used for heal version gate)
        const activateStub = sinon.stub().resolves();
        const getExtensionStub = sinon.stub(vscode.extensions, "getExtension").returns({
            id: "frontier-rnd.frontier-authentication",
            isActive: true,
            exports: {},
            activate: activateStub,
            packageJSON: { version: "0.4.11" },
        } as any);

        // Ensure heal uses our temp projects dir for snapshot
        // Make sure the directory exists so createDirectory can succeed
        fs.mkdirSync(tempProjectsDir, { recursive: true });
        const getCodexProjectsDirectoryStub = sinon.stub(projectLocationUtils, "getCodexProjectsDirectory").resolves(
            vscode.Uri.file(tempProjectsDir)
        );

        // Make merge steps no-op
        const buildConflictsStub = sinon.stub(directoryConflicts, "buildConflictsFromDirectories").resolves({
            textConflicts: [],
            binaryCopies: [],
        });
        const resolveConflictFilesStub = sinon.stub(mergeResolvers, "resolveConflictFiles").resolves([]);

        // Try to stub vscode.workspace.fs operations (may fail if non-configurable)
        let fsStatStub: sinon.SinonStub | undefined;
        let fsDeleteStub: sinon.SinonStub | undefined;
        let fsCreateDirectoryStub: sinon.SinonStub | undefined;
        let fsWriteFileStub: sinon.SinonStub | undefined;
        try {
            fsStatStub = sinon.stub(vscode.workspace.fs, "stat").resolves({ type: vscode.FileType.Directory } as any);
        } catch {
            // Non-configurable, will use real operations
        }
        try {
            fsDeleteStub = sinon.stub(vscode.workspace.fs, "delete").resolves();
        } catch {
            // Non-configurable, will use real operations
        }
        try {
            fsCreateDirectoryStub = sinon.stub(vscode.workspace.fs, "createDirectory").resolves();
        } catch {
            // Non-configurable, will use real operations
        }
        try {
            fsWriteFileStub = sinon.stub(vscode.workspace.fs, "writeFile").resolves();
        } catch {
            // Non-configurable, will use real operations
        }

        // Capture openFolder invocation (heal triggers reload to run sync on next activation)
        // Ensure it resolves immediately to prevent hanging
        const executeCommandStub = sinon.stub(vscode.commands, "executeCommand").callsFake(async (command: string) => {
            if (command === "vscode.openFolder") {
                return Promise.resolve(undefined);
            }
            return Promise.resolve(undefined);
        });

        const context = createMockExtensionContext();
        const provider = new StartupFlowProvider(context);

        // Stub internals to avoid real backup/copy work
        (provider as any).createProjectBackup = sinon.stub().resolves(vscode.Uri.file(path.join(tempProjectsDir, "backup.zip")));
        (provider as any).copyDirectory = sinon.stub().resolves();
        (provider as any).generateTimestamp = sinon.stub().returns("TEST_TS");
        (provider as any).ensureDirectoryExists = sinon.stub().resolves(true);

        // Create an initial "corrupted" project folder so the delete step has something to remove
        const projectPath = path.join(tempProjectsDir, "healed-project");
        fs.mkdirSync(projectPath, { recursive: true });
        fs.writeFileSync(path.join(projectPath, "dummy.txt"), "dummy", "utf8");

        // Stub frontierApi clone used by heal step 4
        // The clone will recreate the directory after deletion
        (provider as any).frontierApi = {
            cloneRepository: sinon.stub().callsFake(async (_repoUrl: string, cloneToPath?: string) => {
                if (cloneToPath) {
                    // Ensure directory exists for vscode.workspace.fs.stat check
                    fs.mkdirSync(cloneToPath, { recursive: true });
                    fs.writeFileSync(path.join(cloneToPath, ".gitkeep"), "", "utf8");
                }
                return true;
            }),
        };

        const progress = { report: sinon.stub() } as any;

        // Make the internal post-clone delay instant for tests
        (provider as any).sleep = sinon.stub().resolves();

        // Start heal
        const healPromise = (provider as any).performProjectHeal(
            progress,
            "projectName",
            projectPath,
            "https://example.com/repo.git",
            false
        );

        // Wait for the promise to resolve
        await healPromise;

        // Should persist a pending heal sync payload
        const pending = (context.globalState as any).get("codex.pendingHealSync");
        assert.ok(pending, "Should store codex.pendingHealSync");
        assert.strictEqual(pending.projectPath, projectPath);
        assert.strictEqual(pending.commitMessage, "Healed project: merged local changes after re-clone");

        // Should open the healed folder (triggers reload)
        sinon.assert.calledWith(executeCommandStub, "vscode.openFolder", sinon.match.any, false);

        // Cleanup stubs
        infoStub.restore();
        initStub.restore();
        getExtensionStub.restore();
        getCodexProjectsDirectoryStub.restore();
        buildConflictsStub.restore();
        resolveConflictFilesStub.restore();
        if (fsStatStub) {
            fsStatStub.restore();
        }
        if (fsDeleteStub) {
            fsDeleteStub.restore();
        }
        if (fsCreateDirectoryStub) {
            fsCreateDirectoryStub.restore();
        }
        if (fsWriteFileStub) {
            fsWriteFileStub.restore();
        }
        executeCommandStub.restore();
        sinon.restore();

        try {
            fs.rmSync(tempProjectsDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });
});

