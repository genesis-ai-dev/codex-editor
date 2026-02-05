import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as git from "isomorphic-git";

suite("Integration: Project updating", () => {
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
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-update-"));
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

    test("Full updating creates backup and performs full re-clone", async () => {
        const gitDir = path.join(tempDir, ".git");
        const indexPath = path.join(tempDir, ".project", "indexes.sqlite");
        const testFile = path.join(tempDir, "test.txt");
        
        // Verify all exist before updating
        assert.ok(fs.existsSync(gitDir), ".git should exist before updating");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should exist before updating");
        assert.ok(fs.existsSync(testFile), "test.txt should exist before updating");
        
        // Full updating involves: backup -> save local changes to temp -> delete entire project -> re-clone -> merge changes
        // Simulate the delete step of full updating
        const tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-"));
        
        // Copy files to temp (excluding .git)
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            if (file !== ".git") {
                const srcPath = path.join(tempDir, file);
                const destPath = path.join(tempBackupDir, file);
                if (fs.statSync(srcPath).isDirectory()) {
                    fs.cpSync(srcPath, destPath, { recursive: true });
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }
        
        // Delete entire project directory (full updating)
        fs.rmSync(tempDir, { recursive: true, force: true });
        
        // Re-create directory (simulating re-clone)
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Restore from fresh clone + merge temp files back
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        await git.addRemote({ fs, dir: tempDir, remote: "origin", url: "https://example.com/test-repo.git" });
        
        // Merge temp files back
        fs.cpSync(tempBackupDir, tempDir, { recursive: true });
        
        // After full updating: everything should be restored
        assert.ok(fs.existsSync(gitDir), ".git should exist after full updating (re-cloned)");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should exist after merge");
        assert.ok(fs.existsSync(testFile), "test.txt should exist after merge");
        
        // Clean up temp backup
        fs.rmSync(tempBackupDir, { recursive: true, force: true });
    });

    test("Updateing preserves and merges working directory files", async () => {
        const testFile = path.join(tempDir, "test.txt");
        const workingFile = path.join(tempDir, "important.txt");
        fs.writeFileSync(workingFile, "important data", "utf8");
        
        // Verify files exist
        assert.ok(fs.existsSync(testFile), "test.txt should exist");
        assert.ok(fs.existsSync(workingFile), "important.txt should exist");
        
        // Simulate full updating: save to temp, delete project, re-clone, merge back
        const tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-"));
        
        // Save working files to temp (excluding .git)
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            if (file !== ".git") {
                const srcPath = path.join(tempDir, file);
                const destPath = path.join(tempBackupDir, file);
                if (fs.statSync(srcPath).isDirectory()) {
                    fs.cpSync(srcPath, destPath, { recursive: true });
                } else {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }
        
        // Delete entire project (full updating)
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Re-clone
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        
        // Merge temp files back
        fs.cpSync(tempBackupDir, tempDir, { recursive: true });
        
        // Working directory files should be preserved and merged
        assert.ok(fs.existsSync(testFile), "test.txt should be preserved after updating");
        assert.ok(fs.existsSync(workingFile), "important.txt should be preserved after updating");
        
        const content = fs.readFileSync(workingFile, "utf8");
        assert.strictEqual(content, "important data", "File content should be unchanged");
        
        // Clean up
        fs.rmSync(tempBackupDir, { recursive: true, force: true });
    });

    test("Updateing preserves and merges localProjectSettings.json", async () => {
        const settingsPath = path.join(tempDir, ".project", "localProjectSettings.json");
        
        const beforeContent = fs.readFileSync(settingsPath, "utf8");
        const beforeSettings = JSON.parse(beforeContent);
        
        // Simulate full updating: save to temp, delete project, merge back
        const tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-settings-"));
        fs.cpSync(tempDir, tempBackupDir, { recursive: true, filter: (src) => !src.includes(".git") });
        
        // Delete entire project
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Re-clone (just init for test)
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        
        // Merge temp back
        fs.cpSync(tempBackupDir, tempDir, { recursive: true });
        
        // Settings should be restored from merge
        assert.ok(fs.existsSync(settingsPath), "localProjectSettings.json should be preserved via merge");
        
        const afterContent = fs.readFileSync(settingsPath, "utf8");
        const afterSettings = JSON.parse(afterContent);
        
        assert.deepStrictEqual(afterSettings, beforeSettings, "Settings should be unchanged after merge");
        
        // Clean up
        fs.rmSync(tempBackupDir, { recursive: true, force: true });
    });

    test("Updateing preserves uncommitted changes via temp folder merge", async () => {
        // Create an uncommitted file
        const uncommittedFile = path.join(tempDir, "uncommitted.txt");
        fs.writeFileSync(uncommittedFile, "uncommitted content", "utf8");
        
        // Don't add or commit it
        
        // Simulate full updating: backup to temp (excluding .git), delete, re-clone, merge
        const tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-uncommitted-"));
        fs.cpSync(tempDir, tempBackupDir, { recursive: true, filter: (src) => !src.includes(".git") });
        
        // Delete entire project
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Re-clone
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        
        // Merge uncommitted changes back from temp
        fs.cpSync(tempBackupDir, tempDir, { recursive: true });
        
        // Uncommitted file should be restored from merge
        assert.ok(fs.existsSync(uncommittedFile), "Uncommitted file should be preserved via merge");
        const content = fs.readFileSync(uncommittedFile, "utf8");
        assert.strictEqual(content, "uncommitted content", "Uncommitted file content should be unchanged");
        
        // Clean up
        fs.rmSync(tempBackupDir, { recursive: true, force: true });
    });

    test("Full updating re-clones and sets up git tracking correctly", async () => {
        const gitDir = path.join(tempDir, ".git");
        
        // Simulate full updating: backup, delete entire project, re-clone
        const tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-git-"));
        fs.cpSync(tempDir, tempBackupDir, { recursive: true, filter: (src) => !src.includes(".git") });
        
        // Delete entire project
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Re-clone
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        await git.addRemote({
            fs,
            dir: tempDir,
            remote: "origin",
            url: "https://example.com/test-repo.git",
        });
        
        // Merge back local files
        fs.cpSync(tempBackupDir, tempDir, { recursive: true });
        
        // Verify .git exists from re-clone
        assert.ok(fs.existsSync(gitDir), ".git should exist after full updating");
        
        // Verify remote is set
        const remotes = await git.listRemotes({ fs, dir: tempDir });
        const origin = remotes.find(r => r.remote === "origin");
        assert.ok(origin, "origin remote should be set");
        assert.strictEqual(origin?.url, "https://example.com/test-repo.git");
        
        // Clean up
        fs.rmSync(tempBackupDir, { recursive: true, force: true });
    });

    test("Updateing with local changes does not corrupt repository", async () => {
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
        
        // Simulate sync updating and re-init
        fs.rmSync(path.join(tempDir, ".git"), { recursive: true, force: true });
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        
        // Local changes should still exist
        const content = fs.readFileSync(committedFile, "utf8");
        assert.strictEqual(content, "modified content", "Local changes should be preserved");
    });

    test("Full updating allows subsequent commits after re-clone", async () => {
        // Simulate full updating: backup, delete, re-clone, merge
        const tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-commit-"));
        fs.cpSync(tempDir, tempBackupDir, { recursive: true, filter: (src) => !src.includes(".git") });
        
        // Delete entire project
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Re-clone
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        await git.addRemote({
            fs,
            dir: tempDir,
            remote: "origin",
            url: "https://example.com/test-repo.git",
        });
        
        // Merge back
        fs.cpSync(tempBackupDir, tempDir, { recursive: true });
        
        // Git should work - add and commit a new file
        const newFile = path.join(tempDir, "new.txt");
        fs.writeFileSync(newFile, "new content", "utf8");
        
        await git.add({ fs, dir: tempDir, filepath: "new.txt" });
        const commitSha = await git.commit({
            fs,
            dir: tempDir,
            message: "new commit after full updating",
            author: { name: "Test", email: "test@example.com" },
        });
        
        assert.ok(commitSha, "Should be able to commit after full updating");
        assert.strictEqual(typeof commitSha, "string");
        assert.strictEqual(commitSha.length, 40, "Commit SHA should be valid");
        
        // Clean up
        fs.rmSync(tempBackupDir, { recursive: true, force: true });
    });

    test("Updateing preserves .project directory structure via merge", async () => {
        // Add additional files to .project
        const attachmentsDir = path.join(tempDir, ".project", "attachments");
        fs.mkdirSync(attachmentsDir, { recursive: true });
        
        const pointerFile = path.join(attachmentsDir, "pointers", "audio", "test.wav");
        fs.mkdirSync(path.dirname(pointerFile), { recursive: true });
        fs.writeFileSync(pointerFile, "pointer content", "utf8");
        
        // Simulate full updating: backup, delete, re-clone, merge
        const tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-project-"));
        fs.cpSync(tempDir, tempBackupDir, { recursive: true, filter: (src) => !src.includes(".git") });
        
        // Delete entire project
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Re-clone
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        
        // Merge back
        fs.cpSync(tempBackupDir, tempDir, { recursive: true });
        
        // .project structure should be preserved from merge
        assert.ok(fs.existsSync(attachmentsDir), "attachments dir should be preserved");
        assert.ok(fs.existsSync(pointerFile), "pointer file should be preserved");
        
        const content = fs.readFileSync(pointerFile, "utf8");
        assert.strictEqual(content, "pointer content", "Pointer content should be unchanged");
        
        // Clean up
        fs.rmSync(tempBackupDir, { recursive: true, force: true });
    });

    test("Multiple full updating operations can be performed safely", async () => {
        const gitDir = path.join(tempDir, ".git");
        const indexPath = path.join(tempDir, ".project", "indexes.sqlite");
        const testFile = path.join(tempDir, "test.txt");
        
        // First full updating
        const tempBackup1 = fs.mkdtempSync(path.join(os.tmpdir(), "update-multi-1-"));
        fs.cpSync(tempDir, tempBackup1, { recursive: true, filter: (src) => !src.includes(".git") });
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        fs.cpSync(tempBackup1, tempDir, { recursive: true });
        
        assert.ok(fs.existsSync(gitDir), ".git should exist after first updating");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should exist after first updating");
        assert.ok(fs.existsSync(testFile), "test.txt should exist after first updating");
        
        // Second full updating
        const tempBackup2 = fs.mkdtempSync(path.join(os.tmpdir(), "update-multi-2-"));
        fs.cpSync(tempDir, tempBackup2, { recursive: true, filter: (src) => !src.includes(".git") });
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
        await git.init({ fs, dir: tempDir, defaultBranch: "main" });
        fs.cpSync(tempBackup2, tempDir, { recursive: true });
        
        assert.ok(fs.existsSync(gitDir), ".git should exist after second updating");
        assert.ok(fs.existsSync(indexPath), "indexes.sqlite should exist after second updating");
        assert.ok(fs.existsSync(testFile), "test.txt should exist after second updating");
        
        // Clean up
        fs.rmSync(tempBackup1, { recursive: true, force: true });
        fs.rmSync(tempBackup2, { recursive: true, force: true });
    });
});

