import * as assert from "assert";
import type { CustomNotebookCellData } from "../../../../types";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import {
    matchBiblicaCells,
    migrateBiblicaNotebook,
    migrateBiblicaTranslations,
} from "../../../projectManager/utils/biblicaMigration";

const MIGRATION_TIMESTAMP = 1_700_000_000_000;

interface CellOptions {
    id: string;
    value?: string;
    type?: CodexCellTypes;
    story?: string;
    paragraphOrder?: number;
    segmentIndex?: number;
    appliedParagraphStyle?: string;
    edits?: CustomNotebookCellData["metadata"]["edits"];
    cellLabel?: string;
}

const cell = ({
    id,
    value = "",
    type = CodexCellTypes.TEXT,
    story = "u363",
    paragraphOrder = 0,
    segmentIndex = 0,
    appliedParagraphStyle = "ParagraphStyle/intro%3aip",
    edits = [],
    cellLabel,
}: CellOptions): CustomNotebookCellData =>
    ({
        kind: 2,
        value,
        languageId: "html",
        metadata: {
            id,
            type,
            edits,
            appliedParagraphStyle,
            ...(cellLabel ? { cellLabel } : {}),
            data: {
                relationships: {
                    parentStory: story,
                    paragraphOrder,
                    segmentIndex,
                },
            },
        },
    }) as unknown as CustomNotebookCellData;

const valueEdit = (
    value: string,
    timestamp: number,
    validatedBy?: Array<{ username: string; }>
) =>
    ({
        editMap: ["value"],
        value,
        timestamp,
        type: EditType.USER_EDIT,
        author: "translator",
        ...(validatedBy
            ? {
                validatedBy: validatedBy.map((entry) => ({
                    username: entry.username,
                    creationTimestamp: timestamp,
                    updatedTimestamp: timestamp,
                    isDeleted: false,
                })),
            }
            : {}),
    }) as unknown as NonNullable<CustomNotebookCellData["metadata"]["edits"]>[number];

suite("biblicaTranslationMigration", () => {
    suite("matchBiblicaCells", () => {
        test("matches cells by story, paragraph and segment index", () => {
            const oldSource = [cell({ id: "old-1", value: "<span>Hello</span>", paragraphOrder: 4 })];
            const oldCodex = [cell({ id: "old-1", value: "<span>Olá</span>", paragraphOrder: 4 })];
            const newSource = [cell({ id: "new-1", value: "<p><span>Hello</span></p>", paragraphOrder: 4 })];

            const result = matchBiblicaCells({
                oldSourceCells: oldSource,
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
            });

            assert.deepStrictEqual(result.matches, [
                { oldCellId: "old-1", newCellId: "new-1", strategy: "paragraphIdentity" },
            ]);
            assert.strictEqual(result.unmatchedTranslated.length, 0);
            assert.strictEqual(result.newCellsWithoutTranslation.length, 0);
        });

        test("falls back to source text when paragraph identity shifted", () => {
            const oldSource = [cell({ id: "old-1", value: "<span>Wisdom books</span>", paragraphOrder: 2 })];
            const oldCodex = [cell({ id: "old-1", value: "<span>Livros de sabedoria</span>" })];
            const newSource = [
                cell({ id: "new-1", value: "<p><span>Wisdom books</span></p>", paragraphOrder: 9 }),
            ];

            const result = matchBiblicaCells({
                oldSourceCells: oldSource,
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
            });

            assert.deepStrictEqual(result.matches, [
                { oldCellId: "old-1", newCellId: "new-1", strategy: "sourceText" },
            ]);
        });

        test("reports translations whose paragraph is not a cell in the re-import", () => {
            const oldSource = [
                cell({
                    id: "old-1",
                    value: "<span>Psalm 1</span>",
                    paragraphOrder: 7,
                    appliedParagraphStyle: "ParagraphStyle/head%3acl",
                }),
            ];
            const oldCodex = [cell({ id: "old-1", value: "<span>Salmo 1</span>" })];

            const result = matchBiblicaCells({
                oldSourceCells: oldSource,
                oldCodexCells: oldCodex,
                newSourceCells: [],
            });

            assert.strictEqual(result.matches.length, 0);
            assert.strictEqual(result.unmatchedTranslated.length, 1);
            assert.strictEqual(result.unmatchedTranslated[0].reason, "noCounterpartInNewImport");
            assert.strictEqual(
                result.unmatchedTranslated[0].appliedParagraphStyle,
                "ParagraphStyle/head%3acl"
            );
            assert.strictEqual(result.unmatchedTranslated[0].translation, "<span>Salmo 1</span>");
        });

        test("skips old cells that were never translated", () => {
            const oldSource = [cell({ id: "old-1", value: "<span>Hello</span>" })];
            const oldCodex = [cell({ id: "old-1", value: "" })];
            const newSource = [cell({ id: "new-1", value: "<p><span>Hello</span></p>" })];

            const result = matchBiblicaCells({
                oldSourceCells: oldSource,
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
            });

            assert.strictEqual(result.matches.length, 0);
            assert.deepStrictEqual(result.newCellsWithoutTranslation, ["new-1"]);
        });

        test("never claims the same new cell twice", () => {
            const oldSource = [
                cell({ id: "old-1", value: "<span>Same</span>", paragraphOrder: 1 }),
                cell({ id: "old-2", value: "<span>Same</span>", paragraphOrder: 1 }),
            ];
            const oldCodex = [
                cell({ id: "old-1", value: "<span>Primeiro</span>" }),
                cell({ id: "old-2", value: "<span>Segundo</span>" }),
            ];
            const newSource = [
                cell({ id: "new-1", value: "<p><span>Same</span></p>", paragraphOrder: 1 }),
            ];

            const result = matchBiblicaCells({
                oldSourceCells: oldSource,
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
            });

            assert.strictEqual(result.matches.length, 1);
            assert.strictEqual(result.unmatchedTranslated.length, 1);
            assert.strictEqual(result.unmatchedTranslated[0].reason, "newCellAlreadyClaimed");
        });

        test("refuses to guess which slice of a split paragraph a translation belongs to", () => {
            const oldSource = [cell({ id: "old-1", value: "<span>One line</span>", paragraphOrder: 3 })];
            const oldCodex = [cell({ id: "old-1", value: "<span>Uma linha</span>" })];
            // Both new cells share the paragraph identity but neither matches the text.
            const newSource = [
                cell({ id: "new-1", value: "<p><span>Different a</span></p>", paragraphOrder: 3 }),
                cell({ id: "new-2", value: "<p><span>Different b</span></p>", paragraphOrder: 3 }),
            ];

            const result = matchBiblicaCells({
                oldSourceCells: oldSource,
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
            });

            assert.strictEqual(result.matches.length, 0);
            assert.strictEqual(result.unmatchedTranslated[0].reason, "ambiguous");
        });

        test("ignores milestone cells", () => {
            const oldSource = [
                cell({ id: "old-ms", value: "Preface", type: CodexCellTypes.MILESTONE }),
            ];
            const oldCodex = [
                cell({ id: "old-ms", value: "Prefácio", type: CodexCellTypes.MILESTONE }),
            ];
            const newSource = [
                cell({ id: "new-ms", value: "Preface", type: CodexCellTypes.MILESTONE }),
            ];

            const result = matchBiblicaCells({
                oldSourceCells: oldSource,
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
            });

            assert.strictEqual(result.matches.length, 0);
            assert.strictEqual(result.unmatchedTranslated.length, 0);
        });
    });

    suite("migrateBiblicaTranslations", () => {
        test("carries value, edit history and cell label onto the new cell", () => {
            const edits = [valueEdit("<span>Olá</span>", 1_600_000_000_000, [{ username: "ana" }])];
            const oldCodex = [
                cell({ id: "old-1", value: "<span>Olá</span>", edits, cellLabel: "Narrator" }),
            ];
            const newSource = [cell({ id: "new-1", value: "<p><span>Hello</span></p>" })];
            const newCodex = [cell({ id: "new-1", value: "" })];

            const result = migrateBiblicaTranslations({
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
                newCodexCells: newCodex,
                matches: [
                    { oldCellId: "old-1", newCellId: "new-1", strategy: "paragraphIdentity" },
                ],
                options: {
                    author: "migration",
                    applySourceStructure: false,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            assert.strictEqual(result.translationsMigrated, 1);
            const migrated = result.cells[0];
            assert.strictEqual(migrated.value, "<span>Olá</span>");
            assert.strictEqual(migrated.metadata.edits?.length, 1);
            assert.strictEqual(migrated.metadata.edits?.[0].validatedBy?.[0].username, "ana");
            assert.strictEqual(
                (migrated.metadata as { cellLabel?: string; }).cellLabel,
                "Narrator"
            );
        });

        test("keeps the re-imported cell's structural metadata", () => {
            const oldCodex = [
                cell({ id: "old-1", value: "<span>Olá</span>", paragraphOrder: 99, story: "old-story" }),
            ];
            const newSource = [cell({ id: "new-1", value: "<p><span>Hello</span></p>" })];
            const newCodex = [
                cell({
                    id: "new-1",
                    value: "",
                    paragraphOrder: 4,
                    story: "u363",
                    appliedParagraphStyle: "ParagraphStyle/intro%3aili1",
                }),
            ];

            const result = migrateBiblicaTranslations({
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
                newCodexCells: newCodex,
                matches: [
                    { oldCellId: "old-1", newCellId: "new-1", strategy: "paragraphIdentity" },
                ],
                options: {
                    author: "migration",
                    applySourceStructure: false,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            const metadata = result.cells[0].metadata as unknown as {
                appliedParagraphStyle: string;
                data: { relationships: { parentStory: string; paragraphOrder: number; }; };
            };
            assert.strictEqual(metadata.appliedParagraphStyle, "ParagraphStyle/intro%3aili1");
            assert.strictEqual(metadata.data.relationships.parentStory, "u363");
            assert.strictEqual(metadata.data.relationships.paragraphOrder, 4);
        });

        test("does not mutate the input cells", () => {
            const newCodex = [cell({ id: "new-1", value: "" })];
            migrateBiblicaTranslations({
                oldCodexCells: [cell({ id: "old-1", value: "<span>Olá</span>" })],
                newSourceCells: [cell({ id: "new-1", value: "<p><span>Hello</span></p>" })],
                newCodexCells: newCodex,
                matches: [
                    { oldCellId: "old-1", newCellId: "new-1", strategy: "paragraphIdentity" },
                ],
                options: {
                    author: "migration",
                    applySourceStructure: true,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            assert.strictEqual(newCodex[0].value, "");
        });

        test("counts a match as skipped when the cell is missing", () => {
            const result = migrateBiblicaTranslations({
                oldCodexCells: [],
                newSourceCells: [],
                newCodexCells: [cell({ id: "new-1", value: "" })],
                matches: [
                    { oldCellId: "missing", newCellId: "new-1", strategy: "paragraphIdentity" },
                ],
                options: {
                    author: "migration",
                    applySourceStructure: false,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            assert.strictEqual(result.translationsMigrated, 0);
            assert.strictEqual(result.matchesSkipped, 1);
        });
    });

    suite("applySourceStructure", () => {
        test("re-wraps a bare translation with the source's tags", () => {
            const source =
                '<p class="indesign-paragraph" data-paragraph-style="ParagraphStyle/intro%3aip">' +
                '<span class="idml-segment" data-segment-index="0">Hello</span></p>';

            const result = migrateBiblicaTranslations({
                oldCodexCells: [cell({ id: "old-1", value: "<span>Olá</span>" })],
                newSourceCells: [cell({ id: "new-1", value: source })],
                newCodexCells: [cell({ id: "new-1", value: "" })],
                matches: [
                    { oldCellId: "old-1", newCellId: "new-1", strategy: "paragraphIdentity" },
                ],
                options: {
                    author: "migration",
                    applySourceStructure: true,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            const migrated = result.cells[0];
            assert.strictEqual(
                migrated.value,
                '<p class="indesign-paragraph" data-paragraph-style="ParagraphStyle/intro%3aip">' +
                '<span class="idml-segment" data-segment-index="0">Olá</span></p>'
            );
            assert.strictEqual(result.structureOutcomes[0].reason, "resolved");
        });

        test("records a migration edit carrying the previous validation forward", () => {
            const source =
                '<p class="indesign-paragraph"><span class="idml-segment" data-segment-index="0">Hello</span></p>';
            const edits = [valueEdit("<span>Olá</span>", 1_600_000_000_000, [{ username: "ana" }])];

            const result = migrateBiblicaTranslations({
                oldCodexCells: [cell({ id: "old-1", value: "<span>Olá</span>", edits })],
                newSourceCells: [cell({ id: "new-1", value: source })],
                newCodexCells: [cell({ id: "new-1", value: "" })],
                matches: [
                    { oldCellId: "old-1", newCellId: "new-1", strategy: "paragraphIdentity" },
                ],
                options: {
                    author: "migration",
                    applySourceStructure: true,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            const migratedEdits = result.cells[0].metadata.edits ?? [];
            assert.strictEqual(migratedEdits.length, 2);
            const last = migratedEdits[migratedEdits.length - 1];
            assert.strictEqual(last.type, EditType.MIGRATION);
            assert.strictEqual(last.value, result.cells[0].value);
            assert.strictEqual(last.timestamp, MIGRATION_TIMESTAMP);
            assert.strictEqual(last.validatedBy?.[0].username, "ana");
        });

        test("reports cells the deterministic resolver cannot fix and leaves them unchanged", () => {
            // Two source segments cannot be rebuilt from one translated run without
            // deciding where to split the translation, so the cell is left alone.
            const source =
                '<p class="indesign-paragraph">' +
                '<span class="idml-segment" data-segment-index="0">Hello</span>' +
                '<span class="idml-eoc" data-eoc="1" aria-hidden="true"></span>' +
                '<span class="idml-segment" data-segment-index="2">world</span></p>';

            const result = migrateBiblicaTranslations({
                oldCodexCells: [cell({ id: "old-1", value: "<span>Olá mundo</span>" })],
                newSourceCells: [cell({ id: "new-1", value: source })],
                newCodexCells: [cell({ id: "new-1", value: "" })],
                matches: [
                    { oldCellId: "old-1", newCellId: "new-1", strategy: "paragraphIdentity" },
                ],
                options: {
                    author: "migration",
                    applySourceStructure: true,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            assert.strictEqual(result.cells[0].value, "<span>Olá mundo</span>");
            assert.strictEqual(result.structureOutcomes[0].reason, "noDeterministicFix");
            assert.ok(result.structureOutcomes[0].mismatchDetails!.length > 0);
        });

        test("leaves an already-matching translation untouched", () => {
            const source = '<p class="indesign-paragraph"><span class="idml-segment">Hello</span></p>';
            const target = '<p class="indesign-paragraph"><span class="idml-segment">Olá</span></p>';

            const result = migrateBiblicaTranslations({
                oldCodexCells: [cell({ id: "old-1", value: target })],
                newSourceCells: [cell({ id: "new-1", value: source })],
                newCodexCells: [cell({ id: "new-1", value: "" })],
                matches: [
                    { oldCellId: "old-1", newCellId: "new-1", strategy: "paragraphIdentity" },
                ],
                options: {
                    author: "migration",
                    applySourceStructure: true,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            assert.strictEqual(result.cells[0].value, target);
            assert.strictEqual(result.structureOutcomes[0].reason, "alreadyMatching");
            assert.strictEqual(result.cells[0].metadata.edits?.length, 0);
        });
    });

    suite("migrateBiblicaNotebook", () => {
        test("reports totals, match strategies and unmatched styles", () => {
            const oldSource = [
                cell({ id: "old-1", value: "<span>Note</span>", paragraphOrder: 1 }),
                cell({
                    id: "old-2",
                    value: "<span>Psalm 1</span>",
                    paragraphOrder: 2,
                    appliedParagraphStyle: "ParagraphStyle/head%3acl",
                }),
            ];
            const oldCodex = [
                cell({ id: "old-1", value: "<span>Nota</span>" }),
                cell({ id: "old-2", value: "<span>Salmo 1</span>" }),
            ];
            const newSource = [
                cell({
                    id: "new-1",
                    value: '<p class="indesign-paragraph"><span class="idml-segment">Note</span></p>',
                    paragraphOrder: 1,
                }),
                cell({ id: "new-2", value: "<p><span>Untranslated</span></p>", paragraphOrder: 5 }),
            ];
            const newCodex = [
                cell({ id: "new-1", value: "" }),
                cell({ id: "new-2", value: "" }),
            ];

            const { cells, report } = migrateBiblicaNotebook({
                notebookName: "JOB-SNG",
                oldSourceCells: oldSource,
                oldCodexCells: oldCodex,
                newSourceCells: newSource,
                newCodexCells: newCodex,
                options: {
                    author: "migration",
                    applySourceStructure: true,
                    timestamp: MIGRATION_TIMESTAMP,
                },
            });

            assert.strictEqual(report.notebookName, "JOB-SNG");
            assert.strictEqual(report.oldTranslatedCells, 2);
            assert.strictEqual(report.newContentCells, 2);
            assert.strictEqual(report.translationsMigrated, 1);
            assert.strictEqual(report.matchedByParagraphIdentity, 1);
            assert.strictEqual(report.matchedBySourceText, 0);
            assert.strictEqual(report.newCellsWithoutTranslation, 1);
            assert.deepStrictEqual(report.unmatchedByParagraphStyle, [
                { appliedParagraphStyle: "ParagraphStyle/head%3acl", count: 1 },
            ]);
            assert.strictEqual(report.structureResolved, 1);
            assert.strictEqual(cells[1].value, "");
        });
    });
});
