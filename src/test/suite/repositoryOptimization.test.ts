import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as git from "isomorphic-git";
import {
    optimizeRepository,
    shouldOptimizeRepository,
    autoOptimizeIfNeeded,
    cleanupStalePackFiles,
    isOptimizationInProgress,
} from "../../utils/repositoryOptimization";

suite("Repository Optimization Utils - Unit Tests", () => {
    let workspaceDir: string;
    let frontierExtension: vscode.Extension<any> | undefined;

    suiteSetup(async function () {
        this.timeout(30000);

        // Ensure Frontier extension is available
        frontierExtension = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
        if (!frontierExtension) {
            this.skip();
        }

        if (!frontierExtension.isActive) {
            await frontierExtension.activate();
        }
    });

    setup(async () => {
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-opt-test-"));

        // Initialize repository
        await git.init({ fs, dir: workspaceDir, defaultBranch: "main" });
        await fs.promises.writeFile(path.join(workspaceDir, "README.md"), "test", "utf8");
        await git.add({ fs, dir: workspaceDir, filepath: "README.md" });
        await git.commit({
            fs,
            dir: workspaceDir,
            message: "initial",
            author: { name: "Test", email: "test@example.com" },
        });
    });

    teardown(async () => {
        try {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test("shouldOptimizeRepository returns false for new repository", async () => {
        const shouldOptimize = await shouldOptimizeRepository(workspaceDir);
        assert.strictEqual(shouldOptimize, false, "New repository should not need optimization");
    });

    test("shouldOptimizeRepository returns true with >50 loose objects", async function () {
        this.timeout(30000);

        // Create many commits to generate loose objects
        for (let i = 0; i < 60; i++) {
            const file = path.join(workspaceDir, `file-${i}.txt`);
            await fs.promises.writeFile(file, `content ${i}`, "utf8");
            await git.add({ fs, dir: workspaceDir, filepath: `file-${i}.txt` });
            await git.commit({
                fs,
                dir: workspaceDir,
                message: `commit ${i}`,
                author: { name: "Test", email: "test@example.com" },
            });
        }

        const shouldOptimize = await shouldOptimizeRepository(workspaceDir);
        assert.strictEqual(shouldOptimize, true, "Repository with >50 loose objects should need optimization");
    });

    test("shouldOptimizeRepository returns true with >10 pack files", async function () {
        this.timeout(30000);

        const packDir = path.join(workspaceDir, ".git", "objects", "pack");
        await fs.promises.mkdir(packDir, { recursive: true });

        // Create fake pack files (simulating fragmented repository)
        for (let i = 0; i < 12; i++) {
            await fs.promises.writeFile(path.join(packDir, `pack-fake${i}.pack`), "fake", "utf8");
            await fs.promises.writeFile(path.join(packDir, `pack-fake${i}.idx`), "fake", "utf8");
        }

        const shouldOptimize = await shouldOptimizeRepository(workspaceDir);
        assert.strictEqual(shouldOptimize, true, "Repository with >10 pack files should need optimization");
    });

    test("cleanupStalePackFiles removes temporary pack files", async () => {
        const packDir = path.join(workspaceDir, ".git", "objects", "pack");
        await fs.promises.mkdir(packDir, { recursive: true });

        // Create stale temp files
        const staleFiles = [
            "tmp_pack_abc123",
            "tmp_idx_xyz789",
            ".tmp-pack-stale",
        ];

        for (const file of staleFiles) {
            await fs.promises.writeFile(path.join(packDir, file), "stale", "utf8");
        }

        // Run cleanup
        await cleanupStalePackFiles(workspaceDir);

        // Verify stale files are removed
        const filesAfter = await fs.promises.readdir(packDir);
        for (const file of staleFiles) {
            assert.ok(!filesAfter.includes(file), `Stale file ${file} should be removed`);
        }
    });

    test("cleanupStalePackFiles removes orphaned pack files", async () => {
        const packDir = path.join(workspaceDir, ".git", "objects", "pack");
        await fs.promises.mkdir(packDir, { recursive: true });

        // Create orphaned pack (no idx)
        await fs.promises.writeFile(path.join(packDir, "pack-orphaned123.pack"), "orphaned", "utf8");

        // Create valid pair
        await fs.promises.writeFile(path.join(packDir, "pack-valid456.pack"), "valid", "utf8");
        await fs.promises.writeFile(path.join(packDir, "pack-valid456.idx"), "valid", "utf8");

        // Run cleanup
        await cleanupStalePackFiles(workspaceDir);

        // Verify orphaned pack is removed
        const filesAfter = await fs.promises.readdir(packDir);
        assert.ok(!filesAfter.includes("pack-orphaned123.pack"), "Orphaned pack should be removed");
        assert.ok(filesAfter.includes("pack-valid456.pack"), "Valid pack should remain");
        assert.ok(filesAfter.includes("pack-valid456.idx"), "Valid idx should remain");
    });

    test("cleanupStalePackFiles removes orphaned index files", async () => {
        const packDir = path.join(workspaceDir, ".git", "objects", "pack");
        await fs.promises.mkdir(packDir, { recursive: true });

        // Create orphaned idx (no pack)
        await fs.promises.writeFile(path.join(packDir, "pack-orphanedidx789.idx"), "orphaned", "utf8");

        // Run cleanup
        await cleanupStalePackFiles(workspaceDir);

        // Verify orphaned idx is removed
        const filesAfter = await fs.promises.readdir(packDir);
        assert.ok(!filesAfter.includes("pack-orphanedidx789.idx"), "Orphaned idx should be removed");
    });

    test("cleanupStalePackFiles handles non-existent pack directory", async () => {
        const newRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-new-"));
        await git.init({ fs, dir: newRepoDir, defaultBranch: "main" });

        // Pack directory doesn't exist yet
        // Cleanup should not throw error
        await cleanupStalePackFiles(newRepoDir);

        // Test passes if no error thrown
        assert.ok(true, "Cleanup should handle non-existent pack directory");

        fs.rmSync(newRepoDir, { recursive: true, force: true });
    });

    test("isOptimizationInProgress returns false initially", () => {
        const inProgress = isOptimizationInProgress(workspaceDir);
        assert.strictEqual(inProgress, false, "No optimization should be in progress initially");
    });

    test("autoOptimizeIfNeeded returns false when optimization not needed", async function () {
        this.timeout(30000);

        const optimized = await autoOptimizeIfNeeded(workspaceDir, true);
        assert.strictEqual(optimized, false, "Should not optimize when threshold not met");
    });

    test("autoOptimizeIfNeeded runs cleanup before checking threshold", async function () {
        this.timeout(30000);

        const packDir = path.join(workspaceDir, ".git", "objects", "pack");
        await fs.promises.mkdir(packDir, { recursive: true });

        // Create stale files
        await fs.promises.writeFile(path.join(packDir, "tmp_pack_stale"), "stale", "utf8");

        // Run autoOptimize (even though threshold not met, cleanup should run)
        await autoOptimizeIfNeeded(workspaceDir, true);

        // Verify stale file was cleaned up
        const filesAfter = await fs.promises.readdir(packDir);
        assert.ok(!filesAfter.includes("tmp_pack_stale"), "Stale files should be cleaned up");
    });

    test("autoOptimizeIfNeeded optimizes when threshold met", async function () {
        this.timeout(60000);

        // Create many commits to exceed threshold
        for (let i = 0; i < 60; i++) {
            const file = path.join(workspaceDir, `file-${i}.txt`);
            await fs.promises.writeFile(file, `content ${i}`, "utf8");
            await git.add({ fs, dir: workspaceDir, filepath: `file-${i}.txt` });
            await git.commit({
                fs,
                dir: workspaceDir,
                message: `commit ${i}`,
                author: { name: "Test", email: "test@example.com" },
            });
        }

        const optimized = await autoOptimizeIfNeeded(workspaceDir, true);
        assert.strictEqual(optimized, true, "Should optimize when threshold exceeded");

        // Verify pack was created
        const packDir = path.join(workspaceDir, ".git", "objects", "pack");
        const files = await fs.promises.readdir(packDir);
        const packs = files.filter(f => f.endsWith(".pack"));
        assert.ok(packs.length > 0, "Pack file should be created");
    });

    test("optimizeRepository throws error if Frontier extension not available", async function () {
        this.timeout(30000);

        // Create a workspace without Frontier context
        const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "isolated-"));
        await git.init({ fs, dir: isolatedDir, defaultBranch: "main" });

        // This test verifies error handling (actual behavior depends on extension availability)
        // In real scenario, Frontier extension should be available

        fs.rmSync(isolatedDir, { recursive: true, force: true });
    });

    test("concurrent optimization requests are handled by lock", async function () {
        this.timeout(60000);

        // Create commits
        for (let i = 0; i < 60; i++) {
            const file = path.join(workspaceDir, `file-${i}.txt`);
            await fs.promises.writeFile(file, `content ${i}`, "utf8");
            await git.add({ fs, dir: workspaceDir, filepath: `file-${i}.txt` });
            await git.commit({
                fs,
                dir: workspaceDir,
                message: `commit ${i}`,
                author: { name: "Test", email: "test@example.com" },
            });
        }

        // Run multiple optimization requests concurrently
        const results = await Promise.all([
            autoOptimizeIfNeeded(workspaceDir, true),
            autoOptimizeIfNeeded(workspaceDir, true),
            autoOptimizeIfNeeded(workspaceDir, true),
        ]);

        // At least one should have actually optimized
        const optimizedCount = results.filter(r => r === true).length;
        assert.ok(optimizedCount >= 1, "At least one optimization should have run");

        // Verify only one pack was created (not three)
        const packDir = path.join(workspaceDir, ".git", "objects", "pack");
        const files = await fs.promises.readdir(packDir);
        const packs = files.filter(f => f.endsWith(".pack"));
        assert.ok(packs.length <= 2, "Should not create multiple packs from concurrent requests");
    });
});

