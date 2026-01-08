import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MetadataManager } from "../../utils/metadataManager";
import { markUserAsUpdatedInRemoteList } from "../../utils/remoteUpdatingManager";

suite("Remote Updating - Deleted Entry Handling", () => {
    let tempDir: string;
    let projectUri: vscode.Uri;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-update-deleted-"));
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

    test("markUserAsUpdatedInRemoteList preserves deleted flag when marking as executed", async () => {
        const username = "testuser";
        const adminUser = "admin";
        const createdAt = Date.now() - 1000;

        // Setup: Create metadata with a deleted entry (admin cancelled it)
        const metadata = {
            format: "scripture burrito",
            meta: {
                generator: {
                    softwareName: "Codex Editor",
                    softwareVersion: "0.1.0",
                },
                initiateRemoteUpdatingFor: [
                    {
                        userToUpdate: username,
                        addedBy: adminUser,
                        createdAt,
                        updatedAt: createdAt,
                        deleted: true,  // Admin cancelled this
                        deletedBy: adminUser,
                        executed: false, // User hasn't completed yet
                    },
                ],
            },
        };

        // Write metadata
        const metadataPath = path.join(tempDir, "metadata.json");
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        // Mock git operations
        const gitModule = await import("isomorphic-git");
        sandbox.stub(gitModule, "listRemotes").resolves([
            { remote: "origin", url: "https://example.com/group/project.git" },
        ] as any);

        // Mock sync command (bypass actual sync)
        sandbox.stub(vscode.commands, "executeCommand").resolves();

        // Mock fetchRemoteMetadata to return empty (offline scenario)
        const remoteUpdatingManager = await import("../../utils/remoteUpdatingManager");
        sandbox.stub(remoteUpdatingManager, "fetchRemoteMetadata").resolves(null);

        // Execute: Mark user as updateed
        await markUserAsUpdatedInRemoteList(tempDir, username);

        // Verify: Entry should now be executed but still cancelled (normalized from deleted)
        const updatedMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        const entry = updatedMetadata.meta.initiateRemoteUpdatingFor[0];

        assert.strictEqual(entry.userToUpdate, username, "Username should match");
        assert.strictEqual(entry.executed, true, "Should be marked as executed");
        assert.strictEqual(entry.cancelled, true, "Should preserve cancelled flag");
        assert.strictEqual(entry.cancelledBy, adminUser, "Should preserve cancelledBy");
        assert.ok(entry.updatedAt > createdAt, "Should update timestamp");
    });

    test("markUserAsUpdatedInRemoteList works normally for non-deleted entry", async () => {
        const username = "testuser";
        const adminUser = "admin";
        const createdAt = Date.now() - 1000;

        // Setup: Create metadata with a normal (non-deleted) entry
        const metadata = {
            format: "scripture burrito",
            meta: {
                generator: {
                    softwareName: "Codex Editor",
                    softwareVersion: "0.1.0",
                },
                initiateRemoteUpdatingFor: [
                    {
                        userToUpdate: username,
                        addedBy: adminUser,
                        createdAt,
                        updatedAt: createdAt,
                        deleted: false,
                        deletedBy: "",
                        executed: false,
                    },
                ],
            },
        };

        // Write metadata
        const metadataPath = path.join(tempDir, "metadata.json");
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        // Mock git operations
        const gitModule = await import("isomorphic-git");
        sandbox.stub(gitModule, "listRemotes").resolves([
            { remote: "origin", url: "https://example.com/group/project.git" },
        ] as any);

        // Mock sync command
        sandbox.stub(vscode.commands, "executeCommand").resolves();

        // Mock fetchRemoteMetadata
        const remoteUpdatingManager = await import("../../utils/remoteUpdatingManager");
        sandbox.stub(remoteUpdatingManager, "fetchRemoteMetadata").resolves(null);

        // Execute: Mark user as updateed
        await markUserAsUpdatedInRemoteList(tempDir, username);

        // Verify: Entry should be executed and NOT cancelled (normalized from deleted)
        const updatedMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        const entry = updatedMetadata.meta.initiateRemoteUpdatingFor[0];

        assert.strictEqual(entry.executed, true, "Should be marked as executed");
        assert.strictEqual(entry.cancelled, false, "Should remain not cancelled");
        assert.ok(entry.updatedAt > createdAt, "Should update timestamp");
    });

    test("markUserAsUpdatedInRemoteList handles multiple entries correctly", async () => {
        const user1 = "testuser1";
        const user2 = "testuser2";
        const adminUser = "admin";
        const createdAt = Date.now() - 1000;

        // Setup: Multiple entries with different states
        const metadata = {
            format: "scripture burrito",
            meta: {
                generator: {
                    softwareName: "Codex Editor",
                    softwareVersion: "0.1.0",
                },
                initiateRemoteUpdatingFor: [
                    {
                        userToUpdate: user1,
                        addedBy: adminUser,
                        createdAt,
                        updatedAt: createdAt,
                        deleted: true,  // Deleted entry
                        deletedBy: adminUser,
                        executed: false,
                    },
                    {
                        userToUpdate: user2,
                        addedBy: adminUser,
                        createdAt,
                        updatedAt: createdAt,
                        deleted: false, // Active entry
                        deletedBy: "",
                        executed: false,
                    },
                ],
            },
        };

        // Write metadata
        const metadataPath = path.join(tempDir, "metadata.json");
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        // Mock git operations
        const gitModule = await import("isomorphic-git");
        sandbox.stub(gitModule, "listRemotes").resolves([
            { remote: "origin", url: "https://example.com/group/project.git" },
        ] as any);

        // Mock sync command
        sandbox.stub(vscode.commands, "executeCommand").resolves();

        // Mock fetchRemoteMetadata
        const remoteUpdatingManager = await import("../../utils/remoteUpdatingManager");
        sandbox.stub(remoteUpdatingManager, "fetchRemoteMetadata").resolves(null);

        // Execute: Mark user1 as updateed (the deleted one)
        await markUserAsUpdatedInRemoteList(tempDir, user1);

        // Verify: user1 should be cancelled+executed, user2 unchanged (normalized from deleted)
        const updatedMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        const entries = updatedMetadata.meta.initiateRemoteUpdatingFor;

        const entry1 = entries.find((e: any) => e.userToUpdate === user1);
        const entry2 = entries.find((e: any) => e.userToUpdate === user2);

        // User1 (was cancelled, now executed too)
        assert.ok(entry1, "Entry1 should exist");
        assert.strictEqual(entry1.executed, true, "User1 should be executed");
        assert.strictEqual(entry1.cancelled, true, "User1 should still be cancelled");

        // User2 (unchanged)
        assert.ok(entry2, "Entry2 should exist");
        assert.strictEqual(entry2.executed, false, "User2 should still be pending");
        assert.strictEqual(entry2.cancelled, false, "User2 should still be active");
    });

    test("markUserAsUpdatedInRemoteList does nothing if already executed", async () => {
        const username = "testuser";
        const adminUser = "admin";
        const originalUpdatedAt = Date.now() - 1000;

        // Setup: Entry already executed
        const metadata = {
            format: "scripture burrito",
            meta: {
                generator: {
                    softwareName: "Codex Editor",
                    softwareVersion: "0.1.0",
                },
                initiateRemoteUpdatingFor: [
                    {
                        userToUpdate: username,
                        addedBy: adminUser,
                        createdAt: originalUpdatedAt - 5000,
                        updatedAt: originalUpdatedAt,
                        deleted: false,
                        deletedBy: "",
                        executed: true, // Already executed
                    },
                ],
            },
        };

        // Write metadata
        const metadataPath = path.join(tempDir, "metadata.json");
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        // Mock git operations
        const gitModule = await import("isomorphic-git");
        sandbox.stub(gitModule, "listRemotes").resolves([
            { remote: "origin", url: "https://example.com/group/project.git" },
        ] as any);

        // Mock sync command - should NOT be called
        const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand");

        // Mock fetchRemoteMetadata
        const remoteUpdatingManager = await import("../../utils/remoteUpdatingManager");
        sandbox.stub(remoteUpdatingManager, "fetchRemoteMetadata").resolves(null);

        // Execute: Try to mark as updateed (should be no-op)
        await markUserAsUpdatedInRemoteList(tempDir, username);

        // Verify: Nothing should have changed, sync should not have been called
        assert.ok(
            executeCommandStub.notCalled,
            "Sync should not be triggered if already executed"
        );

        const updatedMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        const entry = updatedMetadata.meta.initiateRemoteUpdatingFor[0];

        assert.strictEqual(entry.executed, true, "Should still be executed");
        assert.strictEqual(
            entry.updatedAt,
            originalUpdatedAt,
            "Timestamp should be unchanged"
        );
    });
});

