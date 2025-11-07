import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

suite("Media files verification feature", () => {
    let tempDir: string;
    let projectUri: vscode.Uri;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-verify-"));
        projectUri = vscode.Uri.file(tempDir);
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test("mediaFilesVerified defaults to false when absent", async () => {
        const { readLocalProjectSettings } = await import("../../../utils/localProjectSettings");
        
        const settings = await readLocalProjectSettings(projectUri);
        
        // Should be undefined (treated as false)
        assert.strictEqual(settings.mediaFilesVerified, undefined);
    });

    test("mediaFilesVerified defaults to false in ensureLocalProjectSettingsExists", async () => {
        const { ensureLocalProjectSettingsExists, readLocalProjectSettings } = await import("../../../utils/localProjectSettings");
        
        await ensureLocalProjectSettingsExists(projectUri);
        const settings = await readLocalProjectSettings(projectUri);
        
        assert.strictEqual(settings.mediaFilesVerified, false);
    });

    test("verifyAndFixMediaFiles skips if already verified", async () => {
        const { writeLocalProjectSettings, verifyAndFixMediaFiles, readLocalProjectSettings } = await import("../../../utils/localProjectSettings");
        
        // Set as already verified
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: true,
        }, projectUri);
        
        // Call verify - should skip
        await verifyAndFixMediaFiles(projectUri);
        
        // Should still be true (not changed)
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, true);
    });

    test("verifyAndFixMediaFiles sets mediaFilesVerified to true after completion", async () => {
        const { writeLocalProjectSettings, verifyAndFixMediaFiles, readLocalProjectSettings } = await import("../../../utils/localProjectSettings");
        
        // Create project structure
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", "audio");
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        fs.mkdirSync(pointersDir, { recursive: true });
        fs.mkdirSync(filesDir, { recursive: true });
        
        // Add a pointer file
        const pointerPath = path.join(pointersDir, "test.wav");
        fs.writeFileSync(
            pointerPath,
            [
                "version https://git-lfs.github.com/spec/v1",
                `oid sha256:${"a".repeat(64)}`,
                "size 100",
            ].join("\n"),
            "utf8"
        );
        
        // Set up settings with verified = false
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Run verification
        await verifyAndFixMediaFiles(projectUri);
        
        // Should now be verified
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, true);
    });

    test("verifyAndFixMediaFiles populates files folder with pointers for stream-only", async () => {
        const { writeLocalProjectSettings, verifyAndFixMediaFiles } = await import("../../../utils/localProjectSettings");
        
        // Create project structure
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", "audio");
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        fs.mkdirSync(pointersDir, { recursive: true });
        fs.mkdirSync(filesDir, { recursive: true });
        
        // Add a pointer file
        const pointerPath = path.join(pointersDir, "clip.wav");
        const pointerContent = [
            "version https://git-lfs.github.com/spec/v1",
            `oid sha256:${"b".repeat(64)}`,
            "size 200",
        ].join("\n");
        fs.writeFileSync(pointerPath, pointerContent, "utf8");
        
        // Set strategy to stream-only
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Run verification
        await verifyAndFixMediaFiles(projectUri);
        
        // Files folder should now have the pointer
        const filesPath = path.join(filesDir, "clip.wav");
        assert.ok(fs.existsSync(filesPath), "Pointer should be copied to files folder");
        
        const copiedContent = fs.readFileSync(filesPath, "utf8");
        assert.strictEqual(copiedContent, pointerContent, "Pointer content should match");
    });

    test("verifyAndFixMediaFiles populates files folder with pointers for stream-and-save", async () => {
        const { writeLocalProjectSettings, verifyAndFixMediaFiles } = await import("../../../utils/localProjectSettings");
        
        // Create project structure
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", "audio");
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        fs.mkdirSync(pointersDir, { recursive: true });
        fs.mkdirSync(filesDir, { recursive: true });
        
        // Add a pointer file
        const pointerPath = path.join(pointersDir, "record.wav");
        const pointerContent = [
            "version https://git-lfs.github.com/spec/v1",
            `oid sha256:${"c".repeat(64)}`,
            "size 300",
        ].join("\n");
        fs.writeFileSync(pointerPath, pointerContent, "utf8");
        
        // Set strategy to stream-and-save
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-and-save",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Run verification
        await verifyAndFixMediaFiles(projectUri);
        
        // Files folder should now have the pointer
        const filesPath = path.join(filesDir, "record.wav");
        assert.ok(fs.existsSync(filesPath), "Pointer should be copied to files folder");
        
        const copiedContent = fs.readFileSync(filesPath, "utf8");
        assert.strictEqual(copiedContent, pointerContent, "Pointer content should match");
    });

    test("verifyAndFixMediaFiles replaces existing full files with pointers for stream-only", async () => {
        const { writeLocalProjectSettings, verifyAndFixMediaFiles } = await import("../../../utils/localProjectSettings");
        
        // Create project structure
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", "audio");
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        fs.mkdirSync(pointersDir, { recursive: true });
        fs.mkdirSync(filesDir, { recursive: true });
        
        // Add a pointer file in pointers directory
        const pointerPath = path.join(pointersDir, "existing.wav");
        const pointerContent = [
            "version https://git-lfs.github.com/spec/v1",
            `oid sha256:${"d".repeat(64)}`,
            "size 400",
        ].join("\n");
        fs.writeFileSync(pointerPath, pointerContent, "utf8");
        
        // Add a full file already in files/ (SHOULD be replaced with pointer)
        const filesPath = path.join(filesDir, "existing.wav");
        const fullFileContent = Buffer.alloc(1000); // Large file, not a pointer
        fs.writeFileSync(filesPath, fullFileContent);
        
        // Set strategy to stream-only
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Run verification
        await verifyAndFixMediaFiles(projectUri);
        
        // Full file should be replaced with pointer
        assert.ok(fs.existsSync(filesPath), "File should still exist");
        const finalContent = fs.readFileSync(filesPath, "utf8");
        
        // Should now be a pointer file (small size, contains LFS header)
        assert.ok(finalContent.includes("version https://git-lfs.github.com/spec/v1"), "Should be a pointer file with LFS header");
        assert.ok(finalContent.length < 200, "Pointer file should be small");
        assert.strictEqual(finalContent, pointerContent, "Full file should be replaced with pointer content");
    });

    test("resetMediaFilesVerified sets flag to false", async () => {
        const { writeLocalProjectSettings, resetMediaFilesVerified, readLocalProjectSettings } = await import("../../../utils/localProjectSettings");
        
        // Set as verified
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "auto-download",
            mediaFilesVerified: true,
        }, projectUri);
        
        // Reset
        await resetMediaFilesVerified(projectUri);
        
        // Should now be false
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, false);
    });

    test("verifyAndFixMediaFiles handles auto-download strategy (no pointer population)", async () => {
        const { writeLocalProjectSettings, verifyAndFixMediaFiles, readLocalProjectSettings } = await import("../../../utils/localProjectSettings");
        
        // Create project structure
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", "audio");
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        fs.mkdirSync(pointersDir, { recursive: true });
        fs.mkdirSync(filesDir, { recursive: true });
        
        // Add a pointer file
        const pointerPath = path.join(pointersDir, "download.wav");
        fs.writeFileSync(
            pointerPath,
            [
                "version https://git-lfs.github.com/spec/v1",
                `oid sha256:${"e".repeat(64)}`,
                "size 500",
            ].join("\n"),
            "utf8"
        );
        
        // Set strategy to auto-download
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "auto-download",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Run verification
        await verifyAndFixMediaFiles(projectUri);
        
        // For auto-download, reconciliation handles downloads, so verification just marks as complete
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, true);
        
        // Files folder should not have the pointer (reconciliation will handle full downloads)
        const filesPath = path.join(filesDir, "download.wav");
        assert.strictEqual(fs.existsSync(filesPath), false, "Auto-download doesn't populate pointers");
    });

    test("verifyAndFixMediaFiles handles no workspace folder gracefully", async () => {
        const { verifyAndFixMediaFiles } = await import("../../../utils/localProjectSettings");
        
        // Should not throw when no workspace folder
        await assert.doesNotReject(async () => {
            await verifyAndFixMediaFiles(undefined);
        });
    });

    test("verifyAndFixMediaFiles handles missing pointers directory gracefully", async () => {
        const { writeLocalProjectSettings, verifyAndFixMediaFiles, readLocalProjectSettings } = await import("../../../utils/localProjectSettings");
        
        // Set strategy but don't create pointers directory
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Should complete without error
        await verifyAndFixMediaFiles(projectUri);
        
        // Should still mark as verified even with no pointers
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, true);
    });
});

