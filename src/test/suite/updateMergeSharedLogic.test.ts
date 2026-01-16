import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { resolveConflictFile } from "../../projectManager/utils/merge/resolvers";
import { ConflictFile } from "../../projectManager/utils/merge/types";
import { buildConflictsFromDirectories } from "../../projectManager/utils/merge/directoryConflicts";

suite("Update + Sync shared merge engine", () => {
    test("resolveConflictFile preserves multiple update entries for same user with different createdAt", async function () {
        this.timeout(10000);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-multi-entries-"));
        try {
            const metadataPath = path.join(tempDir, "metadata.json");

            // Base: No entries
            const base = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: []
                }
            };

            // Ours (local): Empty (all entries come from remote)
            const ours = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: []
                }
            };

            // Theirs (remote): 3 entries with different createdAt timestamps
            const theirs = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: [
                        {
                            userToUpdate: "test0216d",
                            addedBy: "test0216",
                            createdAt: 1767418330866,
                            updatedAt: 1767426118877,
                            cancelled: true,
                            cancelledBy: "test0216",
                            executed: true
                        },
                        {
                            userToUpdate: "test0216d",
                            addedBy: "test0216",
                            createdAt: 1767428182082,
                            updatedAt: 1767429009610,
                            cancelled: true,
                            cancelledBy: "test0216",
                            executed: true
                        },
                        {
                            userToUpdate: "test0216d",
                            addedBy: "test0216",
                            createdAt: 1767428683671,
                            updatedAt: 1767429009610,
                            cancelled: false,
                            cancelledBy: "",
                            executed: true
                        }
                    ]
                }
            };

            const conflict: ConflictFile = {
                filepath: "metadata.json",
                ours: JSON.stringify(ours, null, 2),
                theirs: JSON.stringify(theirs, null, 2),
                base: JSON.stringify(base, null, 2),
                isDeleted: false,
                isNew: false,
            };

            await resolveConflictFile(conflict, tempDir, { refreshOursFromDisk: false });

            const merged = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
            
            // Should have ALL 3 entries (deduplicated by signature: userToUpdate + addedBy + createdAt)
            assert.strictEqual(merged.meta.initiateRemoteUpdatingFor.length, 3, "Should preserve all 3 distinct entries");
            
            // All should have userToUpdate field
            assert.ok(merged.meta.initiateRemoteUpdatingFor.every((e: any) => e.userToUpdate === "test0216d"));
            
            // All should have different createdAt timestamps
            const createdAtValues = merged.meta.initiateRemoteUpdatingFor.map((e: any) => e.createdAt).sort();
            assert.deepStrictEqual(createdAtValues, [1767418330866, 1767428182082, 1767428683671]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("resolveConflictFile handles missing createdAt by using updatedAt", async function () {
        this.timeout(10000);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-missing-created-"));
        try {
            const metadataPath = path.join(tempDir, "metadata.json");

            const base = {
                format: "scripture burrito",
                meta: { initiateRemoteUpdatingFor: [] }
            };

            // Entry missing createdAt (defensive case)
            const ours = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: [
                        {
                            userToUpdate: "user1",
                            addedBy: "admin",
                            // createdAt missing!
                            updatedAt: 5000,
                            executed: false,
                            deleted: false,
                            deletedBy: ""
                        }
                    ]
                }
            };

            const theirs = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: [
                        {
                            userToUpdate: "user2",
                            addedBy: "admin",
                            createdAt: 6000,
                            updatedAt: 6000,
                            executed: false,
                            deleted: false,
                            deletedBy: ""
                        }
                    ]
                }
            };

            const conflict: ConflictFile = {
                filepath: "metadata.json",
                ours: JSON.stringify(ours, null, 2),
                theirs: JSON.stringify(theirs, null, 2),
                base: JSON.stringify(base, null, 2),
                isDeleted: false,
                isNew: false,
            };

            await resolveConflictFile(conflict, tempDir, { refreshOursFromDisk: false });

            const merged = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
            
            // Should have both entries
            assert.strictEqual(merged.meta.initiateRemoteUpdatingFor.length, 2);
            
            // Entry with missing createdAt should now have it set to updatedAt
            const user1Entry = merged.meta.initiateRemoteUpdatingFor.find((e: any) => e.userToUpdate === "user1");
            assert.ok(user1Entry);
            assert.strictEqual(user1Entry.createdAt, 5000, "createdAt should be set from updatedAt");
            assert.strictEqual(user1Entry.updatedAt, 5000);
            
            // Other entry should be unchanged
            const user2Entry = merged.meta.initiateRemoteUpdatingFor.find((e: any) => e.userToUpdate === "user2");
            assert.ok(user2Entry);
            assert.strictEqual(user2Entry.createdAt, 6000);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // TODO: Remove this test in 0.17.0 when clearEntry feature is enabled by default
    test("resolveConflictFile clears entries marked with clearEntry: true (with permission and feature enabled)", async function () {
        this.timeout(10000);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-clear-"));
        
        // Mock permission check to return true (user has permission)
        const permModule = await import("../../utils/projectAdminPermissionChecker");
        const originalCheck = permModule.checkProjectAdminPermissions;
        const checkStub = () => Promise.resolve({ hasPermission: true, currentUser: "admin" });
        
        // Mock feature flag to enable clearEntry
        const flagModule = await import("../../utils/remoteUpdatingManager");
        const originalFlags = { ...flagModule.FEATURE_FLAGS };
        (flagModule.FEATURE_FLAGS as any).ENABLE_ENTRY_CLEARING = true;
        
        try {
            // Replace the function temporarily
            (permModule as any).checkProjectAdminPermissions = checkStub;
            
            const metadataPath = path.join(tempDir, "metadata.json");

            const base = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: [
                        {
                            userToUpdate: "user1",
                            addedBy: "admin",
                            createdAt: 1000,
                            updatedAt: 1000,
                            executed: true,
                            cancelled: false,
                            cancelledBy: ""
                        },
                        {
                            userToUpdate: "user2",
                            addedBy: "admin",
                            createdAt: 2000,
                            updatedAt: 2000,
                            executed: false,
                            cancelled: true,
                            cancelledBy: "admin"
                        }
                    ]
                }
            };

            // Local: Mark user1 for clearing (executed entry)
            const ours = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: [
                        {
                            userToUpdate: "user1",
                            addedBy: "admin",
                            createdAt: 1000,
                            updatedAt: 3000,
                            executed: true,
                            cancelled: false,
                            cancelledBy: "",
                            clearEntry: true  // ← Hard delete
                        },
                        {
                            userToUpdate: "user2",
                            addedBy: "admin",
                            createdAt: 2000,
                            updatedAt: 2000,
                            executed: false,
                            cancelled: true,
                            cancelledBy: "admin"
                        }
                    ]
                }
            };

            // Remote: Same as base
            const theirs = base;

            const conflict: ConflictFile = {
                filepath: "metadata.json",
                ours: JSON.stringify(ours, null, 2),
                theirs: JSON.stringify(theirs, null, 2),
                base: JSON.stringify(base, null, 2),
                isDeleted: false,
                isNew: false,
            };

            await resolveConflictFile(conflict, tempDir, { refreshOursFromDisk: false });

            const merged = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
            
            // Should only have user2 (user1 was cleared)
            assert.strictEqual(merged.meta.initiateRemoteUpdatingFor.length, 1);
            assert.strictEqual(merged.meta.initiateRemoteUpdatingFor[0].userToUpdate, "user2");
            
            // user1 should be completely gone (not just soft cancelled)
            const user1Entry = merged.meta.initiateRemoteUpdatingFor.find((e: any) => e.userToUpdate === "user1");
            assert.strictEqual(user1Entry, undefined, "user1 should be completely removed");
        } finally {
            // Restore original function and flags
            (permModule as any).checkProjectAdminPermissions = originalCheck;
            Object.assign(flagModule.FEATURE_FLAGS, originalFlags);
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // TODO: Remove this test in 0.17.0 when clearEntry feature is enabled by default
    test("resolveConflictFile preserves entries when user lacks clearEntry permission", async function () {
        this.timeout(10000);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-no-perm-"));
        
        // Mock permission check to return false (user lacks permission)
        const permModule = await import("../../utils/projectAdminPermissionChecker");
        const originalCheck = permModule.checkProjectAdminPermissions;
        const checkStub = () => Promise.resolve({ hasPermission: false, error: "Insufficient permissions", currentUser: "user" });
        
        // Mock feature flag to enable clearEntry
        const flagModule = await import("../../utils/remoteUpdatingManager");
        const originalFlags = { ...flagModule.FEATURE_FLAGS };
        (flagModule.FEATURE_FLAGS as any).ENABLE_ENTRY_CLEARING = true;
        
        try {
            // Replace the function temporarily
            (permModule as any).checkProjectAdminPermissions = checkStub;
            
            const metadataPath = path.join(tempDir, "metadata.json");

            const base = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: [
                        {
                            userToUpdate: "user1",
                            addedBy: "admin",
                            createdAt: 1000,
                            updatedAt: 1000,
                            executed: true,
                            cancelled: false,
                            cancelledBy: ""
                        }
                    ]
                }
            };

            // Local: Try to mark user1 for clearing (but user lacks permission)
            const ours = {
                format: "scripture burrito",
                meta: {
                    initiateRemoteUpdatingFor: [
                        {
                            userToUpdate: "user1",
                            addedBy: "admin",
                            createdAt: 1000,
                            updatedAt: 3000,
                            executed: true,
                            cancelled: false,
                            cancelledBy: "",
                            clearEntry: true  // ← Should be ignored
                        }
                    ]
                }
            };

            const theirs = base;

            const conflict: ConflictFile = {
                filepath: "metadata.json",
                ours: JSON.stringify(ours, null, 2),
                theirs: JSON.stringify(theirs, null, 2),
                base: JSON.stringify(base, null, 2),
                isDeleted: false,
                isNew: false,
            };

            await resolveConflictFile(conflict, tempDir, { refreshOursFromDisk: false });

            const merged = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
            
            // Should still have user1 (clearing was denied)
            assert.strictEqual(merged.meta.initiateRemoteUpdatingFor.length, 1);
            assert.strictEqual(merged.meta.initiateRemoteUpdatingFor[0].userToUpdate, "user1");
            
            // clearEntry flag should be removed
            assert.strictEqual(merged.meta.initiateRemoteUpdatingFor[0].clearEntry, undefined, "clearEntry flag should be removed when permission denied");
        } finally {
            // Restore original function and flags
            (permModule as any).checkProjectAdminPermissions = originalCheck;
            Object.assign(flagModule.FEATURE_FLAGS, originalFlags);
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("resolveConflictFile(refreshOursFromDisk=false) preserves provided ours content", async function () {
        this.timeout(10000);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-refresh-"));
        try {
            const filePath = path.join(tempDir, "test.txt");
            fs.writeFileSync(filePath, "disk-content", "utf8");

            const conflict: ConflictFile = {
                filepath: "test.txt",
                ours: "snapshot-content",
                theirs: "cloned-content",
                base: "cloned-content",
                isDeleted: false,
                isNew: false,
            };

            await resolveConflictFile(conflict, tempDir, { refreshOursFromDisk: false });

            const finalContent = fs.readFileSync(filePath, "utf8");
            assert.strictEqual(finalContent, "snapshot-content");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("resolveConflictFile(default refresh) re-reads disk and can override provided ours", async function () {
        this.timeout(10000);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-refresh-default-"));
        try {
            const filePath = path.join(tempDir, "test.txt");
            fs.writeFileSync(filePath, "disk-content", "utf8");

            const conflict: ConflictFile = {
                filepath: "test.txt",
                ours: "snapshot-content",
                theirs: "cloned-content",
                base: "cloned-content",
                isDeleted: false,
                isNew: false,
            };

            await resolveConflictFile(conflict, tempDir);

            const finalContent = fs.readFileSync(filePath, "utf8");
            assert.strictEqual(finalContent, "disk-content");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test("buildConflictsFromDirectories builds text conflicts, binary copies, and excludes .git/**", async function () {
        this.timeout(10000);

        const oursDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-ours-"));
        const theirsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-merge-theirs-"));
        try {
            // Theirs has a.txt and a .git folder (should be ignored anyway)
            fs.writeFileSync(path.join(theirsDir, "a.txt"), "theirs-a", "utf8");
            fs.mkdirSync(path.join(theirsDir, ".git"), { recursive: true });
            fs.writeFileSync(path.join(theirsDir, ".git", "config"), "theirs-git", "utf8");

            // Ours snapshot has a.txt (modified), b.txt (new), an image (binary), and a .git folder
            fs.writeFileSync(path.join(oursDir, "a.txt"), "ours-a", "utf8");
            fs.writeFileSync(path.join(oursDir, "b.txt"), "ours-b", "utf8");
            fs.writeFileSync(path.join(oursDir, "image.png"), Buffer.from([1, 2, 3]));
            // Generated databases should be skippable via exclude callback
            fs.writeFileSync(path.join(oursDir, "generated.sqlite"), "sqlite-bytes", "utf8");
            fs.mkdirSync(path.join(oursDir, ".git"), { recursive: true });
            fs.writeFileSync(path.join(oursDir, ".git", "config"), "ours-git", "utf8");

            const result = await buildConflictsFromDirectories({
                oursRoot: vscode.Uri.file(oursDir),
                theirsRoot: vscode.Uri.file(theirsDir),
                exclude: (rel) => rel.endsWith(".sqlite") || rel.endsWith(".sqlite3") || rel.endsWith(".db"),
                isBinary: (rel) => rel.endsWith(".png"),
            });

            // .git/** excluded
            assert.ok(!result.textConflicts.some((c) => c.filepath.startsWith(".git/")));
            assert.ok(!result.binaryCopies.some((c) => c.filepath.startsWith(".git/")));
            assert.ok(!result.textConflicts.some((c) => c.filepath.endsWith(".sqlite")));
            assert.ok(!result.binaryCopies.some((c) => c.filepath.endsWith(".sqlite")));

            // Binary copied, not merged
            assert.deepStrictEqual(
                result.binaryCopies.map((b) => b.filepath).sort(),
                ["image.png"]
            );
            assert.strictEqual(result.binaryCopies[0].content.length, 3);

            // Text conflicts include both a.txt and b.txt
            const byPath = new Map(result.textConflicts.map((c) => [c.filepath, c] as const));
            assert.ok(byPath.has("a.txt"));
            assert.ok(byPath.has("b.txt"));

            const a = byPath.get("a.txt")!;
            assert.strictEqual(a.ours, "ours-a");
            assert.strictEqual(a.theirs, "theirs-a");
            assert.strictEqual(a.base, "theirs-a");
            assert.strictEqual(a.isNew, false);
            assert.strictEqual(a.isDeleted, false);

            const b = byPath.get("b.txt")!;
            assert.strictEqual(b.ours, "ours-b");
            assert.strictEqual(b.theirs, "");
            assert.strictEqual(b.base, "");
            assert.strictEqual(b.isNew, true);
            assert.strictEqual(b.isDeleted, false);
        } finally {
            fs.rmSync(oursDir, { recursive: true, force: true });
            fs.rmSync(theirsDir, { recursive: true, force: true });
        }
    });
});

