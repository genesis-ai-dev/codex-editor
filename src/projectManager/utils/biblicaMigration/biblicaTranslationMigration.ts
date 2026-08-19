/**
 * Moves translations from an old Biblica notebook onto a freshly re-imported one
 * and re-dresses them with the source's IDML style markup.
 *
 * The re-imported codex cells are empty, so translations are transplanted rather
 * than merged: the old cell's value, full edit history (including validation
 * entries) and cell label are copied verbatim onto the matched new cell. Nothing
 * from the new cell's structural metadata (paragraph style, story/paragraph
 * relationships, IDML segment structure) is touched — that is precisely what the
 * re-import exists to refresh.
 *
 * Afterwards each migrated value is compared against its new source cell and, when
 * the structures differ, re-wrapped with the source's own tags via the same
 * deterministic resolver the editor's "Resolve" action uses. Validation status
 * follows the text onto the re-wrapped value, since only the markup changed.
 */

import type { CustomNotebookCellData, EditHistory, ValidationEntry } from "../../../../types";
import { EditType } from "../../../../types/enums";
import { EditMapUtils } from "../../../utils/editMapUtils";
import {
    compareHtmlStructure,
    tryDeterministicStructureFix,
} from "../../../../sharedUtils/htmlStructureUtils";
import type { BiblicaCellMatch } from "./biblicaCellMatching";

export interface BiblicaMigrationOptions {
    /** Author recorded on the migration edits. */
    author: string;
    /**
     * Re-wrap migrated translations with the source cell's tags. Off leaves the
     * translations exactly as they were, so the two steps can be run separately.
     */
    applySourceStructure: boolean;
    /** Timestamp for generated edits; injectable so results stay deterministic in tests. */
    timestamp?: number;
}

export interface BiblicaStructureOutcome {
    cellId: string;
    /** Normalized source text, for reporting which cell still needs attention. */
    sourceText: string;
    reason: "resolved" | "alreadyMatching" | "noDeterministicFix";
    /** Present when the resolver could not fix the cell. */
    mismatchDetails?: string[];
}

export interface BiblicaMigrationResult {
    /** The re-imported codex cells with translations applied (new array, inputs untouched). */
    cells: CustomNotebookCellData[];
    translationsMigrated: number;
    /** Matches whose old or new cell could not be found in the given notebooks. */
    matchesSkipped: number;
    structureOutcomes: BiblicaStructureOutcome[];
}

export interface BiblicaMigrationInput {
    oldCodexCells: CustomNotebookCellData[];
    newSourceCells: CustomNotebookCellData[];
    newCodexCells: CustomNotebookCellData[];
    matches: BiblicaCellMatch[];
    options: BiblicaMigrationOptions;
}

const getCellId = (cell: CustomNotebookCellData): string | null => {
    const id = cell.metadata?.id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
};

const cloneCell = (cell: CustomNotebookCellData): CustomNotebookCellData =>
    JSON.parse(JSON.stringify(cell)) as CustomNotebookCellData;

const getValueEdits = (cell: CustomNotebookCellData): EditHistory[] =>
    (cell.metadata?.edits ?? []).filter((edit) => edit.editMap && EditMapUtils.isValue(edit.editMap));

/**
 * The edit whose `validatedBy` represents the cell's live text validation. The
 * indexer and editor both read the *last* value edit, so this must match.
 */
const getLastValueEdit = (cell: CustomNotebookCellData): EditHistory | null => {
    const valueEdits = getValueEdits(cell);
    return valueEdits.length > 0 ? valueEdits[valueEdits.length - 1] : null;
};

const cloneValidations = (edit: EditHistory | null): ValidationEntry[] | undefined => {
    const validatedBy = edit?.validatedBy;
    if (!Array.isArray(validatedBy) || validatedBy.length === 0) return undefined;
    return validatedBy.map((entry) => ({ ...entry }));
};

const plainText = (html: string | undefined): string =>
    (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Copy a translation onto a freshly imported (empty) cell. Mutates `newCell`,
 * which the caller has already cloned.
 */
const transplantTranslation = (
    newCell: CustomNotebookCellData,
    oldCell: CustomNotebookCellData
): void => {
    newCell.value = oldCell.value;

    if (!newCell.metadata) return;
    const oldEdits = oldCell.metadata?.edits ?? [];
    newCell.metadata.edits = JSON.parse(JSON.stringify(oldEdits)) as EditHistory[];

    const oldLabel = (oldCell.metadata as { cellLabel?: string } | undefined)?.cellLabel;
    if (typeof oldLabel === "string" && oldLabel.trim()) {
        (newCell.metadata as { cellLabel?: string }).cellLabel = oldLabel;
    }
};

/**
 * Re-wrap a migrated translation with its source cell's tags. Mutates `cell`.
 * Returns what happened so callers can report cells the resolver could not fix.
 */
const applySourceStructure = (
    cell: CustomNotebookCellData,
    sourceHtml: string,
    options: BiblicaMigrationOptions,
    timestamp: number
): BiblicaStructureOutcome => {
    const cellId = getCellId(cell) ?? "";
    const sourceText = plainText(sourceHtml);

    const diff = compareHtmlStructure(sourceHtml, cell.value);
    if (diff.isMatch) {
        return { cellId, sourceText, reason: "alreadyMatching" };
    }

    const fixed = tryDeterministicStructureFix(sourceHtml, cell.value);
    if (fixed === null) {
        return {
            cellId,
            sourceText,
            reason: "noDeterministicFix",
            mismatchDetails: diff.errors,
        };
    }

    // Only the markup changed, so the validation that applied to the live text
    // still applies; carry it onto the edit that now holds that text.
    const carriedValidations = cloneValidations(getLastValueEdit(cell));
    cell.value = fixed;
    if (cell.metadata) {
        cell.metadata.edits = [
            ...(cell.metadata.edits ?? []),
            {
                editMap: EditMapUtils.value(),
                value: fixed,
                timestamp,
                type: EditType.MIGRATION,
                author: options.author,
                ...(carriedValidations ? { validatedBy: carriedValidations } : {}),
            } as EditHistory,
        ];
    }

    return { cellId, sourceText, reason: "resolved" };
};

export function migrateBiblicaTranslations(
    input: BiblicaMigrationInput
): BiblicaMigrationResult {
    const { oldCodexCells, newSourceCells, newCodexCells, matches, options } = input;
    const timestamp = options.timestamp ?? Date.now();

    const oldCodexById = new Map<string, CustomNotebookCellData>();
    for (const cell of oldCodexCells) {
        const id = getCellId(cell);
        if (id) oldCodexById.set(id, cell);
    }

    const newSourceById = new Map<string, CustomNotebookCellData>();
    for (const cell of newSourceCells) {
        const id = getCellId(cell);
        if (id) newSourceById.set(id, cell);
    }

    const cells = newCodexCells.map(cloneCell);
    const newCodexIndexById = new Map<string, number>();
    cells.forEach((cell, index) => {
        const id = getCellId(cell);
        if (id) newCodexIndexById.set(id, index);
    });

    let translationsMigrated = 0;
    let matchesSkipped = 0;
    const structureOutcomes: BiblicaStructureOutcome[] = [];

    for (const match of matches) {
        const oldCell = oldCodexById.get(match.oldCellId);
        const newIndex = newCodexIndexById.get(match.newCellId);
        if (!oldCell || newIndex === undefined) {
            matchesSkipped += 1;
            continue;
        }

        const newCell = cells[newIndex];
        transplantTranslation(newCell, oldCell);
        translationsMigrated += 1;

        if (!options.applySourceStructure) continue;
        const sourceHtml = newSourceById.get(match.newCellId)?.value;
        if (typeof sourceHtml !== "string" || !sourceHtml) continue;
        structureOutcomes.push(applySourceStructure(newCell, sourceHtml, options, timestamp));
    }

    return { cells, translationsMigrated, matchesSkipped, structureOutcomes };
}
