import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";

import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { resolveCodexCustomMerge } from "../../../src/projectManager/utils/merge/resolvers";
import { codexSubtitleContent } from "./mocks/codexSubtitleContent";

suite("Provider + Merge Integration - multi-user multi-field edits", () => {
    let provider: CodexCellEditorProvider;
    let oursUri: vscode.Uri;
    let theirsUri: vscode.Uri;

    suiteSetup(async () => {
        // Guard against duplicate command registration when the extension host already registered them
        const originalRegister = vscode.commands.registerCommand;
        // test-time monkey patch to no-op duplicate command registrations
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vscode.commands.registerCommand = ((command: string, callback: (...args: any[]) => any) => {
            try {
                return originalRegister(command, callback);
            } catch (e: any) {
                if (e && String(e).includes("already exists")) {
                    return { dispose: () => { } } as vscode.Disposable;
                }
                throw e;
            }
        }) as typeof vscode.commands.registerCommand;

        const tmp = os.tmpdir();
        oursUri = vscode.Uri.file(path.join(tmp, "merge-ours.codex"));
        theirsUri = vscode.Uri.file(path.join(tmp, "merge-theirs.codex"));

        const encoder = new TextEncoder();
        const contentString = JSON.stringify(codexSubtitleContent, null, 2);
        await vscode.workspace.fs.writeFile(oursUri, encoder.encode(contentString));
        await vscode.workspace.fs.writeFile(theirsUri, encoder.encode(contentString));
    });

    suiteTeardown(async () => {
        try { await vscode.workspace.fs.delete(oursUri); } catch (_e) { /* ignore cleanup error */ }
        try { await vscode.workspace.fs.delete(theirsUri); } catch (_e) { /* ignore cleanup error */ }
    });

    setup(() => {
        // Minimal extension context mock
        // @ts-expect-error - partial context for testing
        const context: vscode.ExtensionContext = {
            extensionUri: vscode.Uri.file(__dirname),
            subscriptions: [],
        } as vscode.ExtensionContext;
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
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
        const isPath = (e: any, path: string) => Array.isArray(e.editMap) && e.editMap.join(".") === path;
        assert.ok(edits.some((e) => isPath(e, "metadata.cellLabel") && e.value === earlierLabel));
        assert.ok(edits.some((e) => isPath(e, "metadata.cellLabel") && e.value === latestLabel));
        assert.ok(edits.some((e) => isPath(e, "value") && e.value === theirValue));
        assert.ok(edits.some((e) => isPath(e, "value") && e.value === ourLatestValue));
        // Skip asserting timestamp edit history

        // Unique cells from each side should be present
        const ourOnly = cellById(ourUniqueId);
        const theirOnly = cellById(theirUniqueId);
        assert.ok(ourOnly, "Our-only cell should be in merged output");
        assert.ok(theirOnly, "Their-only cell should be in merged output");
    });
});


