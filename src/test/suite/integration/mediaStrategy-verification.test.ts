import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

suite("Integration: Media strategy verification lifecycle", () => {
    let tempDir: string;
    let projectUri: vscode.Uri;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-verify-int-"));
        projectUri = vscode.Uri.file(tempDir);
        
        // Create project structure
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", "audio");
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        fs.mkdirSync(pointersDir, { recursive: true });
        fs.mkdirSync(filesDir, { recursive: true });
        
        // Add some pointer files for testing
        const pointerContent = [
            "version https://git-lfs.github.com/spec/v1",
            `oid sha256:${"f".repeat(64)}`,
            "size 600",
        ].join("\n");
        
        fs.writeFileSync(path.join(pointersDir, "test1.wav"), pointerContent, "utf8");
        fs.writeFileSync(path.join(pointersDir, "test2.wav"), pointerContent, "utf8");
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test("Switching from auto-download to stream-only resets mediaFilesVerified", async () => {
        const {
            writeLocalProjectSettings,
            readLocalProjectSettings,
            setMediaFilesStrategy,
        } = await import("../../../utils/localProjectSettings");
        const { applyMediaStrategy } = await import("../../../utils/mediaStrategyManager");
        
        // Start with auto-download and verified
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "auto-download",
            lastMediaFileStrategyRun: "auto-download",
            mediaFilesVerified: true,
        }, projectUri);
        
        // Switch to stream-only (this should reset mediaFilesVerified)
        await setMediaFilesStrategy("stream-only", projectUri);
        const { resetMediaFilesVerified } = await import("../../../utils/localProjectSettings");
        await resetMediaFilesVerified(projectUri);
        
        await applyMediaStrategy(projectUri, "stream-only");
        
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.currentMediaFilesStrategy, "stream-only");
        assert.strictEqual(settings.mediaFilesVerified, false, "mediaFilesVerified should be reset when switching strategies");
    });

    test("Switching from stream-only to stream-and-save resets mediaFilesVerified", async () => {
        const {
            writeLocalProjectSettings,
            readLocalProjectSettings,
            setMediaFilesStrategy,
        } = await import("../../../utils/localProjectSettings");
        const { applyMediaStrategy } = await import("../../../utils/mediaStrategyManager");
        
        // Start with stream-only and verified
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            lastMediaFileStrategyRun: "stream-only",
            mediaFilesVerified: true,
        }, projectUri);
        
        // Switch to stream-and-save
        await setMediaFilesStrategy("stream-and-save", projectUri);
        const { resetMediaFilesVerified } = await import("../../../utils/localProjectSettings");
        await resetMediaFilesVerified(projectUri);
        
        await applyMediaStrategy(projectUri, "stream-and-save");
        
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.currentMediaFilesStrategy, "stream-and-save");
        assert.strictEqual(settings.mediaFilesVerified, false, "mediaFilesVerified should be reset when switching strategies");
    });

    test("Multiple pointer files are all processed during verification", async () => {
        const {
            writeLocalProjectSettings,
            verifyAndFixMediaFiles,
        } = await import("../../../utils/localProjectSettings");
        
        // Add multiple pointer files
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", "audio");
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        
        const pointerFiles = ["a.wav", "b.wav", "c.wav", "d.wav"];
        for (const file of pointerFiles) {
            fs.writeFileSync(
                path.join(pointersDir, file),
                [
                    "version https://git-lfs.github.com/spec/v1",
                    `oid sha256:${file.charAt(0).repeat(64)}`,
                    "size 100",
                ].join("\n"),
                "utf8"
            );
        }
        
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Run verification
        await verifyAndFixMediaFiles(projectUri);
        
        // All pointer files should be in files folder
        for (const file of pointerFiles) {
            const filesPath = path.join(filesDir, file);
            assert.ok(fs.existsSync(filesPath), `${file} should be copied to files folder`);
        }
    });

    test("Nested subdirectories in pointers are preserved in files", async () => {
        const {
            writeLocalProjectSettings,
            verifyAndFixMediaFiles,
        } = await import("../../../utils/localProjectSettings");
        
        // Create nested structure
        const pointersBase = path.join(tempDir, ".project", "attachments", "pointers");
        const filesBase = path.join(tempDir, ".project", "attachments", "files");
        
        const nestedPath = "audio/chapter1/verse1";
        const pointersNested = path.join(pointersBase, nestedPath);
        fs.mkdirSync(pointersNested, { recursive: true });
        
        const pointerPath = path.join(pointersNested, "nested.wav");
        fs.writeFileSync(
            pointerPath,
            [
                "version https://git-lfs.github.com/spec/v1",
                `oid sha256:${"n".repeat(64)}`,
                "size 700",
            ].join("\n"),
            "utf8"
        );
        
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Run verification
        await verifyAndFixMediaFiles(projectUri);
        
        // Nested structure should be preserved in files
        const expectedFilesPath = path.join(filesBase, nestedPath, "nested.wav");
        assert.ok(fs.existsSync(expectedFilesPath), "Nested directory structure should be preserved");
    });

    test("Verification skips when already verified (performance optimization)", async () => {
        const {
            writeLocalProjectSettings,
            verifyAndFixMediaFiles,
            readLocalProjectSettings,
        } = await import("../../../utils/localProjectSettings");
        
        // Set as already verified
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: true,
        }, projectUri);
        
        // Files folder is empty
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        const filesBeforeCount = fs.readdirSync(filesDir).length;
        assert.strictEqual(filesBeforeCount, 0, "Files folder should be empty initially");
        
        // Run verification (should skip)
        await verifyAndFixMediaFiles(projectUri);
        
        // Files folder should still be empty (verification was skipped)
        const filesAfterCount = fs.readdirSync(filesDir).length;
        assert.strictEqual(filesAfterCount, 0, "Files folder should still be empty (skipped)");
        
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, true, "Should remain verified");
    });

    test("Cloning sets mediaFilesVerified to false", async () => {
        const { ensureLocalProjectSettingsExists, readLocalProjectSettings } = await import("../../../utils/localProjectSettings");
        
        // Simulate clone by creating settings with specific defaults
        await ensureLocalProjectSettingsExists(projectUri, {
            currentMediaFilesStrategy: "stream-only",
            lastMediaFileStrategyRun: "stream-only",
            mediaFileStrategyApplyState: "applied",
            mediaFilesVerified: false,
        });
        
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, false, "Cloned projects should start with mediaFilesVerified = false");
    });

    test("Strategy stays consistent when mediaFilesVerified is true", async () => {
        const {
            writeLocalProjectSettings,
            readLocalProjectSettings,
            verifyAndFixMediaFiles,
        } = await import("../../../utils/localProjectSettings");
        
        // Set up initial state
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-and-save",
            lastMediaFileStrategyRun: "stream-and-save",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Run verification
        await verifyAndFixMediaFiles(projectUri);
        
        // Read settings multiple times
        const settings1 = await readLocalProjectSettings(projectUri);
        const settings2 = await readLocalProjectSettings(projectUri);
        const settings3 = await readLocalProjectSettings(projectUri);
        
        // All reads should show verified = true and same strategy
        assert.strictEqual(settings1.mediaFilesVerified, true);
        assert.strictEqual(settings2.mediaFilesVerified, true);
        assert.strictEqual(settings3.mediaFilesVerified, true);
        assert.strictEqual(settings1.currentMediaFilesStrategy, "stream-and-save");
        assert.strictEqual(settings2.currentMediaFilesStrategy, "stream-and-save");
        assert.strictEqual(settings3.currentMediaFilesStrategy, "stream-and-save");
    });

    test("Empty pointers directory completes verification successfully", async () => {
        const {
            writeLocalProjectSettings,
            verifyAndFixMediaFiles,
            readLocalProjectSettings,
        } = await import("../../../utils/localProjectSettings");
        
        // Pointers directory exists but is empty
        const pointersDir = path.join(tempDir, ".project", "attachments", "pointers", "audio");
        fs.readdirSync(pointersDir).forEach(file => {
            fs.unlinkSync(path.join(pointersDir, file));
        });
        
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            mediaFilesVerified: false,
        }, projectUri);
        
        // Should complete without error
        await verifyAndFixMediaFiles(projectUri);
        
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, true, "Should mark as verified even with no pointers");
    });

    test("Auto-download project opens multiple times without re-scanning when verified", async () => {
        const {
            writeLocalProjectSettings,
            verifyAndFixMediaFiles,
            readLocalProjectSettings,
        } = await import("../../../utils/localProjectSettings");
        
        // Set up auto-download with verified = true
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "auto-download",
            lastMediaFileStrategyRun: "auto-download",
            mediaFilesVerified: true,
        }, projectUri);
        
        // Track file system state before verification calls
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        const initialFileCount = fs.readdirSync(filesDir).length;
        
        // Simulate multiple project opens (each should skip verification)
        await verifyAndFixMediaFiles(projectUri);
        await verifyAndFixMediaFiles(projectUri);
        await verifyAndFixMediaFiles(projectUri);
        
        // Files folder should remain unchanged (no processing occurred)
        const finalFileCount = fs.readdirSync(filesDir).length;
        assert.strictEqual(
            finalFileCount,
            initialFileCount,
            "Files folder should not change on subsequent opens when already verified"
        );
        
        const settings = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settings.mediaFilesVerified, true, "Should remain verified");
    });

    test("First open processes files, subsequent opens skip processing (auto-download)", async () => {
        const {
            writeLocalProjectSettings,
            verifyAndFixMediaFiles,
            readLocalProjectSettings,
        } = await import("../../../utils/localProjectSettings");
        
        // Start with auto-download, not verified
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "auto-download",
            lastMediaFileStrategyRun: "auto-download",
            mediaFilesVerified: false,
        }, projectUri);
        
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        
        // First open - should mark as verified (auto-download doesn't process files)
        await verifyAndFixMediaFiles(projectUri);
        
        const settingsAfterFirst = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settingsAfterFirst.mediaFilesVerified, true, "First open should mark as verified");
        
        const filesAfterFirst = fs.readdirSync(filesDir).length;
        
        // Second open - should skip
        await verifyAndFixMediaFiles(projectUri);
        
        const filesAfterSecond = fs.readdirSync(filesDir).length;
        assert.strictEqual(
            filesAfterSecond,
            filesAfterFirst,
            "Second open should not process any files"
        );
        
        // Third open - should also skip
        await verifyAndFixMediaFiles(projectUri);
        
        const filesAfterThird = fs.readdirSync(filesDir).length;
        assert.strictEqual(
            filesAfterThird,
            filesAfterFirst,
            "Third open should not process any files"
        );
    });

    test("Stream-only: First open processes files, subsequent opens skip", async () => {
        const {
            writeLocalProjectSettings,
            verifyAndFixMediaFiles,
            readLocalProjectSettings,
        } = await import("../../../utils/localProjectSettings");
        
        // Start with stream-only, not verified
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "stream-only",
            lastMediaFileStrategyRun: "stream-only",
            mediaFilesVerified: false,
        }, projectUri);
        
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        
        // First open - should populate files with pointers
        await verifyAndFixMediaFiles(projectUri);
        
        const settingsAfterFirst = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settingsAfterFirst.mediaFilesVerified, true, "First open should mark as verified");
        
        const filesAfterFirst = fs.readdirSync(filesDir);
        assert.ok(filesAfterFirst.length > 0, "First open should populate files folder");
        
        // Record file modification times to detect if they're touched
        const fileStats = filesAfterFirst.map(file => ({
            name: file,
            mtime: fs.statSync(path.join(filesDir, file)).mtimeMs,
        }));
        
        // Wait a bit to ensure timestamps would differ if files are rewritten
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Second open - should skip processing
        await verifyAndFixMediaFiles(projectUri);
        
        // Check that files weren't modified
        const filesAfterSecond = fs.readdirSync(filesDir);
        assert.strictEqual(
            filesAfterSecond.length,
            filesAfterFirst.length,
            "File count should remain the same"
        );
        
        // Verify files weren't touched (modification times unchanged)
        filesAfterSecond.forEach((file, index) => {
            const currentMtime = fs.statSync(path.join(filesDir, file)).mtimeMs;
            assert.strictEqual(
                currentMtime,
                fileStats[index].mtime,
                `File ${file} should not have been modified on second open`
            );
        });
    });

    test("After strategy change, verification runs once then skips on subsequent opens", async () => {
        const {
            writeLocalProjectSettings,
            verifyAndFixMediaFiles,
            readLocalProjectSettings,
            resetMediaFilesVerified,
        } = await import("../../../utils/localProjectSettings");
        const { applyMediaStrategy } = await import("../../../utils/mediaStrategyManager");
        
        // Start with auto-download, verified
        await writeLocalProjectSettings({
            currentMediaFilesStrategy: "auto-download",
            lastMediaFileStrategyRun: "auto-download",
            mediaFilesVerified: true,
        }, projectUri);
        
        // Switch to stream-only (resets verification flag)
        await resetMediaFilesVerified(projectUri);
        await applyMediaStrategy(projectUri, "stream-only");
        
        const settingsBeforeOpen = await readLocalProjectSettings(projectUri);
        assert.strictEqual(
            settingsBeforeOpen.mediaFilesVerified,
            false,
            "Strategy change should reset verification flag"
        );
        
        const filesDir = path.join(tempDir, ".project", "attachments", "files", "audio");
        
        // First open after strategy change - should process
        await verifyAndFixMediaFiles(projectUri);
        
        const settingsAfterFirst = await readLocalProjectSettings(projectUri);
        assert.strictEqual(settingsAfterFirst.mediaFilesVerified, true, "Should be verified after first open");
        
        const filesCountAfterFirst = fs.readdirSync(filesDir).length;
        
        // Second open - should skip
        await verifyAndFixMediaFiles(projectUri);
        
        const filesCountAfterSecond = fs.readdirSync(filesDir).length;
        assert.strictEqual(
            filesCountAfterSecond,
            filesCountAfterFirst,
            "Second open should not reprocess files"
        );
        
        // Third open - should also skip
        await verifyAndFixMediaFiles(projectUri);
        
        const filesCountAfterThird = fs.readdirSync(filesDir).length;
        assert.strictEqual(
            filesCountAfterThird,
            filesCountAfterFirst,
            "Third open should not reprocess files"
        );
    });
});

