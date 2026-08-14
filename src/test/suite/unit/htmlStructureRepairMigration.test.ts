import * as assert from "assert";
import { EditType } from "../../../../types/enums";
import { findRevertedTranslation } from "../../../projectManager/utils/htmlStructureRepairMigration";

const valueEdit = (value: string, type: EditType) => ({
    editMap: ["value"] as string[],
    value,
    timestamp: Date.now(),
    type,
});

suite("htmlStructureRepairMigration", () => {
    suite("findRevertedTranslation", () => {
        const sourceHtml = "<p>Hello world</p>";

        test("restores the prior translation when a resolve reverted to source text", () => {
            const edits = [
                valueEdit("<p><span>Hola mundo</span></p>", EditType.LLM_GENERATION),
                valueEdit("<p>Hello world</p>", EditType.LLM_GENERATION),
            ];
            const restored = findRevertedTranslation(sourceHtml, "<p>Hello world</p>", edits);
            assert.strictEqual(restored, "<p><span>Hola mundo</span></p>");
        });

        test("returns null when the current value differs from the source text", () => {
            const edits = [
                valueEdit("<p>Hola mundo</p>", EditType.LLM_GENERATION),
            ];
            const restored = findRevertedTranslation(sourceHtml, "<p>Hola mundo</p>", edits);
            assert.strictEqual(restored, null);
        });

        test("returns null when there is no earlier different translation", () => {
            const edits = [
                valueEdit("<p>Hello world</p>", EditType.LLM_GENERATION),
                valueEdit("<p>Hello world</p>", EditType.LLM_GENERATION),
            ];
            const restored = findRevertedTranslation(sourceHtml, "<p>Hello world</p>", edits);
            assert.strictEqual(restored, null);
        });

        test("returns null when the source-identical value came from a user edit", () => {
            const edits = [
                valueEdit("<p>Hola mundo</p>", EditType.LLM_GENERATION),
                valueEdit("<p>Hello world</p>", EditType.USER_EDIT),
            ];
            const restored = findRevertedTranslation(sourceHtml, "<p>Hello world</p>", edits);
            assert.strictEqual(restored, null);
        });

        test("returns null when there are no value edits", () => {
            const restored = findRevertedTranslation(sourceHtml, "<p>Hello world</p>", []);
            assert.strictEqual(restored, null);
        });

        test("skips over intermediate source-identical edits to find the translation", () => {
            const edits = [
                valueEdit("<p><span>Hola mundo</span></p>", EditType.LLM_GENERATION),
                valueEdit("<p>Hello world</p>", EditType.LLM_GENERATION),
                valueEdit("<p>Hello world</p>", EditType.LLM_GENERATION),
            ];
            const restored = findRevertedTranslation(sourceHtml, "<p>Hello world</p>", edits);
            assert.strictEqual(restored, "<p><span>Hola mundo</span></p>");
        });
    });
});
