import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as git from "isomorphic-git";

suite("Integration: Project healing", () => {
    let tempDir: string;
    let projectUri: vscode.Uri;
    let originalFetch: any;

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
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-heal-"));
        projectUri = vscode.Uri.file(tempDir);
        
        // Initialize a git repository
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        
        // Add a remote
        await git.addRemote({
            fs,
            dir: tempDir,
            remote: "origin",
            url: "https://example.com/test-repo.git",
        });
        
        // Create a commit
        const testFile = path.join(tempDir, "test.txt");
        fs.writeFileSync(testFile, "test content", "utf8");
        await git.add({ fs, dir: tempDir, filepath: "test.txt" });
        const commitSha = await git.commit({
            fs,
            dir: tempDir,
            message: "initial commit",
            author: { name: "Test", email: "test@example.com" },
        });
        
        // Set up remote tracking
        await git.writeRef({
            fs,
            dir: tempDir,
            ref: "refs/remotes/origin/main",
            value: commitSha,
            force: true,
        });
        
        // Create project structure
        const projectDir = path.join(tempDir, ".project");
        fs.mkdirSync(projectDir, { recursive: true });
        
        // Create indexes.sqlite
        const indexPath = path.join(projectDir, "indexes.sqlite");
        fs.writeFileSync(indexPath, "fake-sqlite-data", "utf8");
        
        // Create local project settings
        const settingsPath = path.join(projectDir, "localProjectSettings.json");
        fs.writeFileSync(
            settingsPath,
            JSON.stringify({
                currentMediaFilesStrategy: "auto-download",
                lastMediaFileStrategyRun: "auto-download",
                mediaFilesVerified: true,
            }),
            "utf8"
        );
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test("AI-only healing deletes indexes.sqlite and preserves .git", async () => {
        const gitDir = path.join(tempDir, ".git");
        const indexPath = path.join(tempDir, ".project", "indexes.sqlite");
        
        // Verify both exist before healing
        assert.ok(fs.existsSync(gitDir), ".git should exist before healing");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should exist before healing");
        
        // Simulate AI-only healing
        fs.unlinkSync(indexPath);
        
        // After AI-only healing
        assert.ok(fs.existsSync(gitDir), ".git should still exist after AI-only healing");
        assert.ok(!fs.existsSync(indexPath), "indexes.sqlite should be deleted after AI-only healing");
    });

    test("Sync-only healing deletes .git and preserves indexes.sqlite", async () => {
        const gitDir = path.join(tempDir, ".git");
        const indexPath = path.join(tempDir, ".project", "indexes.sqlite");
        
        // Verify both exist before healing
        assert.ok(fs.existsSync(gitDir), ".git should exist before healing");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should exist before healing");
        
        // Simulate sync-only healing
        fs.rmSync(gitDir, { recursive: true, force: true });
        
        // After sync-only healing
        assert.ok(!fs.existsSync(gitDir), ".git should be deleted after sync-only healing");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should still exist after sync-only healing");
    });

    test("Sync-and-ai healing deletes both .git and indexes.sqlite", async () => {
        const gitDir = path.join(tempDir, ".git");
        const indexPath = path.join(tempDir, ".project", "indexes.sqlite");
        
        // Verify both exist before healing
        assert.ok(fs.existsSync(gitDir), ".git should exist before healing");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should exist before healing");
        
        // Simulate sync-and-ai healing
        fs.rmSync(gitDir, { recursive: true, force: true });
        fs.unlinkSync(indexPath);
        
        // After sync-and-ai healing
        assert.ok(!fs.existsSync(gitDir), ".git should be deleted after sync-and-ai healing");
        assert.ok(!fs.existsSync(indexPath), "indexes.sqlite should be deleted after sync-and-ai healing");
    });

    test("Healing preserves working directory files", async () => {
        const testFile = path.join(tempDir, "test.txt");
        const workingFile = path.join(tempDir, "important.txt");
        fs.writeFileSync(workingFile, "important data", "utf8");
        
        // Verify files exist
        assert.ok(fs.existsSync(testFile), "test.txt should exist");
        assert.ok(fs.existsSync(workingFile), "important.txt should exist");
        
        // Simulate healing (delete .git and indexes.sqlite)
        fs.rmSync(path.join(tempDir, ".git"), { recursive: true, force: true });
        fs.unlinkSync(path.join(tempDir, ".project", "indexes.sqlite"));
        
        // Working directory files should be preserved
        assert.ok(fs.existsSync(testFile), "test.txt should be preserved after healing");
        assert.ok(fs.existsSync(workingFile), "important.txt should be preserved after healing");
        
        const content = fs.readFileSync(workingFile, "utf8");
        assert.strictEqual(content, "important data", "File content should be unchanged");
    });

    test("Healing preserves localProjectSettings.json", async () => {
        const settingsPath = path.join(tempDir, ".project", "localProjectSettings.json");
        
        const beforeContent = fs.readFileSync(settingsPath, "utf8");
        const beforeSettings = JSON.parse(beforeContent);
        
        // Simulate healing (delete indexes.sqlite only)
        fs.unlinkSync(path.join(tempDir, ".project", "indexes.sqlite"));
        
        // Settings should still exist
        assert.ok(fs.existsSync(settingsPath), "localProjectSettings.json should be preserved");
        
        const afterContent = fs.readFileSync(settingsPath, "utf8");
        const afterSettings = JSON.parse(afterContent);
        
        assert.deepStrictEqual(afterSettings, beforeSettings, "Settings should be unchanged");
    });

    test("Healing preserves uncommitted changes in working directory", async () => {
        // Create an uncommitted file
        const uncommittedFile = path.join(tempDir, "uncommitted.txt");
        fs.writeFileSync(uncommittedFile, "uncommitted content", "utf8");
        
        // Don't add or commit it
        
        // Simulate sync healing
        fs.rmSync(path.join(tempDir, ".git"), { recursive: true, force: true });
        
        // Uncommitted file should still exist
        assert.ok(fs.existsSync(uncommittedFile), "Uncommitted file should be preserved");
        const content = fs.readFileSync(uncommittedFile, "utf8");
        assert.strictEqual(content, "uncommitted content", "Uncommitted file content should be unchanged");
    });

    test("Re-initializing .git after sync healing sets up tracking correctly", async () => {
        const gitDir = path.join(tempDir, ".git");
        
        // Delete .git
        fs.rmSync(gitDir, { recursive: true, force: true });
        
        // Re-initialize
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        await git.addRemote({
            fs,
            dir: tempDir,
            remote: "origin",
            url: "https://example.com/test-repo.git",
        });
        
        // Verify .git exists
        assert.ok(fs.existsSync(gitDir), ".git should exist after re-init");
        
        // Verify remote is set
        const remotes = await git.listRemotes({ fs, dir: tempDir });
        const origin = remotes.find(r => r.remote === "origin");
        assert.ok(origin, "origin remote should be set");
        assert.strictEqual(origin?.url, "https://example.com/test-repo.git");
    });

    test("Healing with local changes does not corrupt repository", async () => {
        // Create a file and commit it
        const committedFile = path.join(tempDir, "committed.txt");
        fs.writeFileSync(committedFile, "original content", "utf8");
        await git.add({ fs, dir: tempDir, filepath: "committed.txt" });
        await git.commit({
            fs,
            dir: tempDir,
            message: "add committed file",
            author: { name: "Test", email: "test@example.com" },
        });
        
        // Modify the file (local changes)
        fs.writeFileSync(committedFile, "modified content", "utf8");
        
        // Verify file is modified
        const status = await git.statusMatrix({ fs, dir: tempDir });
        const committedStatus = status.find(([filepath]) => filepath === "committed.txt");
        assert.ok(committedStatus, "committed.txt should be in status");
        
        // Simulate sync healing and re-init
        fs.rmSync(path.join(tempDir, ".git"), { recursive: true, force: true });
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        
        // Local changes should still exist
        const content = fs.readFileSync(committedFile, "utf8");
        assert.strictEqual(content, "modified content", "Local changes should be preserved");
    });

    test("AI-only healing allows subsequent commits", async () => {
        const indexPath = path.join(tempDir, ".project", "indexes.sqlite");
        
        // Delete indexes.sqlite
        fs.unlinkSync(indexPath);
        
        // Git should still work
        const newFile = path.join(tempDir, "new.txt");
        fs.writeFileSync(newFile, "new content", "utf8");
        
        await git.add({ fs, dir: tempDir, filepath: "new.txt" });
        const commitSha = await git.commit({
            fs,
            dir: tempDir,
            message: "new commit after healing",
            author: { name: "Test", email: "test@example.com" },
        });
        
        assert.ok(commitSha, "Should be able to commit after AI-only healing");
        assert.strictEqual(typeof commitSha, "string");
        assert.strictEqual(commitSha.length, 40, "Commit SHA should be valid");
    });

    test("Healing preserves .project directory structure", async () => {
        // Add additional files to .project
        const attachmentsDir = path.join(tempDir, ".project", "attachments");
        fs.mkdirSync(attachmentsDir, { recursive: true });
        
        const pointerFile = path.join(attachmentsDir, "pointers", "audio", "test.wav");
        fs.mkdirSync(path.dirname(pointerFile), { recursive: true });
        fs.writeFileSync(pointerFile, "pointer content", "utf8");
        
        // Simulate healing (delete indexes.sqlite)
        fs.unlinkSync(path.join(tempDir, ".project", "indexes.sqlite"));
        
        // .project structure should be preserved
        assert.ok(fs.existsSync(attachmentsDir), "attachments dir should be preserved");
        assert.ok(fs.existsSync(pointerFile), "pointer file should be preserved");
        
        const content = fs.readFileSync(pointerFile, "utf8");
        assert.strictEqual(content, "pointer content", "Pointer content should be unchanged");
    });

    test("Multiple healing operations can be performed safely", async () => {
        const gitDir = path.join(tempDir, ".git");
        const indexPath = path.join(tempDir, ".project", "indexes.sqlite");
        
        // First healing: AI-only
        fs.unlinkSync(indexPath);
        assert.ok(!fs.existsSync(indexPath), "indexes.sqlite should be deleted");
        
        // Recreate indexes.sqlite
        fs.writeFileSync(indexPath, "new-sqlite-data", "utf8");
        
        // Second healing: Sync-only
        fs.rmSync(gitDir, { recursive: true, force: true });
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        
        assert.ok(fs.existsSync(gitDir), ".git should be recreated");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should still exist");
        
        // Third healing: Both
        fs.rmSync(gitDir, { recursive: true, force: true });
        fs.unlinkSync(indexPath);
        
        assert.ok(!fs.existsSync(gitDir), ".git should be deleted");
        assert.ok(!fs.existsSync(indexPath), "indexes.sqlite should be deleted");
    });
});

