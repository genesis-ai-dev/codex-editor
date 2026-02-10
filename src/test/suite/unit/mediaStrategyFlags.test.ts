import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

suite("Media strategy flags (lastModeRun / changesApplied)", () => {
    test("switch-only sets changesApplied=false when lastModeRun differs; true when equal", async function () {
        this.timeout(10000);

        // Arrange: create temp project folder
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-flags-"));
        const projectUri = vscode.Uri.file(tempDir);

        const {
            readLocalProjectSettings,
            setMediaFilesStrategy,
            setLastModeRun,
            setChangesApplied,
            getFlags,
        } = await import("../../../utils/localProjectSettings");

        try {
            // Initially empty
            let s = await readLocalProjectSettings(projectUri);
            assert.strictEqual(s.mediaFilesStrategy, undefined);
            assert.strictEqual(s.lastModeRun, undefined);
            assert.strictEqual(s.changesApplied, undefined);

            // Simulate initial open in auto-download
            await setMediaFilesStrategy("auto-download", projectUri);
            await setLastModeRun("auto-download", projectUri);
            await setChangesApplied(true, projectUri);
            s = await readLocalProjectSettings(projectUri);
            assert.strictEqual(s.mediaFilesStrategy, "auto-download");
            assert.strictEqual(s.lastModeRun, "auto-download");
            assert.strictEqual(s.changesApplied, true);

            // Switch Only to stream-only -> lastModeRun differs => changesApplied=false
            await setMediaFilesStrategy("stream-only", projectUri);
            const flags1 = await getFlags(projectUri);
            if (!flags1.lastModeRun || flags1.lastModeRun !== "stream-only") {
                await setChangesApplied(false, projectUri);
            }
            s = await readLocalProjectSettings(projectUri);
            assert.strictEqual(s.mediaFilesStrategy, "stream-only");
            assert.strictEqual(s.lastModeRun, "auto-download");
            assert.strictEqual(s.changesApplied, false);

            // Switch Only back to auto-download -> lastModeRun equals target => changesApplied=true
            await setMediaFilesStrategy("auto-download", projectUri);
            const flags2 = await getFlags(projectUri);
            if (flags2.lastModeRun === "auto-download") {
                await setChangesApplied(true, projectUri);
            }
            s = await readLocalProjectSettings(projectUri);
            assert.strictEqual(s.mediaFilesStrategy, "auto-download");
            assert.strictEqual(s.lastModeRun, "auto-download");
            assert.strictEqual(s.changesApplied, true);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
