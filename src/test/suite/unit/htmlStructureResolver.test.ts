import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { CompletionConfig } from "../../../utils/llmUtils";
import type { CodexCellDocument } from "../../../providers/codexCellEditorProvider/codexDocument";
import {
    maybeAutoResolveHtmlStructure,
    maybeRepairStructureDeterministically,
    resolveHtmlStructureWithLLM,
    stripMarkdownCodeFences,
    verifyResolvedContent,
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

    suite("verifyResolvedContent", () => {
        test("accepts output whose structure matches the source", () => {
            const result = verifyResolvedContent(
                "<p>Hello</p><br/>",
                "<p>Hola</p>",
                "<p>Hola</p><br/>",
            );
            assert.strictEqual(result, "<p>Hola</p><br/>");
        });

        test("rejects output whose structure still mismatches", () => {
            const result = verifyResolvedContent(
                "<p>Hello</p>",
                "<p><span>Hola</span></p>",
                "<p><span>Hola</span></p>",
            );
            assert.strictEqual(result, null);
        });

        test("rejects output that reverted to the source-language text", () => {
            const result = verifyResolvedContent(
                "<p>Hello world</p>",
                "<p>Hola mundo</p>",
                "<p>Hello world</p>",
            );
            assert.strictEqual(result, null);
        });

        test("accepts identical text when the original was already identical", () => {
            const result = verifyResolvedContent(
                "<p>Amen</p>",
                "Amen",
                "<p>Amen</p>",
            );
            assert.strictEqual(result, "<p>Amen</p>");
        });
    });

    suite("maybeRepairStructureDeterministically", () => {
        let executeCommandStub: sinon.SinonStub;

        setup(() => {
            executeCommandStub = sinon.stub(vscode.commands, "executeCommand");
        });

        teardown(() => {
            executeCommandStub.restore();
        });

        const styledSource =
            '<p style="line-height: 2"><span style="font-family: Arial">To the church of God</span></p>';

        test("returns content unchanged when enforcement is off", async () => {
            const result = await maybeRepairStructureDeterministically(
                "cell-1",
                "<p>Hola</p>",
                createMockDocument(false),
            );
            assert.strictEqual(result, "<p>Hola</p>");
            assert.strictEqual(executeCommandStub.callCount, 0);
        });

        test("re-wraps a Quill-stripped save with the source's styled wrappers", async () => {
            executeCommandStub.resolves({ cellId: "cell-1", content: styledSource });

            const result = await maybeRepairStructureDeterministically(
                "cell-1",
                "<p>A la iglesia de Dios </p>",
                createMockDocument(true),
            );
            assert.strictEqual(
                result,
                '<p style="line-height: 2"><span style="font-family: Arial">A la iglesia de Dios </span></p>',
            );
        });

        test("returns content unchanged when structures already match", async () => {
            executeCommandStub.resolves({ cellId: "cell-1", content: "<p>Hello</p>" });

            const result = await maybeRepairStructureDeterministically(
                "cell-1",
                "<p>Hola</p>",
                createMockDocument(true),
            );
            assert.strictEqual(result, "<p>Hola</p>");
        });

        test("returns content unchanged when no deterministic fix applies", async () => {
            executeCommandStub.resolves({ cellId: "cell-1", content: "<p>Hello</p><br/><p>World</p>" });

            const result = await maybeRepairStructureDeterministically(
                "cell-1",
                "<p>Hola</p>",
                createMockDocument(true),
            );
            assert.strictEqual(result, "<p>Hola</p>");
        });

        test("returns empty content untouched", async () => {
            const result = await maybeRepairStructureDeterministically(
                "cell-1",
                "",
                createMockDocument(true),
            );
            assert.strictEqual(result, "");
            assert.strictEqual(executeCommandStub.callCount, 0);
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

        test("fixes spurious span wrappers deterministically without calling the LLM", async () => {
            executeCommandStub.resolves({ cellId: "GEN 1:1", content: "<p>Hello</p>" });
            const resolveWithLLM = sinon.stub().resolves("should not be called");

            const result = await maybeAutoResolveHtmlStructure(
                "GEN 1:1",
                "<p><span>Hola</span></p>",
                createMockDocument(true),
                {
                    config: mockConfig,
                    resolveWithLLM,
                },
            );

            assert.strictEqual(result, "<p>Hola</p>");
            assert.strictEqual(resolveWithLLM.callCount, 0);
        });

        test("returns raw translation when LLM output fails verification", async () => {
            executeCommandStub.resolves({ cellId: "GEN 1:1", content: "<p>Hello world</p><br/>" });
            // LLM reverts to source-language text — must be rejected.
            const resolveWithLLM = sinon.stub().resolves("<p>Hello world</p><br/>");

            const result = await maybeAutoResolveHtmlStructure(
                "GEN 1:1",
                "<p>Hola mundo</p>",
                createMockDocument(true),
                {
                    config: mockConfig,
                    resolveWithLLM,
                },
            );

            assert.strictEqual(result, "<p>Hola mundo</p>");
            assert.strictEqual(resolveWithLLM.callCount, 1);
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
