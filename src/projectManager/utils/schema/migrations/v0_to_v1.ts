import type { SchemaMigration } from "../index";

/**
 * v0 → v1: Lift the legacy edit shape into the modern editMap-based shape.
 *
 * Some old `.codex` files carry edits with a `cellValue` field and no `editMap`
 * (the pre-editMap design). This step rewrites them to the modern shape:
 *   `{ cellValue: X }`  →  `{ value: X, editMap: ["value"] }`.
 *
 * This is a pure data transform — no edit-id generation, no activeEditId logic,
 * and no INITIAL_IMPORT synthesis. Future schema bumps will append further steps
 * (e.g. v1 → v2) on top of this baseline.
 */
export const migrate_v0_to_v1: SchemaMigration = (notebook) => {
    for (const cell of notebook.cells ?? []) {
        const edits = cell.metadata?.edits;
        if (!Array.isArray(edits) || edits.length === 0) continue;

        for (const edit of edits) {
            if (edit.cellValue !== undefined && !edit.editMap) {
                edit.value = edit.cellValue;
                edit.editMap = ["value"];
                delete edit.cellValue;
            }
        }
    }
};
