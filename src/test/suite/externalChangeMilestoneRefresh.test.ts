import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellDocument } from "../../providers/codexCellEditorProvider/codexDocument";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { EditMapUtils } from "../../utils/editMapUtils";
import {
    swallowDuplicateCommandRegistrations,
    createTempCodexFile,
    deleteIfExists,
    createMockExtensionContext,
} from "../testUtils";

function milestoneCell(id: string, label: string) {
    return {
        kind: 2,
        languageId: "html",
        value: label,
        metadata: {
            id,
            type: CodexCellTypes.MILESTONE,
            edits: [
                {
                    editMap: EditMapUtils.value(),
                    value: label,
                    timestamp: 1754800000000,
                    type: EditType.INITIAL_IMPORT,
                    author: "importer",
                    validatedBy: [],
                },
            ],
        },
    };
}

function textCell(id: string, value: string) {
    return {
        kind: 2,
        languageId: "html",
        value,
        metadata: { id, type: CodexCellTypes.TEXT, data: {}, edits: [] },
    };
}

function notebook(cells: any[]) {
    return {
        cells,
        metadata: { id: "GEN", originalName: "GEN", sourceFsPath: "", codexFsPath: "" },
    };
}

/** Mock panel that records every message posted to the webview. */
function createRecordingWebviewPanel(): { panel: vscode.WebviewPanel; messages: any[] } {
    const messages: any[] = [];
    const webview: Partial<vscode.Webview> = {
        html: "",
        options: { enableScripts: true },
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource: "https://example.com",
        onDidReceiveMessage: () => ({ dispose: () => { } }) as vscode.Disposable,
        postMessage: async (message: any) => {
            messages.push(message);
            return true;
        },
    };
    const panel = {
        webview: webview as vscode.Webview,
        onDidDispose: () => ({ dispose: () => { } }),
        onDidChangeViewState: () => ({ dispose: () => { } }),
        reveal: () => { },
        dispose: () => { },
        active: true,
        visible: true,
        title: "mock",
        viewColumn: vscode.ViewColumn.One,
    } as unknown as vscode.WebviewPanel;
    return { panel, messages };
}

suite("External file change - milestone index refresh", () => {
    let context: vscode.ExtensionContext;
    let provider: CodexCellEditorProvider;
    let tempUri: vscode.Uri;
    let document: CodexCellDocument | undefined;

    setup(async () => {
        swallowDuplicateCommandRegistrations();
        context = createMockExtensionContext();
        provider = new CodexCellEditorProvider(context);

        sinon.restore();
        sinon.stub((CodexCellDocument as any).prototype, "addCellToIndexImmediately").callsFake(() => { });
        sinon.stub((CodexCellDocument as any).prototype, "syncDirtyCellsToDatabase").resolves();
        sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();

        tempUri = await createTempCodexFile(
            `milestone-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
            notebook([
                milestoneCell("milestone-one", "1"),
                textCell("GEN 1:1", "<span>in the beginning</span>"),
            ])
        );
    });

    teardown(async () => {
        document?.dispose();
        document = undefined;
        if (tempUri) await deleteIfExists(tempUri);
    });

    test("reloadDocumentFromDiskAndRefresh sends the rebuilt milestone index after an external rewrite", async () => {
        document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        const { panel, messages } = createRecordingWebviewPanel();

        // Simulate an open webview with a tracked position — the state a real
        // editor is in when a sync merge rewrites the file underneath it.
        provider.currentMilestoneSubsectionMap.set(document.uri.toString(), {
            milestoneIndex: 0,
            subsectionIndex: 0,
        });

        // Simulate a sync merge writing a merged file with a new renamed milestone.
        const merged = notebook([
            milestoneCell("milestone-one", "1"),
            textCell("GEN 1:1", "<span>in the beginning</span>"),
            milestoneCell("milestone-two", "Second"),
            textCell("GEN 2:1", "<span>thus the heavens</span>"),
        ]);
        await vscode.workspace.fs.writeFile(
            tempUri,
            Buffer.from(JSON.stringify(merged, null, 2), "utf8")
        );

        await provider.reloadDocumentFromDiskAndRefresh(document, panel);

        // The in-memory document must reflect the merged file...
        assert.ok(
            document.getText().includes("milestone-two"),
            "Document should be reloaded from disk"
        );

        // ...and the webview must receive the rebuilt milestone index, not just
        // a refreshCurrentPage position ping.
        const indexUpdates = messages.filter(
            (m) => m.type === "providerSendsInitialContentPaginated"
        );
        assert.strictEqual(indexUpdates.length, 1, "Should send exactly one full index update");
        const milestoneValues = indexUpdates[0].milestoneIndex.milestones.map(
            (m: any) => m.value
        );
        assert.deepStrictEqual(
            milestoneValues,
            ["1", "Second"],
            "Milestone index should include the externally added milestone"
        );
        assert.strictEqual(
            indexUpdates[0].force,
            true,
            "Refresh must be forced so the webview's stale guard doesn't reject it"
        );

        const pageRefreshes = messages.filter((m) => m.type === "refreshCurrentPage");
        assert.strictEqual(
            pageRefreshes.length,
            0,
            "Must not send a follow-up refreshCurrentPage; that reloads cells and jumps scroll"
        );
    });
});
