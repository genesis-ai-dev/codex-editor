import * as assert from "assert";
import { buildUsfmBody, type UsfmExportCell } from "../../../exportHandler/usfmBodyBuilder";

function verseCell(ref: string, text: string): UsfmExportCell {
    return {
        metadata: {
            type: "text",
            id: "00000000-0000-0000-0000-000000000000",
            data: { globalReferences: [ref] },
        },
        value: `<span>${text}</span>`,
    };
}

function paratextCell(text: string, marker?: string): UsfmExportCell {
    return {
        metadata: {
            type: "paratext",
            id: "parent-id:paratext-1234567890-abcdefghi",
            ...(marker ? { marker } : {}),
        },
        value: `<span>${text}</span>`,
    };
}

/**
 * Covers the Pattani Malay heading-export bug: paratext section headings
 * entered before a chapter's first verse must land inside that chapter
 * (after its \c marker), not in the previous chapter or book front matter.
 */
suite("USFM export - paratext heading placement and markers", () => {
    test("chapter-leading paratext lands after its chapter's \\c marker as \\s1 when option is on", () => {
        const { body, verseCount, hasVerses } = buildUsfmBody(
            [
                paratextCell("Heading A"),
                verseCell("MAT 1:1", "Alpha"),
                verseCell("MAT 1:2", "Beta"),
                paratextCell("Heading B"),
                verseCell("MAT 2:1", "Gamma"),
            ],
            { paratextAsHeadings: true }
        );

        assert.strictEqual(
            body,
            "\\c 1\n\\s1 Heading A\n\\p\n\\v 1 Alpha\n\\v 2 Beta\n" +
            "\\c 2\n\\s1 Heading B\n\\p\n\\v 1 Gamma\n"
        );
        assert.strictEqual(verseCount, 3);
        assert.strictEqual(hasVerses, true);
    });

    test("mid-chapter paratext heading stays inline with a paragraph restart", () => {
        const { body } = buildUsfmBody(
            [
                verseCell("MAT 1:1", "Alpha"),
                paratextCell("Mid Heading"),
                verseCell("MAT 1:2", "Beta"),
            ],
            { paratextAsHeadings: true }
        );

        assert.strictEqual(
            body,
            "\\c 1\n\\p\n\\v 1 Alpha\n\\s1 Mid Heading\n\\p\n\\v 2 Beta\n"
        );
    });

    test("with option off, paratext exports as \\p but still in the correct chapter", () => {
        const { body } = buildUsfmBody([
            paratextCell("Heading A"),
            verseCell("MAT 1:1", "Alpha"),
        ]);

        assert.strictEqual(body, "\\c 1\n\\p Heading A\n\\p\n\\v 1 Alpha\n");
    });

    test("importer-preserved markers pass through regardless of the option", () => {
        const { body } = buildUsfmBody([
            paratextCell("Section Title", "\\s"),
            verseCell("MAT 1:1", "Alpha"),
            paratextCell("Poetry line", "\\q1"),
            verseCell("MAT 1:2", "Beta"),
        ]);

        assert.strictEqual(
            body,
            "\\c 1\n\\s Section Title\n\\p\n\\v 1 Alpha\n\\q1 Poetry line\n\\v 2 Beta\n"
        );
    });

    test("explicit heading tags in content map to \\s markers even with option off", () => {
        const headingCell: UsfmExportCell = {
            metadata: { type: "paratext", id: "parent:paratext-1-x" },
            value: "<h2>Formatted Title</h2>",
        };
        const { body } = buildUsfmBody([
            verseCell("MAT 1:1", "Alpha"),
            headingCell,
            verseCell("MAT 1:2", "Beta"),
        ]);

        assert.strictEqual(
            body,
            "\\c 1\n\\p\n\\v 1 Alpha\n\\s1 Formatted Title\n\\p\n\\v 2 Beta\n"
        );
    });

    test("bold-formatted paratext keeps a paragraph marker with the option off (\\bd is not a paragraph opener)", () => {
        const boldCell: UsfmExportCell = {
            metadata: { type: "paratext", id: "parent:paratext-2-x" },
            value: "<span><strong>Bold Heading</strong></span>",
        };
        const { body } = buildUsfmBody([
            verseCell("MAT 1:1", "Alpha"),
            boldCell,
            verseCell("MAT 1:2", "Beta"),
        ]);

        assert.strictEqual(
            body,
            "\\c 1\n\\p\n\\v 1 Alpha\n\\p \\bd Bold Heading\\bd*\n\\v 2 Beta\n"
        );
    });

    test("bold-formatted paratext exports as \\s1 with the option on, character markup nested inside", () => {
        const boldCell: UsfmExportCell = {
            metadata: { type: "paratext", id: "parent:paratext-3-x" },
            value: "<span><strong>Bold Heading</strong></span>",
        };
        const { body } = buildUsfmBody(
            [
                verseCell("MAT 1:1", "Alpha"),
                boldCell,
                verseCell("MAT 1:2", "Beta"),
            ],
            { paratextAsHeadings: true }
        );

        assert.strictEqual(
            body,
            "\\c 1\n\\p\n\\v 1 Alpha\n\\s1 \\bd Bold Heading\\bd*\n\\p\n\\v 2 Beta\n"
        );
    });

    test("\\sup-leading content is not a paragraph opener and is not classified as a heading", () => {
        const supCell: UsfmExportCell = {
            metadata: { type: "paratext", id: "parent:paratext-4-x" },
            value: "<span><sup>2</sup> footnote text</span>",
        };
        const { body } = buildUsfmBody([
            verseCell("MAT 1:1", "Alpha"),
            supCell,
            verseCell("MAT 1:2", "Beta"),
        ]);

        // \p prefix added, and no \p restart after (not a heading).
        assert.strictEqual(
            body,
            "\\c 1\n\\p\n\\v 1 Alpha\n\\p \\sup 2\\sup* footnote text\n\\v 2 Beta\n"
        );
    });

    test("literal paragraph-level markers in content pass through; \\sp is not a heading", () => {
        const speakerCell: UsfmExportCell = {
            metadata: { type: "paratext", id: "parent:paratext-5-x" },
            value: "<span>\\sp Jesus</span>",
        };
        const { body } = buildUsfmBody([
            verseCell("MAT 1:1", "Alpha"),
            speakerCell,
            verseCell("MAT 1:2", "Beta"),
        ]);

        // Passes through as-is, no \p restart (only \s markers are headings).
        assert.strictEqual(
            body,
            "\\c 1\n\\p\n\\v 1 Alpha\n\\sp Jesus\n\\v 2 Beta\n"
        );
    });

    test("legacy 'Chapter N' paratext cells still open chapters without duplicate \\c markers", () => {
        const legacyChapterCell: UsfmExportCell = {
            metadata: { type: "paratext", id: "legacy-1" },
            value: "<h1>Chapter 1</h1>",
        };
        const { body } = buildUsfmBody([
            legacyChapterCell,
            verseCell("MAT 1:1", "Alpha"),
        ]);

        assert.strictEqual(body, "\\c 1\n\\p\n\\v 1 Alpha\n");
    });

    test("paratext after the last verse stays in the final chapter", () => {
        const { body } = buildUsfmBody(
            [
                verseCell("MAT 1:1", "Alpha"),
                paratextCell("Trailing note"),
            ],
            { paratextAsHeadings: true }
        );

        assert.strictEqual(
            body,
            "\\c 1\n\\p\n\\v 1 Alpha\n\\s1 Trailing note\n\\p\n"
        );
    });
});
