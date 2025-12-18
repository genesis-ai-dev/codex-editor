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

        const clock = sinon.useFakeTimers();
        const tempProjectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-heal-sync-"));

        // Ensure we don't actually pop UI
        const infoStub = sinon.stub(vscode.window, "showInformationMessage").resolves(undefined as any);

        // Frontier auth extension activation stub
        const activateStub = sinon.stub().resolves();
        const getExtensionStub = sinon.stub(vscode.extensions, "getExtension").returns({
            id: "frontier-rnd.frontier-authentication",
            isActive: true,
            exports: {},
            activate: activateStub,
        } as any);

        // Ensure heal uses our temp projects dir for snapshot
        const getCodexProjectsDirectoryStub = sinon.stub(projectLocationUtils, "getCodexProjectsDirectory").resolves(
            vscode.Uri.file(tempProjectsDir)
        );

        // Make merge steps no-op
        const buildConflictsStub = sinon.stub(directoryConflicts, "buildConflictsFromDirectories").resolves({
            textConflicts: [],
            binaryCopies: [],
        });
        const resolveConflictFilesStub = sinon.stub(mergeResolvers, "resolveConflictFiles").resolves([]);

        // Capture openFolder invocation (heal triggers reload to run sync on next activation)
        const executeCommandStub = sinon.stub(vscode.commands, "executeCommand").resolves(undefined);

        const context = createMockExtensionContext();
        const provider = new StartupFlowProvider(context);

        // Stub internals to avoid real backup/copy work
        (provider as any).createProjectBackup = sinon.stub().resolves(vscode.Uri.file(path.join(tempProjectsDir, "backup.zip")));
        (provider as any).copyDirectory = sinon.stub().resolves();
        (provider as any).generateTimestamp = sinon.stub().returns("TEST_TS");

        // Create an initial "corrupted" project folder so the delete step has something to remove
        const projectPath = path.join(tempProjectsDir, "healed-project");
        fs.mkdirSync(projectPath, { recursive: true });
        fs.writeFileSync(path.join(projectPath, "dummy.txt"), "dummy", "utf8");

        // Stub frontierApi clone used by heal step 4
        (provider as any).frontierApi = {
            cloneRepository: sinon.stub().callsFake(async (_repoUrl: string, cloneToPath?: string) => {
                if (cloneToPath) {
                    fs.mkdirSync(cloneToPath, { recursive: true });
                }
                return true;
            }),
        };

        const progress = { report: sinon.stub() } as any;

        // Start heal, then fast-forward the internal 3s wait
        const healPromise = (provider as any).performProjectHeal(
            progress,
            "projectName",
            projectPath,
            "https://example.com/repo.git",
            false
        );
        await clock.tickAsync(3000);
        await healPromise;

        // Should persist a pending heal sync payload
        const pending = (context.globalState as any).get("codex.pendingHealSync");
        assert.ok(pending, "Should store codex.pendingHealSync");
        assert.strictEqual(pending.projectPath, projectPath);
        assert.strictEqual(pending.commitMessage, "Healed project: merged local changes after re-clone");

        // Should open the healed folder (triggers reload)
        sinon.assert.calledWith(executeCommandStub, "vscode.openFolder", sinon.match.any, false);

        // Cleanup stubs
        clock.restore();
        infoStub.restore();
        getExtensionStub.restore();
        getCodexProjectsDirectoryStub.restore();
        buildConflictsStub.restore();
        resolveConflictFilesStub.restore();
        executeCommandStub.restore();
        sinon.restore();

        try {
            fs.rmSync(tempProjectsDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });
});

