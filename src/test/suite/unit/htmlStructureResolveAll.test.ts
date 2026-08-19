import * as assert from "assert";
import type { CustomNotebookCellData } from "../../../../types";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import {
    applyResolvedContent,
    collectMismatchedCells,
} from "../../../projectManager/utils/htmlStructureResolveAll";

const cell = (
    id: string,
    value: string,
    type: CodexCellTypes = CodexCellTypes.TEXT
): CustomNotebookCellData =>
    ({
        kind: 2,
        value,
        languageId: "html",
        metadata: {
            id,
            type,
            edits: [],
        },
    }) as CustomNotebookCellData;

suite("htmlStructureResolveAll", () => {
    suite("collectMismatchedCells", () => {
        test("returns only translated cells whose tags differ from the source", () => {
            const source = [
                cell("a", "<p>Hello</p>"),
                cell("b", "<p>World</p>"),
                cell("c", "Milestone", CodexCellTypes.MILESTONE),
                cell("d", "<p>Empty source wait</p>"),
            ];
            const target = [
                cell("a", "<p>Hola</p>"),
                cell("b", "Mundo"),
                cell("c", "Marco", CodexCellTypes.MILESTONE),
                cell("d", ""),
            ];

            const mismatches = collectMismatchedCells(source, target);
            assert.deepStrictEqual(
                mismatches.map((item) => item.cellId),
                ["b"]
            );
            assert.strictEqual(mismatches[0].cellIndex, 1);
        });
    });

    suite("applyResolvedContent", () => {
        test("writes the resolved HTML and records an LLM-generation edit", () => {
            const target = cell("b", "Mundo");
            applyResolvedContent(target, "<p>Mundo</p>", "tester", 1_700_000_000_000);

            assert.strictEqual(target.value, "<p>Mundo</p>");
            const lastEdit = target.metadata.edits[target.metadata.edits.length - 1];
            assert.strictEqual(lastEdit.type, EditType.LLM_GENERATION);
            assert.strictEqual(lastEdit.author, "tester");
            assert.strictEqual(lastEdit.value, "<p>Mundo</p>");
        });

        test("carries the previous validation onto the structure-only edit", () => {
            const target = cell("b", "Mundo");
            target.metadata.edits = [
                {
                    editMap: ["value"],
                    value: "Mundo",
                    timestamp: 1,
                    type: EditType.USER_EDIT,
                    author: "cleiton",
                    validatedBy: [
                        {
                            username: "cleiton",
                            creationTimestamp: 1,
                            updatedTimestamp: 1,
                            isDeleted: false,
                        },
                    ],
                },
            ];

            applyResolvedContent(target, "<p>Mundo</p>", "tester", 2);
            const lastEdit = target.metadata.edits[target.metadata.edits.length - 1];
            assert.strictEqual(lastEdit.validatedBy?.[0].username, "cleiton");
        });
    });
});
