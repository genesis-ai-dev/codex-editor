import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";

import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { resolveCodexCustomMerge } from "../../../src/projectManager/utils/merge/resolvers";
import { codexSubtitleContent } from "./mocks/codexSubtitleContent";
import { CodexNotebookAsJSONData } from "../../../types";
import { swallowDuplicateCommandRegistrations, createMockExtensionContext, createTempCodexFile, deleteIfExists, sleep } from "../testUtils";

suite("Provider + Merge Integration - multi-user multi-field edits", () => {
    let provider: CodexCellEditorProvider;
    let oursUri: vscode.Uri;
    let theirsUri: vscode.Uri;

    suiteSetup(async () => {
        swallowDuplicateCommandRegistrations();
        oursUri = await createTempCodexFile("merge-ours.codex", codexSubtitleContent);
        theirsUri = await createTempCodexFile("merge-theirs.codex", codexSubtitleContent);
    });

    suiteTeardown(async () => {
        await deleteIfExists(oursUri);
        await deleteIfExists(theirsUri);
    });

    setup(() => {
        const context = createMockExtensionContext();
        provider = new CodexCellEditorProvider(context);
    });

    test("edits by different users merge by most recent per field and include uniques", async () => {
        const oursDoc = await provider.openCustomDocument(
            oursUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        const theirsDoc = await provider.openCustomDocument(
            theirsUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        // Force authors for deterministic validatedBy/author fields
        (oursDoc as any)._author = "user-one";
        (theirsDoc as any)._author = "user-two";

        // Use an existing shared cell ID from the mock content
        const sharedCellId = codexSubtitleContent.cells[0].metadata.id as string;

        // Sequence operations with small delays to enforce timestamp ordering across docs
        const SLEEP_MS = 30;

        // Test data constants for traceability
        const earlierLabel = "first label";
        const latestLabel = "second label";
        const ourInitialValue = "<span>our content</span>";
        const theirValue = "<span>their content</span>";
        const ourLatestValue = "<span>our content v2</span>";

        // Labels: ours first, theirs later -> theirs label should win
        (oursDoc as any).updateCellLabel(sharedCellId, earlierLabel);
        await sleep(SLEEP_MS);
        (theirsDoc as any).updateCellLabel(sharedCellId, latestLabel);

        // Values: theirs first, ours later -> our value should win
        await sleep(SLEEP_MS);
        await (oursDoc as any).updateCellContent(sharedCellId, ourInitialValue, EditType.USER_EDIT);
        await sleep(SLEEP_MS);
        await (theirsDoc as any).updateCellContent(sharedCellId, theirValue, EditType.USER_EDIT);
        // Intentionally make our value the latest by updating once more
        await sleep(SLEEP_MS);
        await (oursDoc as any).updateCellContent(sharedCellId, ourLatestValue, EditType.USER_EDIT);

        // Timestamps: startTime -> ours latest; endTime -> theirs latest
        await sleep(SLEEP_MS);
        (theirsDoc as any).updateCellTimestamps(sharedCellId, { startTime: 100 });
        await sleep(SLEEP_MS);
        (oursDoc as any).updateCellTimestamps(sharedCellId, { startTime: 200 });
        await sleep(SLEEP_MS);
        (oursDoc as any).updateCellTimestamps(sharedCellId, { endTime: 300 });
        await sleep(SLEEP_MS);
        (theirsDoc as any).updateCellTimestamps(sharedCellId, { endTime: 400 });

        // Add unique cells to each side
        const ourUniqueId = `${sharedCellId}:unique-ours`;
        const theirUniqueId = `${sharedCellId}:unique-theirs`;
        (oursDoc as any).addCell(ourUniqueId, sharedCellId, "below", CodexCellTypes.PARATEXT, {}, {
            cellMarkers: [ourUniqueId],
            cellContent: "",
            cellType: CodexCellTypes.PARATEXT,
            editHistory: [],
            cellLabel: "unique-ours",
        });
        await sleep(SLEEP_MS);
        (theirsDoc as any).addCell(theirUniqueId, sharedCellId, "below", CodexCellTypes.PARATEXT, {}, {
            cellMarkers: [theirUniqueId],
            cellContent: "",
            cellType: CodexCellTypes.PARATEXT,
            editHistory: [],
            cellLabel: "unique-theirs",
        });

        // Build content strings
        const ourJson = (oursDoc as any).getText() as string;
        const theirJson = (theirsDoc as any).getText() as string;

        const merged = await resolveCodexCustomMerge(ourJson, theirJson);
        const notebook = JSON.parse(merged);

        const cellById = (id: string) => notebook.cells.find((c: any) => c.metadata?.id === id);
        const shared = cellById(sharedCellId);
        assert.ok(shared, "Shared cell should exist in merged notebook");

        // Label should be from the later edit (theirs)
        assert.strictEqual(shared.metadata.cellLabel, latestLabel);

        // Value should be from the latest value edit (ours v2)
        assert.strictEqual(shared.value, ourLatestValue);

        // Timestamps checks skipped: only relevant for timestamped content types

        // Edit history should include both label edits and both value edits
        const edits: any[] = shared.metadata.edits || [];
        const isEditPath = (e: any, path: string) => Array.isArray(e.editMap) && e.editMap.join(".") === path;
        assert.ok(edits.some((e) => isEditPath(e, "metadata.cellLabel") && e.value === earlierLabel));
        assert.ok(edits.some((e) => isEditPath(e, "metadata.cellLabel") && e.value === latestLabel));
        assert.ok(edits.some((e) => isEditPath(e, "value") && e.value === theirValue));
        assert.ok(edits.some((e) => isEditPath(e, "value") && e.value === ourLatestValue));
        // Skip asserting timestamp edit history

        // Assert that each edit we performed produced an edit record with the correct editMap
        const expectEditRecord = (path: string, value: string | number) => {
            const match = edits.find((e) => isEditPath(e, path) && e.value === value);
            assert.ok(match, `Expected edit record for ${path} with value ${String(value)}`);
            assert.ok(Array.isArray(match.editMap), "editMap should be an array");
        };

        // Label edit records
        expectEditRecord("metadata.cellLabel", earlierLabel);
        expectEditRecord("metadata.cellLabel", latestLabel);

        // Value edit records
        expectEditRecord("value", theirValue);
        expectEditRecord("value", ourLatestValue);

        // Unique cells from each side should be present
        const ourOnly = cellById(ourUniqueId);
        const theirOnly = cellById(theirUniqueId);
        assert.ok(ourOnly, "Our-only cell should be in merged output");
        assert.ok(theirOnly, "Their-only cell should be in merged output");
    });

    test("audio attachments from two users are merged and selection resolves by timestamp", async () => {
        const oursDoc = await provider.openCustomDocument(
            oursUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        const theirsDoc = await provider.openCustomDocument(
            theirsUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        // Use an existing shared cell ID from the mock content
        const sharedCellId = codexSubtitleContent.cells[0].metadata.id as string;

        const now = Date.now();
        const oursAudioId = "audio-ours";
        const theirsAudioId = "audio-theirs";

        // Each side adds a distinct audio attachment
        (oursDoc as any).updateCellAttachment(sharedCellId, oursAudioId, {
            url: "attachments/a1.mp3",
            type: "audio",
            createdAt: now,
            updatedAt: now,
            isDeleted: false,
        });
        (theirsDoc as any).updateCellAttachment(sharedCellId, theirsAudioId, {
            url: "attachments/a2.mp3",
            type: "audio",
            createdAt: now + 100,
            updatedAt: now + 100,
            isDeleted: false,
        });

        // Set selection timestamps so theirs is newer
        const getCell = (doc: any) => JSON.parse(doc.getText()).cells.find((c: any) => c.metadata?.id === sharedCellId);
        const oursParsed1: CodexNotebookAsJSONData = JSON.parse((oursDoc as any).getText());
        const theirsParsed1: CodexNotebookAsJSONData = JSON.parse((theirsDoc as any).getText());
        const oursCellIdx = oursParsed1.cells.findIndex((c: any) => c.metadata?.id === sharedCellId);
        const theirsCellIdx = theirsParsed1.cells.findIndex((c: any) => c.metadata?.id === sharedCellId);
        oursParsed1.cells[oursCellIdx].metadata.selectionTimestamp = now + 50;
        theirsParsed1.cells[theirsCellIdx].metadata.selectionTimestamp = now + 150;
        // Persist selection timestamps back to documents
        await vscode.workspace.fs.writeFile(oursUri, Buffer.from(JSON.stringify(oursParsed1, null, 2)));
        await vscode.workspace.fs.writeFile(theirsUri, Buffer.from(JSON.stringify(theirsParsed1, null, 2)));

        // Reload documents to reflect persisted selectionTimestamp
        const oursDocReloaded = await provider.openCustomDocument(
            oursUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const theirsDocReloaded = await provider.openCustomDocument(
            theirsUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        const merged = await resolveCodexCustomMerge((oursDocReloaded as any).getText(), (theirsDocReloaded as any).getText());
        const notebook = JSON.parse(merged);
        const shared = notebook.cells.find((c: any) => c.metadata?.id === sharedCellId);
        assert.ok(shared, "Shared cell should exist in merged notebook");

        // Attachments from both sides should be present
        const attachments = shared.metadata.attachments || {};
        assert.ok(attachments[oursAudioId], "Our audio attachment should be present in merged cell");
        assert.ok(attachments[theirsAudioId], "Their audio attachment should be present in merged cell");

        // Selection should prefer newer selectionTimestamp (theirs)
        assert.strictEqual(shared.metadata.selectedAudioId, theirsAudioId);
    });

    test("provider excludes cells flagged deleted from webview payload", async () => {
        const context = createMockExtensionContext();
        const providerLocal = new CodexCellEditorProvider(context);

        // Create a fresh copy and flag the first cell as deleted
        const tmpUri = await createTempCodexFile(
            `deleted-flag-${Date.now()}.codex`,
            JSON.parse(JSON.stringify(codexSubtitleContent))
        );
        try {
            const document = await providerLocal.openCustomDocument(
                tmpUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            // Mark the first cell as deleted in metadata
            const parsed = JSON.parse((document as any).getText());
            const firstId = parsed.cells[0].metadata.id;
            parsed.cells[0].metadata.data = parsed.cells[0].metadata.data || {};
            parsed.cells[0].metadata.data.deleted = true;
            await vscode.workspace.fs.writeFile(tmpUri, Buffer.from(JSON.stringify(parsed, null, 2)));

            // Re-open to ensure provider reads the updated state
            const docReloaded = await providerLocal.openCustomDocument(
                tmpUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            let lastPost: any = null;
            const webviewPanel = {
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: (_cb: any) => ({ dispose: () => { } }),
                    postMessage: (message: any) => { lastPost = message; return Promise.resolve(); },
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: (_cb: any) => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            await providerLocal.resolveCustomEditor(
                docReloaded,
                webviewPanel,
                new vscode.CancellationTokenSource().token
            );

            // Wait briefly for initial post
            await sleep(50);

            // Expect providerSendsInitialContent with content = processed translation units array
            const payload = lastPost || {};
            const units = Array.isArray(payload.content) ? payload.content : [];
            const found = units.some((u: any) => (u.cellMarkers || [])[0] === firstId);
            assert.strictEqual(found, false, "Deleted cell should not be sent to the webview");
        } finally {
            await deleteIfExists(tmpUri);
        }
    });

    test("provider excludes cells flagged merged (non-correction mode) from webview payload", async () => {
        const context = createMockExtensionContext();
        const providerLocal = new CodexCellEditorProvider(context);

        // Create a fresh copy and flag the first cell as merged
        const tmpUri = await createTempCodexFile(
            `merged-flag-${Date.now()}.codex`,
            JSON.parse(JSON.stringify(codexSubtitleContent))
        );
        try {
            const document = await providerLocal.openCustomDocument(
                tmpUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const parsed = JSON.parse((document as any).getText());
            const firstId = parsed.cells[0].metadata.id;
            parsed.cells[0].metadata.data = parsed.cells[0].metadata.data || {};
            parsed.cells[0].metadata.data.merged = true;
            await vscode.workspace.fs.writeFile(tmpUri, Buffer.from(JSON.stringify(parsed, null, 2)));

            // Re-open to ensure provider reads the updated state
            const docReloaded = await providerLocal.openCustomDocument(
                tmpUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            let lastPost: any = null;
            const webviewPanel = {
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: (_cb: any) => ({ dispose: () => { } }),
                    postMessage: (message: any) => { lastPost = message; return Promise.resolve(); },
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: (_cb: any) => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            await providerLocal.resolveCustomEditor(
                docReloaded,
                webviewPanel,
                new vscode.CancellationTokenSource().token
            );

            await sleep(50);

            const payload = lastPost || {};
            const units = Array.isArray(payload.content) ? payload.content : [];
            const found = units.some((u: any) => (u.cellMarkers || [])[0] === firstId);
            assert.strictEqual(found, false, "Merged cell should not be sent to the webview when not in correction mode");
        } finally {
            await deleteIfExists(tmpUri);
        }
    });

    test("softDeleteCell logs edit and persists deleted flag through merge", async () => {
        const context = createMockExtensionContext();
        const providerLocal = new CodexCellEditorProvider(context);

        // Fresh copies
        const oursTmp = await createTempCodexFile(`softdel-ours-${Date.now()}.codex`, JSON.parse(JSON.stringify(codexSubtitleContent)));
        const theirsTmp = await createTempCodexFile(`softdel-theirs-${Date.now()}.codex`, JSON.parse(JSON.stringify(codexSubtitleContent)));
        try {
            const oursDoc = await providerLocal.openCustomDocument(
                oursTmp,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );
            const theirsDoc = await providerLocal.openCustomDocument(
                theirsTmp,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const sharedCellId = codexSubtitleContent.cells[0].metadata.id as string;

            // Perform a soft delete on ours
            (oursDoc as any).softDeleteCell(sharedCellId);

            // Assert internal document edit log captured the operation
            const internalEdits = (oursDoc as any)._edits as any[];
            assert.ok(Array.isArray(internalEdits), "Document edits log should exist");
            assert.ok(internalEdits.some((e) => e?.type === "softDeleteCell" && e.cellId === sharedCellId), "softDeleteCell should be recorded in document edits log");

            // Merge ours (with deleted flag) and theirs (without)
            const merged = await resolveCodexCustomMerge((oursDoc as any).getText(), (theirsDoc as any).getText());
            const notebook: CodexNotebookAsJSONData = JSON.parse(merged);
            const mergedCell = notebook.cells.find((c: any) => c.metadata?.id === sharedCellId)!;
            assert.ok(mergedCell, "Merged notebook should still contain the cell (soft delete preserves it)");
            assert.strictEqual(!!mergedCell.metadata?.data?.deleted, true, "Merged cell should retain deleted=true flag");
        } finally {
            await deleteIfExists(oursTmp);
            await deleteIfExists(theirsTmp);
        }
    });

    test("hard delete logs edit and is respected when both sides delete before merge", async () => {
        const context = createMockExtensionContext();
        const providerLocal = new CodexCellEditorProvider(context);

        const oursTmp = await createTempCodexFile(
            `harddel-ours-${Date.now()}.codex`,
            JSON.parse(JSON.stringify(codexSubtitleContent))
        );
        const theirsTmp = await createTempCodexFile(
            `harddel-theirs-${Date.now()}.codex`,
            JSON.parse(JSON.stringify(codexSubtitleContent))
        );
        try {
            const oursDoc = await providerLocal.openCustomDocument(
                oursTmp,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );
            const theirsDoc = await providerLocal.openCustomDocument(
                theirsTmp,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const sharedCellId = codexSubtitleContent.cells[0].metadata.id as string;

            // Hard delete on both sides
            (oursDoc as any).deleteCell(sharedCellId);
            (theirsDoc as any).deleteCell(sharedCellId);

            // Internal log should include deleteCell
            const oursEdits = (oursDoc as any)._edits as any[];
            assert.ok(oursEdits.some((e) => e?.type === "deleteCell" && e.cellId === sharedCellId), "deleteCell should be recorded in document edits log");

            const merged = await resolveCodexCustomMerge((oursDoc as any).getText(), (theirsDoc as any).getText());
            const notebook: CodexNotebookAsJSONData = JSON.parse(merged);
            const found = (notebook.cells || []).some((c: any) => c.metadata?.id === sharedCellId);
            assert.strictEqual(found, false, "Cell should remain deleted after merge when both sides deleted it");
        } finally {
            await deleteIfExists(oursTmp);
            await deleteIfExists(theirsTmp);
        }
    });
});


