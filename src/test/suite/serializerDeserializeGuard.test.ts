import * as assert from "assert";
import * as vscode from "vscode";
import { CodexContentSerializer, NotebookDeserializationError } from "../../serializer";

/**
 * Issue #1119: deserializeNotebook used to convert any parse failure into a
 * silently-empty notebook ({ cells: [] }), which downstream writers then
 * persisted over real files — erasing all translations. These tests pin the
 * new contract: invalid content throws, it never fabricates an empty notebook.
 */
suite("CodexContentSerializer.deserializeNotebook guard", () => {
    const serializer = new CodexContentSerializer();
    const token = new vscode.CancellationTokenSource().token;
    const encode = (text: string) => new TextEncoder().encode(text);

    test("throws on empty content", async () => {
        await assert.rejects(
            () => serializer.deserializeNotebook(encode(""), token),
            NotebookDeserializationError
        );
    });

    test("throws on truncated JSON (mid-write read)", async () => {
        const full = JSON.stringify({
            cells: [{ kind: 2, value: "translation text", languageId: "html", metadata: { id: "c1" } }],
            metadata: { edits: [] },
        });
        const truncated = full.slice(0, Math.floor(full.length / 2));
        await assert.rejects(
            () => serializer.deserializeNotebook(encode(truncated), token),
            NotebookDeserializationError
        );
    });

    test("throws on invalid JSON", async () => {
        await assert.rejects(
            () => serializer.deserializeNotebook(encode("{ not json }"), token),
            NotebookDeserializationError
        );
    });

    test("throws on valid JSON without a cells array", async () => {
        await assert.rejects(
            () => serializer.deserializeNotebook(encode('{"metadata":{}}'), token),
            NotebookDeserializationError
        );
        await assert.rejects(
            () => serializer.deserializeNotebook(encode('"just a string"'), token),
            NotebookDeserializationError
        );
    });

    test("parses a valid notebook and preserves cells and metadata", async () => {
        const notebook = {
            cells: [{ kind: 2, value: "hello", languageId: "html", metadata: { id: "c1" } }],
            metadata: { edits: [], corpusMarker: "subtitles" },
        };
        const result = await serializer.deserializeNotebook(
            encode(JSON.stringify(notebook)),
            token
        );
        assert.strictEqual(result.cells.length, 1);
        assert.strictEqual(result.cells[0].value, "hello");
        assert.strictEqual((result.metadata as any).corpusMarker, "subtitles");
    });

    test("parses a genuinely empty notebook (explicit empty cells array)", async () => {
        const result = await serializer.deserializeNotebook(
            encode('{"cells":[],"metadata":{"edits":[]}}'),
            token
        );
        assert.strictEqual(result.cells.length, 0);
    });
});
