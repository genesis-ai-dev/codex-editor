import * as assert from "assert";
import * as vscode from "vscode";
import sinon from "sinon";
import { fetchFewShotExamples } from "../../providers/translationSuggestions/shared";
import { getTranslationPairsFromSourceCellQuery } from "../../activationHelpers/contextAware/contentIndexes/indexes/search";
import { SQLiteIndexManager } from "../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndex";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { codexSubtitleContent } from "./mocks/codexSubtitleContent";
import { createMockExtensionContext, createTempCodexFile, deleteIfExists } from "../testUtils";
import { initializeABTesting } from "../../utils/abTestingSetup";

suite("Validated-only examples behavior", () => {
    test("getTranslationPairsFromSourceCellQuery forwards onlyValidated and maps results", async () => {
        const validatedCellId = "GEN 1:1";
        const unvalidatedCellId = "GEN 1:2";

        let capturedOnlyValidated: boolean | null = null;
        const mockIndex: any = {
            searchCompleteTranslationPairsWithValidation: async (_q: string, _k: number, _raw: boolean, onlyValidated: boolean) => {
                capturedOnlyValidated = onlyValidated;
                // Simulate DB already applied validation filter; return both to ensure mapping doesn't filter
                return [
                    { cell_id: validatedCellId, sourceContent: "s1", targetContent: "t1" },
                    { cell_id: unvalidatedCellId, sourceContent: "s2", targetContent: "t2" },
                ];
            },
            getTranslationPair: async (cellId: string) => ({ cellId, sourceContent: "s", targetContent: "t" }),
        };
        // Trick instanceof check used by implementation
        Object.setPrototypeOf(mockIndex, (SQLiteIndexManager as any).prototype);

        const pairs = await getTranslationPairsFromSourceCellQuery(mockIndex, "beginning", 10, true);
        assert.strictEqual(capturedOnlyValidated, true, "Should pass onlyValidated=true to SQLite search");
        const ids = pairs.map((p) => p.cellId);
        assert.ok(ids.includes(validatedCellId));
        assert.ok(ids.includes(unvalidatedCellId));
    });

    test("fetchFewShotExamples requests only validated via command and returns only validated", async () => {
        const validatedCellId = "GEN 1:1";
        let capturedOnlyValidated: boolean | null = null;

        const originalExecute = vscode.commands.executeCommand;
        // stub command to capture onlyValidated and return only validated item
        (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
            if (command === "codex-editor-extension.getTranslationPairsFromSourceCellQuery") {
                const [_query, _k, onlyValidated] = args as [string, number, boolean];
                capturedOnlyValidated = onlyValidated;
                return [
                    {
                        cellId: validatedCellId,
                        sourceCell: { cellId: validatedCellId, content: "s1" },
                        targetCell: { cellId: validatedCellId, content: "t1" },
                    },
                ];
            }
            return originalExecute.apply(vscode.commands, [command, ...args]);
        };

        // Pass a different currentCellId to avoid filtering out the only returned example
        const examples = await fetchFewShotExamples("In the beginning God created the heavens and the earth.", "GEN 1:99", 5, true);

        // restore
        (vscode.commands as any).executeCommand = originalExecute;

        assert.strictEqual(capturedOnlyValidated, true, "Few-shot should request only validated examples");
        const ids = examples.map((e) => e.cellId);
        assert.deepStrictEqual(ids, [validatedCellId], "Few-shot should contain only validated examples");
    });

    test("fetchFewShotExamples requests all when onlyValidated=false and returns both", async () => {
        const validatedCellId = "GEN 1:1";
        const unvalidatedCellId = "GEN 1:2";
        let capturedOnlyValidated: boolean | null = null;

        const originalExecute = vscode.commands.executeCommand;
        // stub command to capture onlyValidated and return both items
        (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
            if (command === "codex-editor-extension.getTranslationPairsFromSourceCellQuery") {
                const [_query, _k, onlyValidated] = args as [string, number, boolean];
                capturedOnlyValidated = onlyValidated;
                return [
                    {
                        cellId: validatedCellId,
                        sourceCell: { cellId: validatedCellId, content: "s1" },
                        targetCell: { cellId: validatedCellId, content: "t1" },
                    },
                    {
                        cellId: unvalidatedCellId,
                        sourceCell: { cellId: unvalidatedCellId, content: "s2" },
                        targetCell: { cellId: unvalidatedCellId, content: "t2" },
                    },
                ];
            }
            return originalExecute.apply(vscode.commands, [command, ...args]);
        };

        // Use a different currentCellId so neither example is filtered out
        const examples = await fetchFewShotExamples("In the beginning God created the heavens and the earth.", "GEN 1:99", 5, false);

        // restore
        (vscode.commands as any).executeCommand = originalExecute;

        assert.strictEqual(capturedOnlyValidated, false, "Few-shot should request all examples when onlyValidated=false");
        const ids = examples.map((e) => e.cellId).sort();
        assert.deepStrictEqual(ids, [unvalidatedCellId, validatedCellId].sort(), "Few-shot should contain both validated and unvalidated examples when flag is false");
    });

    test("cell editor llmCompletion (with AB testing) queries only validated examples via SQLite", async () => {
        // Ensure AB testing registry is initialized
        initializeABTesting();

        // Force AB testing to trigger
        const originalGetConfig = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            const cfg = originalGetConfig.call(vscode.workspace, section);
            if (section === "codex-editor-extension") {
                return {
                    get: (key: string) => {
                        if (key === "abTestingEnabled") return true;
                        if (key === "abTestingProbability") return 1; // force
                        if (key === "useOnlyValidatedExamples") return true;
                        if (key === "searchAlgorithm") return "fts5-bm25";
                        return (cfg as any)?.get?.(key);
                    }
                } as any;
            }
            return cfg as any;
        };

        // Stub executeCommand to capture onlyValidated forwarded from AB test path
        let capturedOnlyValidated: boolean | null = null;
        const origExec = vscode.commands.executeCommand;
        (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
            if (command === "codex-editor-extension.getTranslationPairsFromSourceCellQueryWithAlgorithm") {
                // args: alg, query, k, onlyValidated
                capturedOnlyValidated = Boolean(args[3]);
                // Return minimal valid pairs
                return [
                    {
                        cellId: "GEN 1:1",
                        sourceCell: { cellId: "GEN 1:1", content: "s1" },
                        targetCell: { cellId: "GEN 1:1", content: "t1" },
                    },
                    {
                        cellId: "GEN 1:2",
                        sourceCell: { cellId: "GEN 1:2", content: "s2" },
                        targetCell: { cellId: "GEN 1:2", content: "t2" },
                    },
                ];
            }
            if (command === "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells") {
                return { cellId: args[0], content: "In the beginning", versions: [], notebookId: "nb" };
            }
            return origExec.apply(vscode.commands, [command, ...args]);
        };

        // Stub callLLM to avoid network and return deterministic strings for AB variants
        const llmUtils = await import("../../utils/llmUtils");
        const callStub = sinon.stub(llmUtils, "callLLM").resolves("PREDICTED");

        // Stub status bar item used by llmCompletion
        const extModule = await import("../../extension");
        const statusStub = sinon.stub(extModule as any, "getAutoCompleteStatusBarItem").returns({
            show: () => { },
            hide: () => { },
        });

        // Stub CodexNotebookReader methods used by llmCompletion to avoid real notebook IO
        const serializerMod = await import("../../serializer");
        const idxStub = sinon.stub(serializerMod.CodexNotebookReader.prototype, "getCellIndex").resolves(0 as any);
        const idsStub = sinon.stub(serializerMod.CodexNotebookReader.prototype, "getCellIds").resolves(["GEN 1:1"] as any);
        const upToStub = sinon.stub(serializerMod.CodexNotebookReader.prototype, "cellsUpTo").resolves([] as any);

        // Create document and trigger llmCompletion via provider queue
        const context = createMockExtensionContext();
        const provider = new CodexCellEditorProvider(context);

        const tmp = await createTempCodexFile(`validated-ab-${Date.now()}.codex`, codexSubtitleContent);
        try {
            const doc = await provider.openCustomDocument(tmp, { backupId: undefined }, new vscode.CancellationTokenSource().token);
            const webviewPanel = {
                webview: {
                    onDidReceiveMessage: (_: any) => ({ dispose: () => { } }),
                    postMessage: () => true,
                    asWebviewUri: (u: vscode.Uri) => u,
                    cspSource: "",
                    html: "",
                },
                onDidChangeViewState: (_: any) => ({ dispose: () => { } }),
                onDidDispose: (_: any) => ({ dispose: () => { } }),
                reveal: () => { },
                dispose: () => { },
                title: "",
                viewType: "",
                visible: true,
                active: true,
            } as any as vscode.WebviewPanel;
            await provider.resolveCustomEditor(doc, webviewPanel, new vscode.CancellationTokenSource().token);

            // Enqueue one translation request; this will call performLLMCompletionInternal -> llmCompletion
            const cellId = codexSubtitleContent.cells[0].metadata.id as string;
            const promise = new Promise((resolve, reject) => {
                (provider as any).translationQueue.push({
                    cellId,
                    document: doc,
                    shouldUpdateValue: false,
                    resolve,
                    reject,
                });
            });
            // Start queue processing
            (provider as any).processTranslationQueue().catch(() => { });
            await promise;

            assert.strictEqual(capturedOnlyValidated, true, "AB-tested llmCompletion should request only validated examples");
            assert.ok(callStub.called, "LLM should be called after fetching validated examples");
        } finally {
            (vscode.commands as any).executeCommand = origExec;
            (vscode.workspace as any).getConfiguration = originalGetConfig;
            callStub.restore();
            statusStub.restore();
            idxStub.restore();
            idsStub.restore();
            upToStub.restore();
            await deleteIfExists(tmp);
        }
    });
});


