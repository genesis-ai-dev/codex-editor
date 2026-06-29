import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { exportCodexContent } from "../../../exportHandler/exportHandler";
import { CodexExportFormat } from "../../../exportHandler/exportHandler";
import type { ExportProgressReporter, ExportSummary } from "../../../exportHandler/exportProgress";

/**
 * Verifies that a cancelled export reports the terminal "cancelled" state and
 * deletes the partial output folder, rather than completing or erroring.
 */
suite("Export Cancellation - exportCodexContent", () => {
    test("cancelled token deletes the partial folder and reports cancelled (not complete)", async () => {
        const tmpRoot = path.join(os.tmpdir(), `codex-export-cancel-${Date.now()}`);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpRoot));

        const cts = new vscode.CancellationTokenSource();
        // Pre-cancel: the plaintext exporter creates its output folder, then the
        // top-of-loop check bails before processing any file. The orchestrator
        // then cleans up the freshly-created folder and reports cancelled.
        cts.cancel();

        const calls: { type: string; summary?: ExportSummary; }[] = [];
        const reporter: ExportProgressReporter = {
            report: () => undefined,
            fileMissing: () => undefined,
            complete: (summary) => calls.push({ type: "complete", summary }),
            error: () => calls.push({ type: "error" }),
            cancelled: (summary) => calls.push({ type: "cancelled", summary }),
        };

        // A non-empty (but non-existent) file list passes the "no files" guard
        // so the exporter reaches its directory-creation + loop, where the token
        // check short-circuits before any file is read.
        await exportCodexContent(
            CodexExportFormat.PLAINTEXT,
            tmpRoot,
            [path.join(tmpRoot, "does-not-exist.codex")],
            {},
            reporter,
            cts.token
        );

        const cancelledCall = calls.find((c) => c.type === "cancelled");
        assert.ok(cancelledCall, "reporter.cancelled should have been called");
        assert.strictEqual(
            calls.some((c) => c.type === "complete"),
            false,
            "reporter.complete must NOT be called on cancellation"
        );

        // The wrapper folder reported by the cancelled summary must be gone.
        const wrapperPath = cancelledCall?.summary?.exportPath;
        assert.ok(wrapperPath, "cancelled summary should include the export path");
        let stillExists = true;
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(wrapperPath!));
        } catch {
            stillExists = false;
        }
        assert.strictEqual(stillExists, false, "partial export folder should be deleted");

        // Cleanup the temp root.
        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(tmpRoot), {
                recursive: true,
                useTrash: false,
            });
        } catch {
            // best effort
        }
        cts.dispose();
    });
});
