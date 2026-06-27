import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { exportAudioAttachments } from "../../../exportHandler/audioExporter";
import type { ExportProgressReporter, ExportSummary } from "../../../exportHandler/exportProgress";

/**
 * Issue #1007 — an audio export must NOT write an empty per-book folder /
 * NOTICE.txt for a file that has no audio; instead the omission is reported in
 * the completion summary's extraMessages ("Skipped (no audio): …").
 *
 * Covers Part 2 (no NOTICE.txt) and the file-level half of Part 3 (book-level
 * skip line). The chapter-level skip line is verified manually (it requires
 * resolvable audio in some chapters but not others).
 */
suite("Audio export — no empty folders + skipped summary (#1007)", () => {
    test("a book with no audio writes no NOTICE.txt and is reported as skipped", async () => {
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return; // exporter requires an open project; skip if the harness has none
        }

        const tmpRoot = path.join(os.tmpdir(), `codex-1007-${Date.now()}`);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpRoot));
        const exportDir = path.join(tmpRoot, "out");
        const codexPath = path.join(tmpRoot, "GEN.codex");

        // A book with text but no audio attachments.
        const notebook = {
            cells: [
                {
                    kind: 2,
                    value: "<span>In the beginning</span>",
                    languageId: "html",
                    metadata: { id: "GEN 1:1", type: "text", data: {} },
                },
                {
                    kind: 2,
                    value: "<span>and the earth was formless</span>",
                    languageId: "html",
                    metadata: { id: "GEN 1:2", type: "text", data: {} },
                },
            ],
            metadata: { id: "GEN" },
        };
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(codexPath),
            Buffer.from(JSON.stringify(notebook))
        );

        const calls: { type: string; summary?: ExportSummary; }[] = [];
        const reporter: ExportProgressReporter = {
            report: () => undefined,
            fileMissing: () => undefined,
            complete: (summary) => calls.push({ type: "complete", summary }),
            error: (message) =>
                calls.push({ type: "error", summary: { extraMessages: [String(message)] } as any }),
            cancelled: () => calls.push({ type: "cancelled" }),
        };

        await exportAudioAttachments(exportDir, [codexPath], reporter);

        const complete = calls.find((c) => c.type === "complete");
        assert.ok(
            complete,
            `expected reporter.complete (got: ${calls.map((c) => c.type).join(",") || "none"})`
        );
        const msgs = (complete!.summary?.extraMessages || []).join(" | ");
        assert.match(msgs, /Skipped \(no audio\)/, "summary should report the skipped book");
        assert.match(msgs, /GEN/, "summary should name the skipped book");

        // No NOTICE.txt anywhere under the export dir (Part 2 regression guard).
        let noticeFound = false;
        async function scan(dir: vscode.Uri): Promise<void> {
            let entries: [string, vscode.FileType][] = [];
            try {
                entries = await vscode.workspace.fs.readDirectory(dir);
            } catch {
                return;
            }
            for (const [name, type] of entries) {
                if (name === "NOTICE.txt") noticeFound = true;
                if (type === vscode.FileType.Directory) {
                    await scan(vscode.Uri.joinPath(dir, name));
                }
            }
        }
        await scan(vscode.Uri.file(exportDir));
        assert.strictEqual(noticeFound, false, "no NOTICE.txt should be written");

        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(tmpRoot), {
                recursive: true,
                useTrash: false,
            });
        } catch {
            // best effort
        }
    });

    test("an empty selected chapter inside an audio-bearing book is reported as skipped (not silently dropped)", async () => {
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }
        const tmpRoot = path.join(os.tmpdir(), `codex-1007ch-${Date.now()}`);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpRoot));
        const exportDir = path.join(tmpRoot, "out");
        const codexPath = path.join(tmpRoot, "GEN.codex");

        // Two chapters: ch1 has text but no audio; ch2 has a selected audio take.
        // (The audio file need not exist — the milestone counts as "has audio"
        // at pick time; the download simply fails and is counted separately.)
        const notebook = {
            cells: [
                { kind: 2, value: "1", languageId: "html", metadata: { id: "GEN 1:0", type: "milestone", data: {} } },
                {
                    kind: 2, value: "<span>verse with no audio</span>", languageId: "html",
                    metadata: { id: "GEN 1:1", type: "text", data: {} },
                },
                { kind: 2, value: "2", languageId: "html", metadata: { id: "GEN 2:0", type: "milestone", data: {} } },
                {
                    kind: 2, value: "<span>verse with audio</span>", languageId: "html",
                    metadata: {
                        id: "GEN 2:1", type: "text", data: {},
                        selectedAudioId: "att1",
                        attachments: { att1: { type: "audio", url: "files/audio/GEN_2_1.wav" } },
                    },
                },
            ],
            metadata: { id: "GEN" },
        };
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(codexPath),
            Buffer.from(JSON.stringify(notebook))
        );

        const calls: { type: string; summary?: ExportSummary; }[] = [];
        const reporter: ExportProgressReporter = {
            report: () => undefined,
            fileMissing: () => undefined,
            complete: (summary) => calls.push({ type: "complete", summary }),
            error: (message) =>
                calls.push({ type: "error", summary: { extraMessages: [String(message)] } as any }),
            cancelled: () => calls.push({ type: "cancelled" }),
        };

        await exportAudioAttachments(exportDir, [codexPath], reporter);

        const complete = calls.find((c) => c.type === "complete");
        assert.ok(
            complete,
            `expected reporter.complete (got: ${calls.map((c) => c.type).join(",") || "none"})`
        );
        const msgs = (complete!.summary?.extraMessages || []).join(" | ");
        assert.match(msgs, /Chapters skipped \(no audio\)/, "should report a chapter-level skip");
        assert.match(msgs, /GEN 1\b/, "the empty chapter (GEN 1) should be named");
        assert.doesNotMatch(
            msgs,
            /\d+ book\(s\)/,
            "a book with some audio must NOT be reported as a whole-book skip"
        );

        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(tmpRoot), {
                recursive: true,
                useTrash: false,
            });
        } catch {
            // best effort
        }
    });
});
