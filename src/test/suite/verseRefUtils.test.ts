import * as assert from "assert";
import {
    extractVerseRefFromLine,
    getVerseRefFromCellMetadata,
    verseRefRegex,
} from "../../utils/verseRefUtils";

suite("verseRefUtils Test Suite", () => {
    suite("extractVerseRefFromLine", () => {
        test("extracts verse ref from line (e.g. MAT 1:1)", () => {
            assert.strictEqual(extractVerseRefFromLine("Some text MAT 1:1 more"), "MAT 1:1");
            assert.strictEqual(extractVerseRefFromLine("GEN 2:3"), "GEN 2:3");
        });

        test("returns null when no verse ref in line", () => {
            assert.strictEqual(extractVerseRefFromLine("No ref here"), null);
            assert.strictEqual(extractVerseRefFromLine(""), null);
        });
    });

    suite("getVerseRefFromCellMetadata", () => {
        test("returns id when id is legacy verse ref (BOOK 1:1)", () => {
            assert.strictEqual(
                getVerseRefFromCellMetadata({ id: "MAT 1:1" }),
                "MAT 1:1"
            );
            assert.strictEqual(
                getVerseRefFromCellMetadata({ id: "GEN 2:3" }),
                "GEN 2:3"
            );
        });

        test("returns globalReferences[0] when id is UUID (New Source Uploader USFM)", () => {
            assert.strictEqual(
                getVerseRefFromCellMetadata({
                    id: "a1b2c3d4-uuid",
                    data: { globalReferences: ["MAT 1:1"] },
                }),
                "MAT 1:1"
            );
            assert.strictEqual(
                getVerseRefFromCellMetadata({
                    id: "another-uuid",
                    data: { globalReferences: ["GEN 3:15"] },
                }),
                "GEN 3:15"
            );
        });

        test("builds verse ref from bookCode, chapter, verse when id is not verse ref", () => {
            assert.strictEqual(
                getVerseRefFromCellMetadata({
                    id: "uuid",
                    bookCode: "MRK",
                    chapter: 1,
                    verse: 1,
                }),
                "MRK 1:1"
            );
            assert.strictEqual(
                getVerseRefFromCellMetadata({
                    bookCode: "JHN",
                    chapter: 4,
                    verse: 24,
                }),
                "JHN 4:24"
            );
        });

        test("prefers id over globalReferences when both are verse refs", () => {
            assert.strictEqual(
                getVerseRefFromCellMetadata({
                    id: "LUK 5:5",
                    data: { globalReferences: ["LUK 5:6"] },
                }),
                "LUK 5:5"
            );
        });

        test("prefers globalReferences over bookCode/chapter/verse when id is not verse ref", () => {
            assert.strictEqual(
                getVerseRefFromCellMetadata({
                    id: "uuid",
                    data: { globalReferences: ["ACT 2:1"] },
                    bookCode: "ACT",
                    chapter: 1,
                    verse: 1,
                }),
                "ACT 2:1"
            );
        });

        test("returns null for invalid or missing metadata", () => {
            assert.strictEqual(getVerseRefFromCellMetadata(null as any), null);
            assert.strictEqual(getVerseRefFromCellMetadata(undefined as any), null);
            assert.strictEqual(getVerseRefFromCellMetadata({}), null);
        });

        test("returns null when id is UUID and no globalReferences or book/chapter/verse", () => {
            assert.strictEqual(
                getVerseRefFromCellMetadata({ id: "uuid-only" }),
                null
            );
            assert.strictEqual(
                getVerseRefFromCellMetadata({
                    id: "uuid",
                    data: { globalReferences: [] },
                }),
                null
            );
        });

        test("returns null when bookCode/chapter/verse incomplete", () => {
            assert.strictEqual(
                getVerseRefFromCellMetadata({ bookCode: "MAT", chapter: 1 }),
                null
            );
            assert.strictEqual(
                getVerseRefFromCellMetadata({ chapter: 1, verse: 1 }),
                null
            );
        });

        test("trims bookCode when building from bookCode/chapter/verse", () => {
            assert.strictEqual(
                getVerseRefFromCellMetadata({
                    bookCode: "  MAT  ",
                    chapter: 1,
                    verse: 1,
                }),
                "MAT 1:1"
            );
        });
    });

    suite("verseRefRegex", () => {
        test("matches 3-char book code and chapter:verse", () => {
            assert.ok(verseRefRegex.test("MAT 1:1"));
            assert.ok(verseRefRegex.test("GEN 2:3"));
        });
    });
});
