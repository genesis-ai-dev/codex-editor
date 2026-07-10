import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { CompletionConfig } from "../../../utils/llmUtils";
import type { CodexCellDocument } from "../../../providers/codexCellEditorProvider/codexDocument";
import {
    maybeAutoResolveHtmlStructure,
    resolveHtmlStructureWithLLM,
    stripMarkdownCodeFences,
} from "../../../providers/codexCellEditorProvider/utils/htmlStructureResolver";

const mockConfig = { model: "test" } as CompletionConfig;

const createMockDocument = (enforceHtmlStructure: boolean): CodexCellDocument =>
    ({
        getNotebookMetadata: () => ({ enforceHtmlStructure }),
    }) as CodexCellDocument;

suite("htmlStructureResolver", () => {
    suite("stripMarkdownCodeFences", () => {
        test("returns content unchanged when no fences", () => {
            assert.strictEqual(stripMarkdownCodeFences("<p>Hello</p>"), "<p>Hello</p>");
        });

        test("strips html code fences", () => {
            const input = "```html\n<p>Hello</p>\n```";
            assert.strictEqual(stripMarkdownCodeFences(input), "<p>Hello</p>");
        });

        test("strips plain code fences", () => {
            const input = "```\n<p>Hello</p>\n```";
            assert.strictEqual(stripMarkdownCodeFences(input), "<p>Hello</p>");
        });
    });

    suite("resolveHtmlStructureWithLLM", () => {
        test("uses callLLM override when provided", async () => {
            const callLLMOverride = sinon.stub().resolves({ content: "```html\n<p>Fixed</p>\n```" });

            const resolved = await resolveHtmlStructureWithLLM(
                "<p>Source</p>",
                "Translation",
                mockConfig,
                callLLMOverride,
            );

            assert.strictEqual(resolved, "<p>Fixed</p>");
            assert.strictEqual(callLLMOverride.callCount, 1);
        });
    });

    suite("maybeAutoResolveHtmlStructure", () => {
        let executeCommandStub: sinon.SinonStub;

        setup(() => {
            executeCommandStub = sinon.stub(vscode.commands, "executeCommand");
        });

        teardown(() => {
            executeCommandStub.restore();
        });

        test("returns translation unchanged when enforcement is off", async () => {
            const result = await maybeAutoResolveHtmlStructure(
                "GEN 1:1",
                "Translated text",
                createMockDocument(false),
            );

            assert.strictEqual(result, "Translated text");
            assert.strictEqual(executeCommandStub.callCount, 0);
        });

        test("returns translation unchanged when structures already match", async () => {
            executeCommandStub.resolves({ cellId: "GEN 1:1", content: "<p>Hello</p>" });

            const result = await maybeAutoResolveHtmlStructure(
                "GEN 1:1",
                "<p>Hola</p>",
                createMockDocument(true),
            );

            assert.strictEqual(result, "<p>Hola</p>");
        });

        test("calls resolve when structures mismatch", async () => {
            executeCommandStub.resolves({ cellId: "GEN 1:1", content: "<p>Hello</p><br/>" });
            const resolveWithLLM = sinon.stub().resolves("<p>Hola</p><br/>");
            const onResolving = sinon.stub();

            const result = await maybeAutoResolveHtmlStructure(
                "GEN 1:1",
                "<p>Hola</p>",
                createMockDocument(true),
                {
                    config: mockConfig,
                    onResolving,
                    resolveWithLLM,
                },
            );

            assert.strictEqual(result, "<p>Hola</p><br/>");
            assert.strictEqual(resolveWithLLM.callCount, 1);
            assert.strictEqual(onResolving.callCount, 1);
        });

        test("returns raw translation when resolve throws", async () => {
            executeCommandStub.resolves({ cellId: "GEN 1:1", content: "<p>Hello</p><br/>" });
            const resolveWithLLM = sinon.stub().rejects(new Error("LLM failed"));

            const result = await maybeAutoResolveHtmlStructure(
                "GEN 1:1",
                "<p>Hola</p>",
                createMockDocument(true),
                {
                    config: mockConfig,
                    resolveWithLLM,
                },
            );

            assert.strictEqual(result, "<p>Hola</p>");
        });

        test("returns raw translation when source cell is missing", async () => {
            executeCommandStub.resolves(null);

            const result = await maybeAutoResolveHtmlStructure(
                "GEN 1:1",
                "<p>Hola</p>",
                createMockDocument(true),
            );

            assert.strictEqual(result, "<p>Hola</p>");
        });
    });
});
