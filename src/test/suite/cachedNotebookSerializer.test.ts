import * as assert from "assert";
import { serializeNotebookWithCellCache } from "../../providers/codexCellEditorProvider/utils/cachedNotebookSerializer";
import { formatJsonForNotebookFile } from "../../utils/notebookFileFormattingUtils";

/**
 * Byte-equivalence tests for the cached serializer.
 *
 * The cache is a CPU optimisation, not a format change: the bytes written to
 * disk must remain identical to what `formatJsonForNotebookFile` produces, so
 * we compare them on a representative range of inputs.
 */

function makeCell(id: string, value = "<p>Hello</p>", extra: Record<string, unknown> = {}) {
    return {
        kind: 2,
        value,
        languageId: "html",
        metadata: {
            id,
            type: "text",
            edits: [],
            data: {},
            ...extra,
        },
    };
}

suite("cachedNotebookSerializer", () => {
    test("matches formatJsonForNotebookFile for an empty document", () => {
        const data = { cells: [], metadata: { id: "doc-1" } };
        const cache = new Map<string, string>();
        const ours = serializeNotebookWithCellCache(data, cache);
        const reference = formatJsonForNotebookFile(data);
        assert.strictEqual(ours, reference);
    });

    test("matches formatJsonForNotebookFile for a single-cell document", () => {
        const data = {
            cells: [makeCell("c1")],
            metadata: { id: "doc-2", originalName: "Doc Two" },
        };
        const cache = new Map<string, string>();
        const ours = serializeNotebookWithCellCache(data, cache);
        const reference = formatJsonForNotebookFile(data);
        assert.strictEqual(ours, reference);
    });

    test("matches formatJsonForNotebookFile for a multi-cell document", () => {
        const data = {
            cells: [
                makeCell("a"),
                makeCell("b", "<p>World</p>"),
                makeCell("c", "<p>Third</p>", {
                    edits: [
                        {
                            editMap: ["value"],
                            value: "<p>edit</p>",
                            timestamp: 123,
                            type: "user-edit",
                            author: "alice",
                            validatedBy: [],
                        },
                    ],
                }),
            ],
            metadata: {
                id: "doc-3",
                originalName: "Doc Three",
                navigation: [],
                edits: [
                    { editMap: ["metadata", "originalName"], value: "Doc Three", timestamp: 1 },
                ],
            },
        };
        const cache = new Map<string, string>();
        const ours = serializeNotebookWithCellCache(data, cache);
        const reference = formatJsonForNotebookFile(data);
        assert.strictEqual(ours, reference);
    });

    test("matches formatJsonForNotebookFile for nested objects with arrays", () => {
        const data = {
            cells: [
                makeCell("x", "<p>Nested</p>", {
                    attachments: {
                        "audio-1": { url: "files/foo.wav", type: "audio" },
                    },
                    data: {
                        startTime: 1.5,
                        endTime: 3.25,
                        globalReferences: ["ref1", "ref2"],
                    },
                }),
            ],
            metadata: {
                id: "doc-4",
                navigation: [
                    { kind: "book", label: "Genesis", children: [] },
                ],
            },
        };
        const cache = new Map<string, string>();
        const ours = serializeNotebookWithCellCache(data, cache);
        const reference = formatJsonForNotebookFile(data);
        assert.strictEqual(ours, reference);
    });

    test("populates the cache on first call", () => {
        const data = {
            cells: [makeCell("a"), makeCell("b")],
            metadata: { id: "doc-5" },
        };
        const cache = new Map<string, string>();
        serializeNotebookWithCellCache(data, cache);
        assert.strictEqual(cache.size, 2);
        assert.ok(cache.has("a"));
        assert.ok(cache.has("b"));
    });

    test("reuses cached entries on subsequent calls", () => {
        const data = {
            cells: [makeCell("a"), makeCell("b")],
            metadata: { id: "doc-6" },
        };
        const cache = new Map<string, string>();
        const first = serializeNotebookWithCellCache(data, cache);

        // Mutate cell 'a' in place but DO NOT invalidate the cache.
        // Output must still reflect the previous (cached) value of cell 'a'.
        data.cells[0].value = "<p>changed but cache stale</p>";
        const second = serializeNotebookWithCellCache(data, cache);
        assert.strictEqual(second, first, "cache should win when entry not invalidated");

        // Now invalidate the cache for cell 'a' and re-serialize. Output should
        // reflect the mutation.
        cache.delete("a");
        const third = serializeNotebookWithCellCache(data, cache);
        assert.notStrictEqual(third, first, "cache invalidation should pick up mutation");
        const reference = formatJsonForNotebookFile(data);
        assert.strictEqual(third, reference);
    });

    test("handles cells without an id by skipping the cache", () => {
        const data = {
            cells: [
                { kind: 2, value: "anonymous", languageId: "html", metadata: {} },
            ],
            metadata: { id: "doc-7" },
        };
        const cache = new Map<string, string>();
        const ours = serializeNotebookWithCellCache(data, cache);
        const reference = formatJsonForNotebookFile(data);
        assert.strictEqual(ours, reference);
        assert.strictEqual(cache.size, 0, "cells without ids should not enter the cache");
    });

    test("handles multi-line embedded values (HTML in cell value)", () => {
        const data = {
            cells: [
                makeCell("ml", "<p>line1</p>\n<p>line2</p>\n<p>line3</p>"),
            ],
            metadata: { id: "doc-8" },
        };
        const cache = new Map<string, string>();
        const ours = serializeNotebookWithCellCache(data, cache);
        const reference = formatJsonForNotebookFile(data);
        assert.strictEqual(ours, reference);
    });
});
