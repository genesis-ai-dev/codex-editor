import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { CodexNotebookReader } from "../../../serializer";
import type { CompletionConfig } from "../../../utils/llmUtils";
import { llmCompletion } from "../../../providers/translationSuggestions/llmCompletion";

const cellId = "dictionary-cell-1";
const sourceHtml =
    '<p class="indesign-paragraph" data-story-id="story-1">' +
    '<span class="idml-segment" data-segment-index="0" data-character-style="Bold">Reference</span>' +
    '<span class="idml-eoc" data-eoc="1" aria-hidden="true"></span>' +
    '<span class="idml-segment" data-segment-index="1" data-character-style="Body">Dictionary explanation</span>' +
    "</p>";

const config: CompletionConfig = {
    endpoint: "https://example.test/api/v1",
    apiKey: "test-key",
    model: "default",
    contextSize: "small",
    additionalResourceDirectory: "",
    contextOmission: false,
    sourceBookWhitelist: "",
    temperature: 0.2,
    mainChatLanguage: "English",
    chatSystemMessage: "Translate accurately.",
    numberOfFewShotExamples: 2,
    debugMode: false,
    useOnlyValidatedExamples: false,
    abTestingEnabled: false,
    allowHtmlPredictions: false,
    fewShotExampleFormat: "source-and-target",
};

const reader = {
    getCellIndex: async () => 0,
    getCellIds: async () => [cellId],
    cellsUpTo: async () => [],
    getEffectiveCellContent: async () => "",
} as unknown as CodexNotebookReader;

suite("IDML structured LLM completion", () => {
    let executeCommandStub: sinon.SinonStub;
    let callLLMStub: sinon.SinonStub;
    let statusStub: sinon.SinonStub;

    setup(async () => {
        executeCommandStub = sinon.stub(vscode.commands, "executeCommand").callsFake(
            async (command: string) => {
                if (command === "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells") {
                    return { cellId, content: sourceHtml };
                }
                if (command === "codex-editor-extension.getTranslationPairsFromSourceCellQuery") {
                    return [];
                }
                return undefined;
            },
        );

        const llmUtils = await import("../../../utils/llmUtils");
        callLLMStub = sinon.stub(llmUtils, "callLLM");

        const extension = await import("../../../extension");
        statusStub = sinon.stub(extension, "getAutoCompleteStatusBarItem").returns({
            show: () => undefined,
            hide: () => undefined,
        } as vscode.StatusBarItem);
    });

    teardown(() => {
        executeCommandStub.restore();
        callLLMStub.restore();
        statusStub.restore();
    });

    test("uses one structured request and returns deterministically reconstructed HTML", async () => {
        callLLMStub.resolves({
            content: JSON.stringify({
                segments: [
                    { index: 0, translation: "Referencia" },
                    { index: 1, translation: "Explicación del diccionario" },
                ],
            }),
            generationId: "generation-structured",
        });

        const result = await llmCompletion(
            reader,
            cellId,
            config,
            new vscode.CancellationTokenSource().token,
            true,
            false,
            { enforceHtmlStructure: true },
        );

        assert.strictEqual(callLLMStub.callCount, 1);
        assert.strictEqual(result.generationId, "generation-structured");
        assert.strictEqual(result.variants[0], sourceHtml
            .replace("Reference", "Referencia")
            .replace("Dictionary explanation", "Explicación del diccionario"));

        const [messages, , , options] = callLLMStub.firstCall.args;
        const systemMessage = messages.find((message: { role: string; }) => message.role === "system");
        const userMessage = messages.find((message: { role: string; }) => message.role === "user");
        assert.ok(systemMessage.content.includes("JSON object"));
        assert.ok(!systemMessage.content.includes("<final_answer>"));
        assert.ok(userMessage.content.includes('"index": 0'));
        assert.ok(userMessage.content.includes('"sourceText": "Reference"'));
        assert.strictEqual(options.responseFormat.type, "json_schema");
    });

    test("falls back to the established completion when structured output is malformed", async () => {
        callLLMStub.onFirstCall().resolves({ content: "not-json", generationId: "bad-generation" });
        callLLMStub.onSecondCall().resolves({
            content: "<final_answer>Legacy translation</final_answer>",
            generationId: "legacy-generation",
        });

        const result = await llmCompletion(
            reader,
            cellId,
            config,
            new vscode.CancellationTokenSource().token,
            true,
            false,
            { enforceHtmlStructure: true },
        );

        assert.strictEqual(callLLMStub.callCount, 2);
        assert.strictEqual(callLLMStub.firstCall.args[3].responseFormat.type, "json_schema");
        assert.strictEqual(callLLMStub.secondCall.args[3], undefined);
        assert.deepStrictEqual(result.variants, ["Legacy translation", "Legacy translation"]);
        assert.strictEqual(result.generationId, "legacy-generation");
    });

    test("does not turn cancellation into a legacy retry", async () => {
        callLLMStub.rejects(new vscode.CancellationError());

        await assert.rejects(
            llmCompletion(
                reader,
                cellId,
                config,
                new vscode.CancellationTokenSource().token,
                true,
                false,
                { enforceHtmlStructure: true },
            ),
            (error: unknown) => error instanceof vscode.CancellationError,
        );
        assert.strictEqual(callLLMStub.callCount, 1);
    });

    test("keeps the legacy request for single-segment IDML", async () => {
        const singleSegmentSource =
            '<p><span class="idml-segment" data-segment-index="0">Only segment</span></p>';
        executeCommandStub.callsFake(async (command: string) => {
            if (command === "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells") {
                return { cellId, content: singleSegmentSource };
            }
            if (command === "codex-editor-extension.getTranslationPairsFromSourceCellQuery") return [];
            return undefined;
        });
        callLLMStub.resolves({ content: "<final_answer>Translation</final_answer>" });

        const result = await llmCompletion(
            reader,
            cellId,
            config,
            new vscode.CancellationTokenSource().token,
            true,
            false,
            { enforceHtmlStructure: true },
        );

        assert.strictEqual(callLLMStub.callCount, 1);
        assert.strictEqual(callLLMStub.firstCall.args[3], undefined);
        assert.deepStrictEqual(result.variants, ["Translation", "Translation"]);
    });

    test("keeps the legacy request when structure enforcement is disabled", async () => {
        callLLMStub.resolves({ content: "<final_answer>Translation</final_answer>" });

        const result = await llmCompletion(
            reader,
            cellId,
            config,
            new vscode.CancellationTokenSource().token,
            true,
            false,
            { enforceHtmlStructure: false },
        );

        assert.strictEqual(callLLMStub.callCount, 1);
        assert.strictEqual(callLLMStub.firstCall.args[3], undefined);
        assert.deepStrictEqual(result.variants, ["Translation", "Translation"]);
    });
});
