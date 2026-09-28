import * as assert from "assert";
import type { CustomNotebookCellData } from "../../../../types";
import {
    collectBookCodes,
    findByBookCoverage,
    normalizeBaseName,
    pairBiblicaNotebooks,
} from "../../../projectManager/utils/biblicaMigration/biblicaMigrationRunner";

type PairableNotebook = Parameters<typeof pairBiblicaNotebooks>[0][number];

const notebook = (fields: {
    baseName: string;
    originalHash?: string;
    translatedCellCount?: number;
    hasSegmentedSourceMarkup?: boolean;
    books?: string[];
}): PairableNotebook =>
    ({
        codexUri: undefined,
        sourceUri: undefined,
        baseName: fields.baseName,
        displayName: fields.baseName,
        originalHash: fields.originalHash ?? "",
        originalFileName: "",
        hasSegmentedSourceMarkup: fields.hasSegmentedSourceMarkup ?? true,
        translatedCellCount: fields.translatedCellCount ?? 0,
        bookCodes: new Set(fields.books ?? []),
        metadata: {},
        sourceCells: [],
        codexCells: [],
    }) as unknown as PairableNotebook;

const sourceCell = (references: string[]): CustomNotebookCellData =>
    ({
        kind: 2,
        value: "<p>text</p>",
        languageId: "html",
        metadata: { id: references.join("|"), type: "text", data: { globalReferences: references } },
    }) as unknown as CustomNotebookCellData;

const GOSPELS = ["MAT", "MRK", "LUK", "JHN"];
const PENTATEUCH = ["GEN", "EXO", "LEV", "NUM", "DEU"];

suite("biblicaMigration pairing", () => {
    suite("normalizeBaseName", () => {
        test("strips the right-to-left typeset marker Biblica adds", () => {
            assert.strictEqual(normalizeBaseName("ACT-REV_R-L"), "act-rev");
            assert.strictEqual(normalizeBaseName("ACT-REV-RTL"), "act-rev");
            assert.strictEqual(normalizeBaseName("ACT-REV_L-R"), "act-rev");
        });

        test("strips a re-import's NEW prefix and the importer's uuid suffix", () => {
            assert.strictEqual(
                normalizeBaseName("NEW ACT-REV_R-L-de43dcf5-6ca2-4e09-bc9e-0e2e9b77d9cb"),
                "act-rev"
            );
        });

        test("still collapses the old naming variants onto the same key", () => {
            assert.strictEqual(normalizeBaseName("GEN-DEU-notes"), "gen-deu");
            assert.strictEqual(normalizeBaseName("MAT-JOHN-1"), "mat-john");
        });
    });

    suite("collectBookCodes", () => {
        test("reduces verse-level references to book codes", () => {
            const codes = collectBookCodes([
                sourceCell(["GEN", "GEN 1:1", "GEN 1:2"]),
                sourceCell(["EXO 40:38"]),
            ]);

            assert.deepStrictEqual([...codes].sort(), ["EXO", "GEN"]);
        });

        test("returns an empty set for front matter with no references", () => {
            assert.strictEqual(collectBookCodes([sourceCell([])]).size, 0);
        });
    });

    suite("findByBookCoverage", () => {
        test("matches the volume covering the same books", () => {
            const index = findByBookCoverage({ bookCodes: new Set(GOSPELS) }, [
                { bookCodes: new Set(PENTATEUCH) },
                { bookCodes: new Set(GOSPELS) },
            ]);

            assert.strictEqual(index, 1);
        });

        test("tolerates a book missing from the re-import", () => {
            const index = findByBookCoverage({ bookCodes: new Set(GOSPELS) }, [
                { bookCodes: new Set(["MAT", "MRK", "LUK"]) },
                { bookCodes: new Set(PENTATEUCH) },
            ]);

            assert.strictEqual(index, 0);
        });

        test("refuses to choose between two volumes covering the same books", () => {
            const index = findByBookCoverage({ bookCodes: new Set(GOSPELS) }, [
                { bookCodes: new Set(GOSPELS) },
                { bookCodes: new Set(GOSPELS) },
            ]);

            assert.strictEqual(index, undefined);
        });

        test("ignores volumes with no books at all", () => {
            assert.strictEqual(
                findByBookCoverage({ bookCodes: new Set(GOSPELS) }, [{ bookCodes: new Set() }]),
                undefined
            );
            assert.strictEqual(
                findByBookCoverage({ bookCodes: new Set() }, [{ bookCodes: new Set(GOSPELS) }]),
                undefined
            );
        });

        test("rejects a volume that merely overlaps a little", () => {
            assert.strictEqual(
                findByBookCoverage({ bookCodes: new Set(GOSPELS) }, [
                    { bookCodes: new Set(["MAT", ...PENTATEUCH]) },
                ]),
                undefined
            );
        });
    });

    suite("pairBiblicaNotebooks", () => {
        test("pairs a right-to-left re-import that was also renamed", () => {
            // The Arabic project: translations came from MAT-JOHN.idml but the
            // re-import is the re-typeset MAT-JHN_R-L.idml, so neither the hash nor
            // the name lines up.
            const { pairs, unpaired } = pairBiblicaNotebooks([
                notebook({
                    baseName: "MAT-JOHN-1-8c9ee4e1",
                    originalHash: "5702849142c711f2",
                    translatedCellCount: 880,
                    hasSegmentedSourceMarkup: false,
                    books: GOSPELS,
                }),
                notebook({
                    baseName: "MAT-JHN_R-L-15f4185a",
                    originalHash: "dbb5370ad72fe080",
                    books: GOSPELS,
                }),
            ]);

            assert.strictEqual(unpaired.length, 0);
            assert.strictEqual(pairs.length, 1);
            assert.strictEqual(pairs[0].pairedBy, "bookCoverage");
            assert.strictEqual(pairs[0].new.baseName, "MAT-JHN_R-L-15f4185a");
        });

        test("keeps each volume with its own books when several are re-imported", () => {
            const { pairs } = pairBiblicaNotebooks([
                notebook({
                    baseName: "GEN-DEU-notes",
                    translatedCellCount: 600,
                    hasSegmentedSourceMarkup: false,
                    books: PENTATEUCH,
                }),
                notebook({
                    baseName: "MAT-JOHN-1",
                    translatedCellCount: 880,
                    hasSegmentedSourceMarkup: false,
                    books: GOSPELS,
                }),
                notebook({ baseName: "MAT-JHN_R-L", books: GOSPELS }),
                notebook({ baseName: "GEN-DEU_R-L", books: PENTATEUCH }),
            ]);

            const byOld = new Map(pairs.map((pair) => [pair.old.baseName, pair.new.baseName]));
            assert.strictEqual(byOld.get("GEN-DEU-notes"), "GEN-DEU_R-L");
            assert.strictEqual(byOld.get("MAT-JOHN-1"), "MAT-JHN_R-L");
        });

        test("prefers the hash when the same file really was re-imported", () => {
            const { pairs } = pairBiblicaNotebooks([
                notebook({
                    baseName: "ACT-REV-old",
                    originalHash: "same-hash",
                    translatedCellCount: 700,
                    books: GOSPELS,
                }),
                notebook({ baseName: "ACT-REV-decoy", books: GOSPELS }),
                notebook({ baseName: "ACT-REV-new", originalHash: "same-hash", books: GOSPELS }),
            ]);

            assert.strictEqual(pairs.length, 1);
            assert.strictEqual(pairs[0].pairedBy, "originalHash");
            assert.strictEqual(pairs[0].new.baseName, "ACT-REV-new");
        });

        test("falls back to the name for matter that carries no book markers", () => {
            const { pairs } = pairBiblicaNotebooks([
                notebook({ baseName: "FRT", translatedCellCount: 40, books: [] }),
                notebook({
                    baseName: "FRT_R-L-ab3631d5-31df-425a-9ba4-44052cadd890",
                    books: [],
                }),
            ]);

            assert.strictEqual(pairs.length, 1);
            assert.strictEqual(pairs[0].pairedBy, "baseName");
        });

        test("leaves a re-import with no old counterpart alone", () => {
            const { pairs, unpaired } = pairBiblicaNotebooks([
                notebook({
                    baseName: "GEN-DEU-notes",
                    translatedCellCount: 600,
                    books: PENTATEUCH,
                }),
                notebook({ baseName: "GEN-DEU_R-L", books: PENTATEUCH }),
                notebook({ baseName: "BACK_R-L", books: [] }),
            ]);

            assert.strictEqual(pairs.length, 1);
            assert.strictEqual(unpaired.length, 0);
            assert.strictEqual(pairs[0].new.baseName, "GEN-DEU_R-L");
        });

        test("reports an old notebook that has no re-import as unpaired", () => {
            const { pairs, unpaired } = pairBiblicaNotebooks([
                notebook({ baseName: "ISA-MAL", translatedCellCount: 1476, books: ["ISA", "MAL"] }),
            ]);

            assert.strictEqual(pairs.length, 0);
            assert.deepStrictEqual(unpaired.map((n) => n.baseName), ["ISA-MAL"]);
        });
    });
});
