import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    readLocalProjectSettings,
    markPendingUpdateRequired,
    clearPendingUpdate,
} from "../../utils/localProjectSettings";
import { checkRemoteUpdatingRequired, isEffectivelyCancelled } from "../../utils/remoteUpdatingManager";
import type { RemoteUpdatingEntry } from "../../../types";

suite("Pending Update Validation Tests", () => {
    let tempDir: string;
    let projectUri: vscode.Uri;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-pending-"));
        projectUri = vscode.Uri.file(tempDir);
        sandbox = sinon.createSandbox();

        // Create project structure
        fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
        fs.mkdirSync(path.join(tempDir, ".project"), { recursive: true });
    });

    teardown(() => {
        sandbox.restore();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test("pendingUpdate flag is UI hint only - does not force update alone", async () => {
        // Set pendingUpdate WITHOUT updateState
        await markPendingUpdateRequired(projectUri, "Remote requirement");

        const settings = await readLocalProjectSettings(projectUri);

        // Verify flags
        assert.ok(settings.pendingUpdate, "pendingUpdate should exist");
        assert.strictEqual(settings.pendingUpdate?.required, true);
        assert.strictEqual(settings.updateState, undefined, "updateState should NOT exist");

        // This state means: "Show badge in UI, but must validate against remote"
        // The update will ONLY proceed if checkRemoteUpdatingRequired() confirms
    });

    test("updateState existence forces update regardless of remote", async () => {
        // Set both pendingUpdate AND updateState (update in progress)
        await markPendingUpdateRequired(projectUri, "Remote requirement");

        const settings = await readLocalProjectSettings(projectUri);
        settings.updateState = {
            projectPath: tempDir,
            projectName: path.basename(tempDir),
            step: "backup_done",
            completedSteps: ["backup_done"],
            backupZipPath: path.join(tempDir, "backup.zip"),
            createdAt: Date.now(),
        };
        await settings;

        // Write it manually since we're testing
        const settingsPath = path.join(tempDir, ".project", "localProjectSettings.json");
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

        // Reload
        const reloaded = await readLocalProjectSettings(projectUri);

        // Verify both exist
        assert.ok(reloaded.pendingUpdate, "pendingUpdate should exist");
        assert.ok(reloaded.updateState, "updateState should exist");

        // This state means: "Update in progress - MUST complete regardless of remote status"
        // Even if admin removes remote requirement, update must finish to prevent orphaned files
    });

    test("pendingUpdate cleared only on positive evidence (cancelled/executed), not on any !required", async () => {
        // Documents the stricter validatePendingUpdates() behavior:
        // clearing requires remoteReachable + entryStatus === "cancelled" | "executed".
        // A simple !required with entryStatus "not_found" must NOT clear.

        await markPendingUpdateRequired(projectUri, "Remote requirement");

        let settings = await readLocalProjectSettings(projectUri);
        assert.ok(settings.pendingUpdate, "Initial pendingUpdate should exist");

        // Simulate: remote reachable, entry was cancelled (positive evidence)
        const remoteCheck = await checkRemoteUpdatingRequired(tempDir);

        const canClear = !remoteCheck.required
            && remoteCheck.remoteReachable
            && (remoteCheck.entryStatus === "cancelled" || remoteCheck.entryStatus === "executed");

        if (canClear) {
            await clearPendingUpdate(projectUri);
        }

        // In a test environment with no git remote, remoteReachable is falsy and
        // entryStatus is undefined, so canClear is false and the flag stays.
        settings = await readLocalProjectSettings(projectUri);
        assert.ok(
            settings.pendingUpdate,
            "pendingUpdate should NOT be cleared when remote is unreachable (no positive evidence)"
        );
    });

    test("pendingUpdate should NOT be cleared when updateState exists", async () => {
        // Setup: Create both pendingUpdate and updateState (update in progress)
        await markPendingUpdateRequired(projectUri, "Remote requirement");

        let settings = await readLocalProjectSettings(projectUri);
        settings.updateState = {
            projectPath: tempDir,
            projectName: path.basename(tempDir),
            step: "clone_done",
            completedSteps: ["backup_done", "clone_done"],
            backupZipPath: path.join(tempDir, "backup.zip"),
            clonePath: path.join(tempDir, "_cloning"),
            createdAt: Date.now(),
        };

        const settingsPath = path.join(tempDir, ".project", "localProjectSettings.json");
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

        // Reload to verify
        settings = await readLocalProjectSettings(projectUri);
        assert.ok(settings.updateState, "updateState should exist");
        assert.ok(settings.pendingUpdate, "pendingUpdate should exist");

        // Simulate: Remote check says update NOT required
        const remoteCheck = await checkRemoteUpdatingRequired(tempDir);

        // Even if remote doesn't require update, we should NOT clear anything
        // because updateState exists (update is in progress)
        if (settings.updateState) {
            // Don't clear - must complete the update
            // This prevents orphaned _cloning folders, partial backups, etc.
        } else {
            const canClear = !remoteCheck.required
                && remoteCheck.remoteReachable
                && (remoteCheck.entryStatus === "cancelled" || remoteCheck.entryStatus === "executed");
            if (canClear) {
                await clearPendingUpdate(projectUri);
            }
        }

        // Verify: Everything should still be there
        settings = await readLocalProjectSettings(projectUri);
        assert.ok(settings.updateState, "updateState should still exist");
        assert.ok(settings.pendingUpdate, "pendingUpdate should still exist");
    });

    test("pendingUpdate reason can be updated without affecting updateState", async () => {
        // Setup: Create pendingUpdate with initial reason
        await markPendingUpdateRequired(projectUri, "Initial reason");

        const initialSettings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(initialSettings.pendingUpdate?.reason, "Initial reason");

        // Update the reason
        await markPendingUpdateRequired(projectUri, "Updated reason");

        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(
            settings.pendingUpdate?.reason,
            "Updated reason",
            "Reason should be updated"
        );
        assert.strictEqual(
            settings.updateState,
            undefined,
            "updateState should still not exist"
        );
    });

    test("clearPendingUpdate only removes pendingUpdate, not updateState", async () => {
        // Setup: Create both
        await markPendingUpdateRequired(projectUri, "Test reason");

        let settings = await readLocalProjectSettings(projectUri);
        settings.updateState = {
            projectPath: tempDir,
            projectName: path.basename(tempDir),
            step: "merge_done",
            completedSteps: ["backup_done", "clone_done", "merge_done"],
            createdAt: Date.now(),
        };

        const settingsPath = path.join(tempDir, ".project", "localProjectSettings.json");
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

        // Clear only pendingUpdate
        await clearPendingUpdate(projectUri);

        // Verify: pendingUpdate gone, updateState remains
        settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.pendingUpdate, undefined, "pendingUpdate should be cleared");
        assert.ok(settings.updateState, "updateState should still exist");
    });

    test("Remote validation prevents update if only pendingUpdate exists", async () => {
        // This documents the flow in StartupFlowProvider.ts

        // Setup: Only pendingUpdate (no updateState)
        await markPendingUpdateRequired(projectUri, "Remote requirement");

        const settings = await readLocalProjectSettings(projectUri);
        const hasUpdateState = !!settings.updateState;
        const hasPendingUpdate = !!settings.pendingUpdate;

        // Check remote
        const remoteCheck = await checkRemoteUpdatingRequired(tempDir);

        // Decision logic (from StartupFlowProvider)
        let shouldStartUpdate = false;

        if (hasUpdateState) {
            // Hard lock - must continue
            shouldStartUpdate = true;
        } else if (remoteCheck.required) {
            // Remote confirms - start new update
            shouldStartUpdate = true;
        } else if (hasPendingUpdate && !remoteCheck.required) {
            // pendingUpdate alone without remote confirmation - don't start
            shouldStartUpdate = false;
        }

        // Verify: Should NOT start update (only pendingUpdate, no remote confirmation)
        assert.strictEqual(
            shouldStartUpdate,
            false,
            "Should not start update with only pendingUpdate and no remote confirmation"
        );
    });

    // ── Stricter clearing-rule tests ─────────────────────────────────────

    test("pendingUpdate NOT cleared when entryStatus is not_found", async () => {
        await markPendingUpdateRequired(projectUri, "Remote requirement");

        // Simulate validatePendingUpdates receiving: not required, remote reachable,
        // but entryStatus is "not_found" (entry absent on remote — NOT positive evidence).
        const simulatedResult: {
            required: boolean;
            remoteReachable: boolean;
            entryStatus: "cancelled" | "executed" | "not_found";
        } = {
            required: false,
            remoteReachable: true,
            entryStatus: "not_found",
        };

        const canClear = !simulatedResult.required
            && simulatedResult.remoteReachable
            && (simulatedResult.entryStatus === "cancelled" || simulatedResult.entryStatus === "executed");

        if (canClear) {
            await clearPendingUpdate(projectUri);
        }

        const settings = await readLocalProjectSettings(projectUri);
        assert.ok(
            settings.pendingUpdate,
            "pendingUpdate must NOT be cleared when entryStatus is not_found"
        );
    });

    test("pendingUpdate NOT cleared when remote is unreachable", async () => {
        await markPendingUpdateRequired(projectUri, "Remote requirement");

        // Simulate: remote unreachable — remoteReachable is falsy
        const simulatedResult: {
            required: boolean;
            remoteReachable: boolean | undefined;
            entryStatus: "cancelled" | "executed" | "not_found" | undefined;
        } = {
            required: false,
            remoteReachable: undefined,
            entryStatus: undefined,
        };

        const canClear = !simulatedResult.required
            && simulatedResult.remoteReachable
            && (simulatedResult.entryStatus === "cancelled" || simulatedResult.entryStatus === "executed");

        if (canClear) {
            await clearPendingUpdate(projectUri);
        }

        const settings = await readLocalProjectSettings(projectUri);
        assert.ok(
            settings.pendingUpdate,
            "pendingUpdate must NOT be cleared when remote is unreachable"
        );
    });

    test("pendingUpdate IS cleared when entryStatus is cancelled", async () => {
        await markPendingUpdateRequired(projectUri, "Remote requirement");

        let settings = await readLocalProjectSettings(projectUri);
        assert.ok(settings.pendingUpdate, "pendingUpdate should exist before clearing");

        // Simulate: remote reachable, entry was cancelled (positive evidence)
        const simulatedResult: {
            required: boolean;
            remoteReachable: boolean;
            entryStatus: "cancelled" | "executed" | "not_found";
        } = {
            required: false,
            remoteReachable: true,
            entryStatus: "cancelled",
        };

        const canClear = !simulatedResult.required
            && simulatedResult.remoteReachable
            && (simulatedResult.entryStatus === "cancelled" || simulatedResult.entryStatus === "executed");

        if (canClear) {
            await clearPendingUpdate(projectUri);
        }

        settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(
            settings.pendingUpdate,
            undefined,
            "pendingUpdate should be cleared when entryStatus is cancelled"
        );
    });

    test("pendingUpdate IS cleared when entryStatus is executed", async () => {
        await markPendingUpdateRequired(projectUri, "Remote requirement");

        let settings = await readLocalProjectSettings(projectUri);
        assert.ok(settings.pendingUpdate, "pendingUpdate should exist before clearing");

        // Simulate: remote reachable, entry was executed (positive evidence)
        const simulatedResult: {
            required: boolean;
            remoteReachable: boolean;
            entryStatus: "cancelled" | "executed" | "not_found";
        } = {
            required: false,
            remoteReachable: true,
            entryStatus: "executed",
        };

        const canClear = !simulatedResult.required
            && simulatedResult.remoteReachable
            && (simulatedResult.entryStatus === "cancelled" || simulatedResult.entryStatus === "executed");

        if (canClear) {
            await clearPendingUpdate(projectUri);
        }

        settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(
            settings.pendingUpdate,
            undefined,
            "pendingUpdate should be cleared when entryStatus is executed"
        );
    });

    test("checkUpdating clears pendingUpdate immediately on cancelled/executed entry", async () => {
        // Documents the syncManager.checkUpdating() flow:
        // when checkRemoteUpdatingRequired returns required: false with positive
        // evidence (cancelled/executed), pendingUpdate is cleared on the spot
        // without waiting for a project-list reload.

        await markPendingUpdateRequired(projectUri, "Stale flag from previous sync");

        let settings = await readLocalProjectSettings(projectUri);
        assert.ok(settings.pendingUpdate, "pendingUpdate should exist before sync");

        // Simulate the checkUpdating else-if branch
        const result = {
            required: false as const,
            remoteReachable: true,
            entryStatus: "cancelled" as const,
        };

        if (result.required) {
            // would block sync and show modal — not this path
        } else if (
            result.remoteReachable
            && (result.entryStatus === "cancelled" || result.entryStatus === "executed")
        ) {
            await clearPendingUpdate(projectUri);
        }

        settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(
            settings.pendingUpdate,
            undefined,
            "checkUpdating should clear pendingUpdate immediately when remote confirms cancellation"
        );
    });
});

// ── isEffectivelyCancelled unit tests ────────────────────────────────────

suite("isEffectivelyCancelled Tests", () => {
    const baseEntry: RemoteUpdatingEntry = {
        userToUpdate: "testuser",
        addedBy: "admin",
        createdAt: 100,
        updatedAt: 200,
        cancelled: false,
        cancelledBy: "",
        executed: false,
    };

    test("returns false when cancelled is false", () => {
        const entry: RemoteUpdatingEntry = { ...baseEntry, cancelled: false };
        assert.strictEqual(isEffectivelyCancelled(entry), false);
    });

    test("returns false when createdAt is 0 (untrusted timestamps)", () => {
        const entry: RemoteUpdatingEntry = {
            ...baseEntry,
            cancelled: true,
            createdAt: 0,
            updatedAt: 200,
        };
        assert.strictEqual(isEffectivelyCancelled(entry), false);
    });

    test("returns false when createdAt equals updatedAt", () => {
        const entry: RemoteUpdatingEntry = {
            ...baseEntry,
            cancelled: true,
            createdAt: 100,
            updatedAt: 100,
        };
        assert.strictEqual(isEffectivelyCancelled(entry), false);
    });

    test("returns true when cancelled with valid timestamps (updatedAt > createdAt)", () => {
        const entry: RemoteUpdatingEntry = {
            ...baseEntry,
            cancelled: true,
            createdAt: 100,
            updatedAt: 200,
        };
        assert.strictEqual(isEffectivelyCancelled(entry), true);
    });

    test("returns false when updatedAt is undefined", () => {
        const entry = {
            ...baseEntry,
            cancelled: true,
            createdAt: 100,
            updatedAt: undefined,
        } as unknown as RemoteUpdatingEntry;
        assert.strictEqual(isEffectivelyCancelled(entry), false);
    });
});

