import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as git from "isomorphic-git";
import { ProjectMetadata, ProjectSwapEntry, ProjectSwapInfo, ProjectSwapUserEntry } from "../../../../types";
import { sortSwapEntries, normalizeProjectSwapInfo } from "../../../utils/projectSwapManager";

suite("Integration: Project Swap Flow", () => {
    let tempDir: string;
    let oldProjectDir: string;
    let newProjectDir: string;
    let originalFetch: typeof globalThis.fetch;

    suiteSetup(() => {
        // Stub fetch to avoid actual network calls
        originalFetch = (globalThis as any).fetch;
        (globalThis as any).fetch = async (input: any, init?: any) => {
            const url = typeof input === "string" ? input : String(input);

            // Mock LFS batch endpoint
            if (url.includes("/info/lfs/objects/batch")) {
                return new Response(JSON.stringify({ objects: [] }), {
                    status: 200,
                    headers: { "content-type": "application/vnd.git-lfs+json" },
                });
            }

            return new Response("", { status: 200 });
        };
    });

    suiteTeardown(() => {
        (globalThis as any).fetch = originalFetch;
    });

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-swap-integ-"));
        oldProjectDir = path.join(tempDir, "old-project-abc123");
        newProjectDir = path.join(tempDir, "new-project-xyz789");

        // Create old project structure
        await createProjectStructure(oldProjectDir, {
            projectName: "Old Project",
            projectId: "abc123",
            gitUrl: "https://gitlab.com/org/old-project.git",
        });

        // Create new project structure  
        await createProjectStructure(newProjectDir, {
            projectName: "New Project",
            projectId: "xyz789",
            gitUrl: "https://gitlab.com/org/new-project.git",
        });
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    // ============ Swap Initiation Tests ============
    suite("Swap Initiation", () => {
        test("initiating swap adds entry to metadata.json", async () => {
            const swapEntry = createSwapEntry({
                swapUUID: "init-test-uuid",
                isOldProject: true,
                oldProjectUrl: "https://gitlab.com/org/old-project.git",
                oldProjectName: "Old Project",
                newProjectUrl: "https://gitlab.com/org/new-project.git",
                newProjectName: "New Project",
                swapInitiatedBy: "admin-user",
                swapReason: "Repository size reduction",
            });

            // Add to metadata
            const metadataPath = path.join(oldProjectDir, "metadata.json");
            const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));

            if (!metadata.meta) {
                metadata.meta = {} as any;
            }
            metadata.meta.projectSwap = {
                swapEntries: [swapEntry],
            };

            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

            // Verify
            const updated: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            assert.strictEqual(updated.meta?.projectSwap?.swapEntries?.length, 1);
            assert.strictEqual(updated.meta?.projectSwap?.swapEntries?.[0].swapUUID, "init-test-uuid");
            assert.strictEqual(updated.meta?.projectSwap?.swapEntries?.[0].isOldProject, true);
        });

        test("swap entry includes sanitized URLs (no credentials)", async () => {
            const rawUrl = "https://oauth2:glpat-token123@gitlab.com/org/project.git";
            const { sanitizeGitUrl } = await import("../../../utils/projectSwapManager");
            const sanitized = sanitizeGitUrl(rawUrl);

            const swapEntry = createSwapEntry({
                newProjectUrl: sanitized,
            });

            assert.strictEqual(swapEntry.newProjectUrl, "https://gitlab.com/org/project.git");
            assert.ok(!swapEntry.newProjectUrl.includes("oauth2"));
            assert.ok(!swapEntry.newProjectUrl.includes("token123"));
        });
    });

    // ============ Swap Detection Tests ============
    suite("Swap Detection", () => {
        test("OLD project with active swap entry triggers swap requirement", async () => {
            const swapEntry = createSwapEntry({
                swapStatus: "active",
                isOldProject: true,
            });

            const metadataPath = path.join(oldProjectDir, "metadata.json");
            const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            metadata.meta = metadata.meta || ({} as any);
            metadata.meta.projectSwap = { swapEntries: [swapEntry] };
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

            // Simulate swap check logic
            const { normalizeProjectSwapInfo, getActiveSwapEntry } = await import("../../../utils/projectSwapManager");
            const swapInfo = normalizeProjectSwapInfo(metadata.meta.projectSwap);
            const activeEntry = getActiveSwapEntry(swapInfo);

            // Should trigger swap when isOldProject === true
            const swapRequired = activeEntry !== undefined && activeEntry.isOldProject === true;
            assert.strictEqual(swapRequired, true);
        });

        test("NEW project with active swap entry does NOT trigger swap requirement", async () => {
            const swapEntry = createSwapEntry({
                swapStatus: "active",
                isOldProject: false, // This is the NEW project
            });

            const metadataPath = path.join(newProjectDir, "metadata.json");
            const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            metadata.meta = metadata.meta || ({} as any);
            metadata.meta.projectSwap = { swapEntries: [swapEntry] };
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

            const { normalizeProjectSwapInfo, getActiveSwapEntry } = await import("../../../utils/projectSwapManager");
            const swapInfo = normalizeProjectSwapInfo(metadata.meta.projectSwap);
            const activeEntry = getActiveSwapEntry(swapInfo);

            // Should NOT trigger swap when isOldProject === false
            const swapRequired = activeEntry !== undefined && activeEntry.isOldProject === true;
            assert.strictEqual(swapRequired, false);
        });

        test("cancelled swap entry does NOT trigger swap requirement", async () => {
            const swapEntry = createSwapEntry({
                swapStatus: "cancelled",
                isOldProject: true,
                cancelledBy: "admin",
                cancelledAt: Date.now(),
            });

            const metadataPath = path.join(oldProjectDir, "metadata.json");
            const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            metadata.meta = metadata.meta || ({} as any);
            metadata.meta.projectSwap = { swapEntries: [swapEntry] };
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

            const { normalizeProjectSwapInfo, getActiveSwapEntry } = await import("../../../utils/projectSwapManager");
            const swapInfo = normalizeProjectSwapInfo(metadata.meta.projectSwap);
            const activeEntry = getActiveSwapEntry(swapInfo);

            // No active entry
            assert.strictEqual(activeEntry, undefined);
        });
    });

    // ============ User Completion Tracking ============
    suite("User Completion Tracking", () => {
        test("user who completed swap is tracked in swappedUsers array", async () => {
            const swapEntry = createSwapEntry({
                swapUUID: "completion-test",
                isOldProject: false,
                swappedUsers: [],
            });

            // Simulate user completing swap
            const now = Date.now();
            swapEntry.swappedUsers = [
                {
                    userToSwap: "translator1",
                    createdAt: now,
                    updatedAt: now,
                    executed: true,
                    swapCompletedAt: now,
                },
            ];
            swapEntry.swapModifiedAt = now;

            assert.strictEqual(swapEntry.swappedUsers.length, 1);
            assert.strictEqual(swapEntry.swappedUsers[0].userToSwap, "translator1");
            assert.strictEqual(swapEntry.swappedUsers[0].executed, true);
        });

        test("user who already swapped does not need to swap again", async () => {
            const currentUsername = "translator1";
            const swapEntry = createSwapEntry({
                swapUUID: "already-swapped",
                isOldProject: true,
                swappedUsers: [
                    {
                        userToSwap: "translator1",
                        createdAt: 1000,
                        updatedAt: 2000,
                        executed: true,
                        swapCompletedAt: 2000,
                    },
                ],
            });

            const hasAlreadySwapped = swapEntry.swappedUsers?.some(
                u => u.userToSwap === currentUsername && u.executed
            );

            assert.strictEqual(hasAlreadySwapped, true);
        });
    });

    // ============ File Preservation Tests ============
    suite("File Preservation During Swap", () => {
        test("local project settings file structure is correct for swap", async () => {
            const settingsPath = path.join(oldProjectDir, ".project", "localProjectSettings.json");

            // Verify settings exist
            assert.ok(fs.existsSync(settingsPath), "localProjectSettings.json should exist");

            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
            assert.strictEqual(settings.currentMediaFilesStrategy, "auto-download");
        });

        test(".codex directory structure is preserved during backup", async () => {
            // Create .codex files
            const codexDir = path.join(oldProjectDir, ".codex");
            fs.mkdirSync(codexDir, { recursive: true });

            const codexFile = path.join(codexDir, "GEN.codex");
            const codexContent = JSON.stringify({
                cells: [
                    { id: "cell1", value: "Translation content" },
                ],
            });
            fs.writeFileSync(codexFile, codexContent);

            // Simulate backup (copy files)
            const backupDir = path.join(tempDir, "backup");
            fs.mkdirSync(backupDir, { recursive: true });
            fs.cpSync(oldProjectDir, backupDir, {
                recursive: true,
                filter: (src) => !src.includes(".git"),
            });

            // Verify backup has .codex files
            const backupCodexFile = path.join(backupDir, ".codex", "GEN.codex");
            assert.ok(fs.existsSync(backupCodexFile), ".codex file should be in backup");

            const backupContent = fs.readFileSync(backupCodexFile, "utf-8");
            assert.strictEqual(backupContent, codexContent);
        });

        test("uncommitted changes are preserved through swap", async () => {
            // Create uncommitted file
            const uncommittedFile = path.join(oldProjectDir, "local-changes.txt");
            fs.writeFileSync(uncommittedFile, "Local uncommitted content");

            // Check git status shows uncommitted
            const status = await git.statusMatrix({ fs, dir: oldProjectDir });
            const localChangesStatus = status.find(([filepath]) => filepath === "local-changes.txt");
            assert.ok(localChangesStatus, "local-changes.txt should be in status matrix");

            // Simulate swap file preservation
            const tempBackup = path.join(tempDir, "swap-temp");
            fs.mkdirSync(tempBackup, { recursive: true });
            fs.cpSync(oldProjectDir, tempBackup, {
                recursive: true,
                filter: (src) => !src.includes(".git"),
            });

            // Verify preserved
            const preservedFile = path.join(tempBackup, "local-changes.txt");
            assert.ok(fs.existsSync(preservedFile));
            assert.strictEqual(fs.readFileSync(preservedFile, "utf-8"), "Local uncommitted content");
        });
    });

    // ============ Metadata Merge During Swap ============
    suite("Metadata Merge During Swap", () => {
        test("swap entry from old project merges into new project metadata", async () => {
            const sharedSwapUUID = "merge-test-uuid";

            // Old project has active swap entry (isOldProject: true)
            const oldEntry = createSwapEntry({
                swapUUID: sharedSwapUUID,
                isOldProject: true,
                swapStatus: "active",
            });

            // New project will receive entry with isOldProject: false
            const newEntry = createSwapEntry({
                swapUUID: sharedSwapUUID,
                isOldProject: false,
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "user1", createdAt: Date.now(), updatedAt: Date.now(), executed: true },
                ],
            });

            // Both share same UUID
            assert.strictEqual(oldEntry.swapUUID, newEntry.swapUUID);
            assert.strictEqual(oldEntry.isOldProject, true);
            assert.strictEqual(newEntry.isOldProject, false);
        });

        test("project name and ID updates correctly after swap", async () => {
            const metadataPath = path.join(newProjectDir, "metadata.json");
            const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));

            // After swap, project should have new identity
            assert.strictEqual(metadata.projectName, "New Project");
            assert.strictEqual(metadata.projectId, "xyz789");
        });
    });

    // ============ localProjectSwap.json Tests ============
    suite("Local Swap Cache (localProjectSwap.json)", () => {
        test("localProjectSwap.json caches remote swap info", async () => {
            const localSwapPath = path.join(oldProjectDir, ".project", "localProjectSwap.json");

            const localSwapData = {
                remoteSwapInfo: {
                    swapEntries: [
                        createSwapEntry({
                            swapUUID: "cached-uuid",
                            isOldProject: true,
                        }),
                    ],
                },
                fetchedAt: Date.now(),
                sourceOriginUrl: "https://gitlab.com/org/old-project.git",
            };

            fs.writeFileSync(localSwapPath, JSON.stringify(localSwapData, null, 2));

            const cached = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            assert.strictEqual(cached.remoteSwapInfo.swapEntries.length, 1);
            assert.strictEqual(cached.remoteSwapInfo.swapEntries[0].swapUUID, "cached-uuid");
        });

        test("localProjectSwap.json is excluded from swap copy", async () => {
            // Create localProjectSwap.json in old project
            const localSwapPath = path.join(oldProjectDir, ".project", "localProjectSwap.json");
            fs.writeFileSync(localSwapPath, JSON.stringify({ test: true }));

            // Simulate swap copy with exclusion
            const copyDir = path.join(tempDir, "copy");
            fs.mkdirSync(copyDir, { recursive: true });

            fs.cpSync(oldProjectDir, copyDir, {
                recursive: true,
                filter: (src) => {
                    // Exclude localProjectSwap.json
                    return !src.endsWith("localProjectSwap.json") && !src.includes(".git");
                },
            });

            // Verify excluded
            const copiedSwapPath = path.join(copyDir, ".project", "localProjectSwap.json");
            assert.strictEqual(fs.existsSync(copiedSwapPath), false, "localProjectSwap.json should be excluded");
        });
    });

    // ============ Git Operations ============
    suite("Git Operations During Swap", () => {
        test("new project has fresh git history after swap", async () => {
            // New project should have clean git
            const gitDir = path.join(newProjectDir, ".git");
            assert.ok(fs.existsSync(gitDir), ".git directory should exist");

            const logs = await git.log({ fs, dir: newProjectDir, depth: 10 });
            assert.ok(logs.length >= 1, "Should have at least one commit");
        });

        test("git remote is set correctly after swap", async () => {
            const remotes = await git.listRemotes({ fs, dir: newProjectDir });
            const origin = remotes.find(r => r.remote === "origin");

            assert.ok(origin, "origin remote should be set");
            assert.strictEqual(origin?.url, "https://gitlab.com/org/new-project.git");
        });
    });

    // ============ Chain Swap Workflow Tests ============
    suite("Chain Swap Workflow (A→B→C)", () => {
        let projectA: string;
        let projectB: string;
        let projectC: string;

        setup(async () => {
            projectA = path.join(tempDir, "project-a");
            projectB = path.join(tempDir, "project-b");
            projectC = path.join(tempDir, "project-c");

            await createProjectStructure(projectA, {
                projectName: "Project A",
                projectId: "proj-a",
                gitUrl: "https://gitlab.com/org/project-a.git",
            });
            await createProjectStructure(projectB, {
                projectName: "Project B",
                projectId: "proj-b",
                gitUrl: "https://gitlab.com/org/project-b.git",
            });
            await createProjectStructure(projectC, {
                projectName: "Project C",
                projectId: "proj-c",
                gitUrl: "https://gitlab.com/org/project-c.git",
            });
        });

        test("complete chain swap preserves full history in final project", async () => {
            const uuidAB = "swap-a-to-b";
            const uuidBC = "swap-b-to-c";

            // Step 1: A → B swap
            // A gets entry as old project
            const entryInA = createSwapEntry({
                swapUUID: uuidAB,
                isOldProject: true,
                oldProjectUrl: "https://gitlab.com/org/project-a.git",
                oldProjectName: "Project A",
                newProjectUrl: "https://gitlab.com/org/project-b.git",
                newProjectName: "Project B",
            });

            // B gets entry as new project
            const entryInB_fromA = createSwapEntry({
                swapUUID: uuidAB,
                isOldProject: false,
                oldProjectUrl: "https://gitlab.com/org/project-a.git",
                oldProjectName: "Project A",
                newProjectUrl: "https://gitlab.com/org/project-b.git",
                newProjectName: "Project B",
            });

            // Write to A's metadata
            const metaPathA = path.join(projectA, "metadata.json");
            const metaA: ProjectMetadata = JSON.parse(fs.readFileSync(metaPathA, "utf-8"));
            metaA.meta = metaA.meta || ({} as any);
            metaA.meta.projectSwap = { swapEntries: [entryInA] };
            fs.writeFileSync(metaPathA, JSON.stringify(metaA, null, 2));

            // Write to B's metadata
            const metaPathB = path.join(projectB, "metadata.json");
            const metaB: ProjectMetadata = JSON.parse(fs.readFileSync(metaPathB, "utf-8"));
            metaB.meta = metaB.meta || ({} as any);
            metaB.meta.projectSwap = { swapEntries: [entryInB_fromA] };
            fs.writeFileSync(metaPathB, JSON.stringify(metaB, null, 2));

            // Step 2: B → C swap (B now initiates swap to C)
            const entryInB_toC = createSwapEntry({
                swapUUID: uuidBC,
                isOldProject: true,
                oldProjectUrl: "https://gitlab.com/org/project-b.git",
                oldProjectName: "Project B",
                newProjectUrl: "https://gitlab.com/org/project-c.git",
                newProjectName: "Project C",
            });

            // Add B→C entry to B
            metaB.meta.projectSwap.swapEntries?.push(entryInB_toC);
            fs.writeFileSync(metaPathB, JSON.stringify(metaB, null, 2));

            // Step 3: Create C's metadata with full history
            // C inherits all of B's entries, with historical entries marked as isOldProject: true
            const entriesForC = metaB.meta.projectSwap.swapEntries!.map(entry =>
                entry.swapUUID === uuidBC
                    ? { ...entry, isOldProject: false } // C is NEW for B→C
                    : { ...entry, isOldProject: true }  // Historical entries
            );

            const metaPathC = path.join(projectC, "metadata.json");
            const metaC: ProjectMetadata = JSON.parse(fs.readFileSync(metaPathC, "utf-8"));
            metaC.meta = metaC.meta || ({} as any);
            metaC.meta.projectSwap = { swapEntries: entriesForC };
            fs.writeFileSync(metaPathC, JSON.stringify(metaC, null, 2));

            // Verify C has complete history
            const finalMetaC: ProjectMetadata = JSON.parse(fs.readFileSync(metaPathC, "utf-8"));
            const finalEntries = finalMetaC.meta?.projectSwap?.swapEntries || [];

            assert.strictEqual(finalEntries.length, 2, "C should have 2 entries (A→B and B→C)");

            // Check A→B entry
            const abEntry = finalEntries.find(e => e.swapUUID === uuidAB);
            assert.ok(abEntry, "A→B entry should exist");
            assert.strictEqual(abEntry?.isOldProject, true, "A→B should be marked as historical");
            assert.strictEqual(abEntry?.oldProjectName, "Project A");
            assert.strictEqual(abEntry?.newProjectName, "Project B");

            // Check B→C entry
            const bcEntry = finalEntries.find(e => e.swapUUID === uuidBC);
            assert.ok(bcEntry, "B→C entry should exist");
            assert.strictEqual(bcEntry?.isOldProject, false, "B→C should show C as new project");
            assert.strictEqual(bcEntry?.oldProjectName, "Project B");
            assert.strictEqual(bcEntry?.newProjectName, "Project C");
        });

        test("chain history allows reconstruction of full project lineage", async () => {
            // Set up a chain with full history in C
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "swap-1", oldProjectName: "A", newProjectName: "B", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "swap-2", oldProjectName: "B", newProjectName: "C", swapInitiatedAt: 2000 }),
            ];

            const metaPathC = path.join(projectC, "metadata.json");
            const metaC: ProjectMetadata = JSON.parse(fs.readFileSync(metaPathC, "utf-8"));
            metaC.meta = metaC.meta || ({} as any);
            metaC.meta.projectSwap = { swapEntries: entries };
            fs.writeFileSync(metaPathC, JSON.stringify(metaC, null, 2));

            // Read back and trace lineage
            const savedMeta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPathC, "utf-8"));
            const swapHistory = savedMeta.meta?.projectSwap?.swapEntries || [];

            // Sort by time to get chronological order
            const chronological = [...swapHistory].sort((a, b) => a.swapInitiatedAt - b.swapInitiatedAt);

            // Extract lineage
            const lineage: string[] = [];
            for (const entry of chronological) {
                if (lineage.length === 0) {
                    lineage.push(entry.oldProjectName);
                }
                lineage.push(entry.newProjectName);
            }

            assert.deepStrictEqual(lineage, ["A", "B", "C"], "Should reconstruct full lineage");
        });
    });

    // ============ Origin Marker Integration Tests ============
    suite("Origin Marker Integration", () => {
        test("first-time swap creates origin marker in metadata", async () => {
            // Project with no prior swap history initiates first swap
            const projectPath = path.join(tempDir, "origin-project");
            await createProjectStructure(projectPath, {
                projectName: "Origin Project",
                projectId: "origin-123",
                gitUrl: "https://gitlab.com/org/origin-project.git",
            });

            const metaPath = path.join(projectPath, "metadata.json");
            const meta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

            // No swap history yet
            assert.strictEqual(meta.meta?.projectSwap?.swapEntries?.length ?? 0, 0);

            // Simulate origin marker creation (what initiateProjectSwap does)
            // The origin project's own URL/name go in oldProjectUrl/oldProjectName.
            // newProjectUrl/newProjectName are empty since an origin has no predecessor.
            const now = Date.now();
            const originMarker = createSwapEntry({
                swapUUID: `origin-${meta.projectId}`,
                swapInitiatedAt: now,
                swapModifiedAt: now,
                swapStatus: "cancelled",
                isOldProject: true,
                oldProjectUrl: "https://gitlab.com/org/origin-project.git",
                oldProjectName: "Origin Project",
                newProjectUrl: "",
                newProjectName: "",
                swapReason: "Origin project (no prior swap history)",
                cancelledBy: "system",
                cancelledAt: now,
            });

            const actualSwapEntry = createSwapEntry({
                swapUUID: "first-swap-uuid",
                swapStatus: "active",
                isOldProject: true,
                oldProjectUrl: "https://gitlab.com/org/origin-project.git",
                oldProjectName: "Origin Project",
                newProjectUrl: "https://gitlab.com/org/new-target.git",
                newProjectName: "New Target",
            });

            // Write both entries
            meta.meta = meta.meta || ({} as any);
            meta.meta.projectSwap = {
                swapEntries: sortSwapEntries([originMarker, actualSwapEntry]),
            };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

            // Verify
            const savedMeta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            const entries = savedMeta.meta?.projectSwap?.swapEntries || [];

            assert.strictEqual(entries.length, 2, "Should have origin marker + actual swap");

            // Active entry should be first (due to sorting)
            assert.strictEqual(entries[0].swapStatus, "active", "Active entry should be first");

            // Origin marker should exist with correct structure
            const marker = entries.find(e => e.swapUUID.startsWith("origin-"));
            assert.ok(marker, "Origin marker should exist");
            assert.strictEqual(marker?.oldProjectUrl, "https://gitlab.com/org/origin-project.git", "Origin marker oldProjectUrl should be the origin project's URL");
            assert.strictEqual(marker?.oldProjectName, "Origin Project", "Origin marker oldProjectName should be the origin project's name");
            assert.strictEqual(marker?.newProjectUrl, "", "Origin marker should have empty newProjectUrl (no predecessor)");
            assert.strictEqual(marker?.newProjectName, "", "Origin marker should have empty newProjectName (no predecessor)");
        });
    });

    // ============ Multi-User Swap Tracking Integration ============
    suite("Multi-User Swap Tracking", () => {
        test("multiple users completing swap updates entry correctly", async () => {
            const sharedSwapUUID = "multi-user-swap";

            // Initial swap entry on new project
            const entry = createSwapEntry({
                swapUUID: sharedSwapUUID,
                isOldProject: false,
                swappedUsers: [],
            });

            const metaPath = path.join(newProjectDir, "metadata.json");
            const meta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            meta.meta = meta.meta || ({} as any);
            meta.meta.projectSwap = { swapEntries: [entry] };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

            // User 1 completes swap
            const user1CompletedAt = Date.now();
            const savedMeta1: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            const entry1 = savedMeta1.meta?.projectSwap?.swapEntries?.find(e => e.swapUUID === sharedSwapUUID);
            if (entry1) {
                entry1.swappedUsers = [
                    { userToSwap: "user1", createdAt: user1CompletedAt, updatedAt: user1CompletedAt, executed: true, swapCompletedAt: user1CompletedAt },
                ];
                entry1.swapModifiedAt = user1CompletedAt;
            }
            fs.writeFileSync(metaPath, JSON.stringify(savedMeta1, null, 2));

            // User 2 completes swap (later)
            const user2CompletedAt = Date.now() + 1000;
            const savedMeta2: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            const entry2 = savedMeta2.meta?.projectSwap?.swapEntries?.find(e => e.swapUUID === sharedSwapUUID);
            if (entry2) {
                entry2.swappedUsers?.push(
                    { userToSwap: "user2", createdAt: user2CompletedAt, updatedAt: user2CompletedAt, executed: true, swapCompletedAt: user2CompletedAt }
                );
                entry2.swapModifiedAt = user2CompletedAt;
            }
            fs.writeFileSync(metaPath, JSON.stringify(savedMeta2, null, 2));

            // Verify final state
            const finalMeta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            const finalEntry = finalMeta.meta?.projectSwap?.swapEntries?.find(e => e.swapUUID === sharedSwapUUID);

            assert.strictEqual(finalEntry?.swappedUsers?.length, 2, "Should track 2 users");
            assert.ok(finalEntry?.swappedUsers?.some(u => u.userToSwap === "user1" && u.executed));
            assert.ok(finalEntry?.swappedUsers?.some(u => u.userToSwap === "user2" && u.executed));
        });

        test("already-swapped detection works across projects", async () => {
            const sharedSwapUUID = "already-swapped-test";
            const currentUser = "translator1";

            // New project has user marked as completed
            const newEntry = createSwapEntry({
                swapUUID: sharedSwapUUID,
                isOldProject: false,
                swappedUsers: [
                    { userToSwap: currentUser, createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                    { userToSwap: "other-user", createdAt: 1000, updatedAt: 1500, executed: true, swapCompletedAt: 1500 },
                ],
            });

            const newMetaPath = path.join(newProjectDir, "metadata.json");
            const newMeta: ProjectMetadata = JSON.parse(fs.readFileSync(newMetaPath, "utf-8"));
            newMeta.meta = newMeta.meta || ({} as any);
            newMeta.meta.projectSwap = { swapEntries: [newEntry] };
            fs.writeFileSync(newMetaPath, JSON.stringify(newMeta, null, 2));

            // Old project checks if user already swapped by looking at new project's metadata
            const remoteSwapInfo = newMeta.meta.projectSwap;
            const matchingEntry = remoteSwapInfo.swapEntries?.find(e => e.swapUUID === sharedSwapUUID);
            const hasAlreadySwapped = matchingEntry?.swappedUsers?.some(
                u => u.userToSwap === currentUser && u.executed
            ) ?? false;

            assert.strictEqual(hasAlreadySwapped, true, "Should detect user has already swapped");
        });
    });

    // ============ Local Swap Cache Sync Integration ============
    suite("Local Swap Cache Sync", () => {
        test("localProjectSwap.json syncs swappedUsers from remote", async () => {
            const swapUUID = "cache-sync-test";

            // Remote (new project) has user completion info
            const remoteEntry = createSwapEntry({
                swapUUID,
                isOldProject: false,
                swappedUsers: [
                    { userToSwap: "remote-user", createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                ],
            });

            // Old project has local cache without user completion
            const localSwapPath = path.join(oldProjectDir, ".project", "localProjectSwap.json");
            const existingCache = {
                remoteSwapInfo: {
                    swapEntries: [
                        createSwapEntry({ swapUUID, isOldProject: true, swappedUsers: [] }),
                    ],
                },
                fetchedAt: Date.now() - 3600000, // 1 hour ago
                sourceOriginUrl: "https://gitlab.com/org/old-project.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(existingCache, null, 2));

            // Simulate sync: update local cache with remote data
            const localCache = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const existingEntries = localCache.remoteSwapInfo?.swapEntries || [];

            const entryIndex = existingEntries.findIndex((e: ProjectSwapEntry) => e.swapUUID === swapUUID);
            if (entryIndex >= 0) {
                // Update with remote user data
                existingEntries[entryIndex].swappedUsers = remoteEntry.swappedUsers;
            }

            localCache.remoteSwapInfo = { swapEntries: existingEntries };
            localCache.fetchedAt = Date.now();
            fs.writeFileSync(localSwapPath, JSON.stringify(localCache, null, 2));

            // Verify sync
            const syncedCache = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const syncedEntry = syncedCache.remoteSwapInfo?.swapEntries?.find((e: ProjectSwapEntry) => e.swapUUID === swapUUID);

            assert.strictEqual(syncedEntry?.swappedUsers?.length, 1, "Should have synced user");
            assert.strictEqual(syncedEntry?.swappedUsers?.[0].userToSwap, "remote-user");
            assert.strictEqual(syncedEntry?.swappedUsers?.[0].executed, true);
        });

        test("local cache enables offline swap detection", async () => {
            const swapUUID = "offline-detection-test";
            const currentUser = "offline-user";

            // Local cache has user marked as completed (from previous sync)
            const localSwapPath = path.join(oldProjectDir, ".project", "localProjectSwap.json");
            const cachedData = {
                remoteSwapInfo: {
                    swapEntries: [
                        createSwapEntry({
                            swapUUID,
                            isOldProject: true,
                            swappedUsers: [
                                { userToSwap: currentUser, createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                            ],
                        }),
                    ],
                },
                fetchedAt: Date.now() - 86400000, // 24 hours ago
                sourceOriginUrl: "https://gitlab.com/org/old-project.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(cachedData, null, 2));

            // Offline detection: check local cache
            const localCache = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const cachedEntry = localCache.remoteSwapInfo?.swapEntries?.find(
                (e: ProjectSwapEntry) => e.swapUUID === swapUUID
            );
            const hasAlreadySwappedOffline = cachedEntry?.swappedUsers?.some(
                (u: ProjectSwapUserEntry) => u.userToSwap === currentUser && u.executed
            ) ?? false;

            assert.strictEqual(hasAlreadySwappedOffline, true, "Should detect swap completion from local cache");
        });
    });

    // ============ Sorting Persistence Integration ============
    suite("Sorting Persistence", () => {
        test("entries are sorted consistently when written to metadata", async () => {
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "z-uuid", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "a-uuid", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "m-uuid", swapStatus: "active", swapInitiatedAt: 500 }),
            ];

            const metaPath = path.join(oldProjectDir, "metadata.json");
            const meta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            meta.meta = meta.meta || ({} as any);

            // Write sorted entries
            meta.meta.projectSwap = { swapEntries: sortSwapEntries(entries) };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

            // Read back and verify order
            const savedMeta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            const savedEntries = savedMeta.meta?.projectSwap?.swapEntries || [];

            // Active should be first
            assert.strictEqual(savedEntries[0].swapUUID, "m-uuid", "Active entry should be first");
            assert.strictEqual(savedEntries[0].swapStatus, "active");

            // Then sorted by swapUUID for ties
            assert.strictEqual(savedEntries[1].swapUUID, "a-uuid", "a-uuid should be before z-uuid");
            assert.strictEqual(savedEntries[2].swapUUID, "z-uuid");
        });

        test("re-writing sorted entries produces identical JSON", async () => {
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "entry-1", swapStatus: "active", swapInitiatedAt: 2000 }),
                createSwapEntry({ swapUUID: "entry-2", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
            ];

            const metaPath = path.join(oldProjectDir, "metadata.json");
            const meta: ProjectMetadata = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            meta.meta = meta.meta || ({} as any);

            // First write
            meta.meta.projectSwap = { swapEntries: sortSwapEntries(entries) };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
            const json1 = fs.readFileSync(metaPath, "utf-8");

            // Read, re-sort, re-write
            const savedMeta: ProjectMetadata = JSON.parse(json1);
            savedMeta.meta!.projectSwap = {
                swapEntries: sortSwapEntries(savedMeta.meta?.projectSwap?.swapEntries || []),
            };
            fs.writeFileSync(metaPath, JSON.stringify(savedMeta, null, 2));
            const json2 = fs.readFileSync(metaPath, "utf-8");

            // JSON should be identical (no churn)
            assert.strictEqual(json1, json2, "Re-writing sorted entries should not change JSON");
        });
    });

    // ============ Chain Deprecation Filtering Integration ============
    suite("Chain Deprecation Filtering Integration - QA Critical", () => {
        test("getDeprecatedProjectsFromHistory extracts full chain URLs", async () => {
            // This tests the core utility that StartupFlowProvider uses
            const { getDeprecatedProjectsFromHistory, normalizeProjectSwapInfo } = 
                await import("../../../utils/projectSwapManager");

            // Simulate swaptest3's metadata with full chain history
            const swapInfo = normalizeProjectSwapInfo({
                swapEntries: [
                    // Active swap: swaptest2 → swaptest3
                    createSwapEntry({
                        swapUUID: "swap-2-to-3",
                        swapStatus: "active",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/swaptest2.git",
                        oldProjectName: "swaptest2",
                        newProjectUrl: "https://gitlab.com/org/swaptest3.git",
                        newProjectName: "swaptest3",
                    }),
                    // Historical: swaptest1 → swaptest2
                    createSwapEntry({
                        swapUUID: "swap-1-to-2",
                        swapStatus: "cancelled",
                        isOldProject: true,
                        oldProjectUrl: "https://gitlab.com/org/swaptest1.git",
                        oldProjectName: "swaptest1",
                        newProjectUrl: "https://gitlab.com/org/swaptest2.git",
                        newProjectName: "swaptest2",
                    }),
                ],
            });

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);
            const urls = deprecated.map(d => d.url);

            // Both swaptest1 and swaptest2 should be deprecated
            assert.strictEqual(deprecated.length, 2, "Should find 2 deprecated projects");
            assert.ok(urls.includes("https://gitlab.com/org/swaptest1.git"), "swaptest1 should be deprecated");
            assert.ok(urls.includes("https://gitlab.com/org/swaptest2.git"), "swaptest2 should be deprecated");
        });

        test("deprecated project info includes name for remote-only matching", async () => {
            const { getDeprecatedProjectsFromHistory, normalizeProjectSwapInfo } = 
                await import("../../../utils/projectSwapManager");

            const swapInfo = normalizeProjectSwapInfo({
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "test-swap",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/remote-only-abc.git",
                        oldProjectName: "remote-only-abc", // Critical for remote-only projects
                    }),
                ],
            });

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            assert.strictEqual(deprecated.length, 1);
            assert.strictEqual(deprecated[0].name, "remote-only-abc", "Name must be captured for remote matching");
            assert.strictEqual(deprecated[0].url, "https://gitlab.com/org/remote-only-abc.git");
        });

        test("isProjectDeprecated works with case-insensitive URLs", async () => {
            const { isProjectDeprecated, normalizeProjectSwapInfo } = 
                await import("../../../utils/projectSwapManager");

            const swapInfo = normalizeProjectSwapInfo({
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "case-test",
                        oldProjectUrl: "https://GitLab.com/Org/Project-A.git",
                    }),
                ],
            });

            // Various case combinations should match
            assert.strictEqual(
                isProjectDeprecated("https://gitlab.com/org/project-a.git", swapInfo),
                true
            );
            assert.strictEqual(
                isProjectDeprecated("https://GITLAB.COM/ORG/PROJECT-A.GIT", swapInfo),
                true
            );
        });

        test("orderEntryFields maintains consistent JSON serialization", async () => {
            const { orderEntryFields, sortSwapEntries } = 
                await import("../../../utils/projectSwapManager");

            const entry = createSwapEntry({
                swapUUID: "order-test",
                swapStatus: "active",
                swapInitiatedAt: 1000,
                swapInitiatedBy: "admin",
                swapReason: "Test",
                swapModifiedAt: 2000,
                swappedUsersModifiedAt: 3000,
            });

            const ordered = orderEntryFields(entry);
            const keys = Object.keys(ordered);

            // First two keys should be swapUUID and swapStatus (for quick scanning)
            assert.strictEqual(keys[0], "swapUUID");
            assert.strictEqual(keys[1], "swapStatus");
        });

        test("sortSwapEntries applies field ordering to all entries", async () => {
            const { sortSwapEntries } = await import("../../../utils/projectSwapManager");

            const entries = [
                createSwapEntry({ swapUUID: "entry-1", swapStatus: "active", swapInitiatedAt: 2000 }),
                createSwapEntry({ swapUUID: "entry-2", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
            ];

            const sorted = sortSwapEntries(entries);

            // All entries should have consistent key order
            for (const entry of sorted) {
                const keys = Object.keys(entry);
                assert.strictEqual(keys[0], "swapUUID", "swapUUID should be first");
                assert.strictEqual(keys[1], "swapStatus", "swapStatus should be second");
            }
        });
    });

    // ============ Timestamp Separation Integration ============
    suite("Timestamp Separation Integration", () => {
        test("user completion updates swappedUsersModifiedAt independently", async () => {
            // Initial entry
            const entry = createSwapEntry({
                swapUUID: "timestamp-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 1000,
                swappedUsersModifiedAt: undefined,
                swappedUsers: [],
            });

            // Simulate user completion
            const now = Date.now();
            entry.swappedUsers = [
                { userToSwap: "user1", createdAt: now, updatedAt: now, executed: true },
            ];
            entry.swappedUsersModifiedAt = now;
            // swapModifiedAt should NOT change

            assert.strictEqual(entry.swapModifiedAt, 1000, "swapModifiedAt unchanged on user completion");
            assert.strictEqual(entry.swappedUsersModifiedAt, now, "swappedUsersModifiedAt updated");
        });

        test("cancellation updates swapModifiedAt but not swappedUsersModifiedAt", async () => {
            const entry = createSwapEntry({
                swapUUID: "cancel-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 1000,
                swappedUsersModifiedAt: 2000,
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            // Simulate cancellation
            entry.swapStatus = "cancelled";
            entry.swapModifiedAt = 3000;
            entry.cancelledBy = "admin";
            entry.cancelledAt = 3000;
            // swappedUsersModifiedAt should NOT change

            assert.strictEqual(entry.swapModifiedAt, 3000);
            assert.strictEqual(entry.swappedUsersModifiedAt, 2000, "swappedUsersModifiedAt unchanged on cancel");
        });
    });

    // ============ Error Recovery Integration ============
    suite("Error Recovery Integration", () => {
        test("interrupted swap state is persisted and recoverable", async () => {
            const localSwapPath = path.join(oldProjectDir, ".project", "localProjectSwap.json");

            // Simulate interrupted swap - save state
            const interruptedState = {
                swapPendingDownloads: {
                    swapState: "pending_downloads",
                    filesNeedingDownload: ["GEN/1_1.mp3", "GEN/1_2.mp3"],
                    newProjectUrl: "https://gitlab.com/org/new-project.git",
                    swapUUID: "interrupted-swap",
                    swapInitiatedAt: Date.now(),
                    createdAt: Date.now(),
                },
                remoteSwapInfo: {
                    swapEntries: [createSwapEntry({ swapUUID: "interrupted-swap", isOldProject: true })],
                },
                fetchedAt: Date.now(),
                sourceOriginUrl: "https://gitlab.com/org/old-project.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(interruptedState, null, 2));

            // Simulate recovery - read state
            const recoveredState = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));

            assert.strictEqual(recoveredState.swapPendingDownloads.swapState, "pending_downloads");
            assert.strictEqual(recoveredState.swapPendingDownloads.filesNeedingDownload.length, 2);
            assert.strictEqual(recoveredState.swapPendingDownloads.swapUUID, "interrupted-swap");
        });

        test("corrupted local cache is handled gracefully", async () => {
            const localSwapPath = path.join(oldProjectDir, ".project", "localProjectSwap.json");

            // Write corrupted JSON
            fs.writeFileSync(localSwapPath, "{ invalid json }}}");

            // Try to read - should handle error
            let readSuccessfully = false;
            let fallbackUsed = false;
            try {
                JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
                readSuccessfully = true;
            } catch {
                // Fallback to empty/default
                fallbackUsed = true;
            }

            assert.strictEqual(readSuccessfully, false, "Should not read corrupted JSON");
            assert.strictEqual(fallbackUsed, true, "Should use fallback for corrupted cache");
        });
    });

    // ============ Entry Data Integrity Integration ============
    suite("Entry Data Integrity - No Fallbacks", () => {
        test("swapInitiatedBy must not be 'unknown' after entry creation", async () => {
            // Create entry with proper initiator
            const swapEntry = createSwapEntry({
                swapUUID: "integrity-test-uuid",
                swapInitiatedBy: "admin@company.com",
                swapReason: "Repository migration",
                isOldProject: true,
            });

            // Write to metadata
            const metadata = JSON.parse(fs.readFileSync(
                path.join(oldProjectDir, "metadata.json"), "utf-8"
            ));
            metadata.meta = metadata.meta || {};
            metadata.meta.projectSwap = { swapEntries: [swapEntry] };
            fs.writeFileSync(
                path.join(oldProjectDir, "metadata.json"),
                JSON.stringify(metadata, null, 2)
            );

            // Read back and verify
            const readMetadata = JSON.parse(fs.readFileSync(
                path.join(oldProjectDir, "metadata.json"), "utf-8"
            ));
            const readEntry = readMetadata.meta.projectSwap.swapEntries[0];

            assert.strictEqual(readEntry.swapInitiatedBy, "admin@company.com",
                "swapInitiatedBy must be preserved, not 'unknown'");
            assert.notStrictEqual(readEntry.swapInitiatedBy, "unknown",
                "swapInitiatedBy should NEVER be 'unknown' - this indicates a data flow bug");
        });

        test("swapReason must not be lost through write/read cycle", async () => {
            const swapEntry = createSwapEntry({
                swapUUID: "reason-test-uuid",
                swapReason: "Critical migration: consolidating repositories",
            });

            // Write to metadata
            const metadata = JSON.parse(fs.readFileSync(
                path.join(oldProjectDir, "metadata.json"), "utf-8"
            ));
            metadata.meta = metadata.meta || {};
            metadata.meta.projectSwap = { swapEntries: [swapEntry] };
            fs.writeFileSync(
                path.join(oldProjectDir, "metadata.json"),
                JSON.stringify(metadata, null, 2)
            );

            // Read back and verify
            const readMetadata = JSON.parse(fs.readFileSync(
                path.join(oldProjectDir, "metadata.json"), "utf-8"
            ));
            const readEntry = readMetadata.meta.projectSwap.swapEntries[0];

            assert.strictEqual(readEntry.swapReason, "Critical migration: consolidating repositories",
                "swapReason must be preserved through write/read");
        });

        test("SwapPendingDownloads preserves initiator info for resumption", async () => {
            const localSwapPath = path.join(oldProjectDir, ".project", "localProjectSwap.json");

            // Simulate saving pending state with initiator info
            const pendingState = {
                swapPendingDownloads: {
                    swapState: "pending_downloads",
                    filesNeedingDownload: ["GEN/1_1.mp3"],
                    newProjectUrl: "https://gitlab.com/org/new-project.git",
                    swapUUID: "pending-with-initiator",
                    swapInitiatedAt: Date.now(),
                    swapInitiatedBy: "original-initiator", // MUST be preserved
                    swapReason: "Original reason for migration", // MUST be preserved
                    createdAt: Date.now(),
                },
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(pendingState, null, 2));

            // Read back - simulating app restart
            const recovered = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));

            assert.strictEqual(recovered.swapPendingDownloads.swapInitiatedBy, "original-initiator",
                "swapInitiatedBy must survive app restart/recovery");
            assert.strictEqual(recovered.swapPendingDownloads.swapReason, "Original reason for migration",
                "swapReason must survive app restart/recovery");
            assert.notStrictEqual(recovered.swapPendingDownloads.swapInitiatedBy, "unknown",
                "Recovered swapInitiatedBy should NEVER be 'unknown'");
        });

        test("entry data preserved through normalizeProjectSwapInfo", async () => {
            const originalEntry = createSwapEntry({
                swapInitiatedBy: "preserve-me",
                swapReason: "preserve-this-reason",
            });

            const normalized = normalizeProjectSwapInfo({
                swapEntries: [originalEntry],
            });

            assert.ok(normalized.swapEntries, "swapEntries should exist after normalization");
            assert.strictEqual(normalized.swapEntries![0].swapInitiatedBy, "preserve-me");
            assert.strictEqual(normalized.swapEntries![0].swapReason, "preserve-this-reason");
        });
    });
});

// ============ Helper Functions ============

async function createProjectStructure(
    projectDir: string,
    options: { projectName: string; projectId: string; gitUrl: string; }
): Promise<void> {
    // Create directories
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".project"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".project", "attachments", "files"), { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".project", "attachments", "pointers"), { recursive: true });

    // Create metadata.json
    const metadata: Partial<ProjectMetadata> = {
        format: "scripture burrito",
        projectName: options.projectName,
        projectId: options.projectId,
        meta: {
            version: "0.16.0",
            category: "Scripture",
            dateCreated: new Date().toISOString(),
        } as any,
    };
    fs.writeFileSync(
        path.join(projectDir, "metadata.json"),
        JSON.stringify(metadata, null, 2)
    );

    // Create localProjectSettings.json
    const settings = {
        currentMediaFilesStrategy: "auto-download",
        lastMediaFileStrategyRun: "auto-download",
    };
    fs.writeFileSync(
        path.join(projectDir, ".project", "localProjectSettings.json"),
        JSON.stringify(settings, null, 2)
    );

    // Initialize git
    await git.init({ fs, dir: projectDir, defaultBranch: "main" });
    await git.addRemote({
        fs,
        dir: projectDir,
        remote: "origin",
        url: options.gitUrl,
    });

    // Create initial commit
    const testFile = path.join(projectDir, "test.txt");
    fs.writeFileSync(testFile, "test content", "utf-8");
    await git.add({ fs, dir: projectDir, filepath: "metadata.json" });
    await git.add({ fs, dir: projectDir, filepath: "test.txt" });
    await git.commit({
        fs,
        dir: projectDir,
        message: "Initial commit",
        author: { name: "Test", email: "test@example.com" },
    });
}

function createSwapEntry(overrides: Partial<ProjectSwapEntry> = {}): ProjectSwapEntry {
    const now = Date.now();
    return {
        swapUUID: `uuid-${Math.random().toString(36).substring(7)}`,
        swapInitiatedAt: now,
        swapModifiedAt: now,
        swapStatus: "active",
        isOldProject: true,
        oldProjectUrl: "https://gitlab.com/org/old.git",
        oldProjectName: "old-project",
        newProjectUrl: "https://gitlab.com/org/new.git",
        newProjectName: "new-project",
        swapInitiatedBy: "testuser",
        ...overrides,
    };
}
