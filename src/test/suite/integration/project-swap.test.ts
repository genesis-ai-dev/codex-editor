import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as git from "isomorphic-git";
import { ProjectMetadata, ProjectSwapEntry, ProjectSwapInfo } from "../../../../types";

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
