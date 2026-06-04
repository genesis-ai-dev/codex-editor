import * as vscode from "vscode";
import { CodexContentSerializer } from "../serializer";
import { mergeDuplicateCellsUsingResolverLogic } from "../projectManager/utils/merge/resolvers";
import { EditMapUtils } from "../utils/editMapUtils";
import { EditType } from "../../types/enums";
import { getAuthApi } from "../extension";
import type { CustomNotebookCellData } from "../../types";
import type { EditHistory, ValidationEntry } from "../../types/index.d";
import type { MigrationMatchResult } from "./types";

const cloneCell = (cell: CustomNotebookCellData): CustomNotebookCellData => {
    return JSON.parse(JSON.stringify(cell)) as CustomNotebookCellData;
};

const getCellId = (cell: CustomNotebookCellData): string | null => {
    const cellId = cell.metadata?.id;
    return typeof cellId === "string" && cellId.trim() ? cellId.trim() : null;
};

const addMigrationEdit = (
    cell: CustomNotebookCellData,
    timestamp: number,
    author: string
): void => {
    if (!cell.metadata) {
        cell.metadata = { id: (cell as any).id, type: (cell as any).type, edits: [] };
    }
    if (!cell.metadata.edits) {
        cell.metadata.edits = [];
    }
    cell.metadata.edits.push({
        editMap: EditMapUtils.value(),
        value: cell.value,
        timestamp,
        type: EditType.MIGRATION,
        author,
    });
};

const getLatestValueEditTimestamp = (cell: CustomNotebookCellData): number | null => {
    const edits = cell.metadata?.edits ?? [];
    const valueEdits = edits.filter((edit) => EditMapUtils.isValue(edit.editMap));
    if (valueEdits.length === 0) {
        return null;
    }
    const latest = valueEdits.reduce((max, edit) => Math.max(max, edit.timestamp), 0);
    return Number.isFinite(latest) ? latest : null;
};

const ensureValueEditForMerge = (
    cell: CustomNotebookCellData,
    author: string
): void => {
    const latestValueTimestamp = getLatestValueEditTimestamp(cell);
    if (latestValueTimestamp !== null) {
        return;
    }
    addMigrationEdit(cell, 0, author);
};

const isObjectValidationEntry = (entry: any): entry is ValidationEntry =>
    !!entry && typeof entry === "object" && typeof entry.username === "string";

/**
 * Returns the cell's current ("live") value edit — the last value edit in array
 * order. This mirrors exactly how the SQLite indexer + editor UI decide which
 * edit's `validatedBy` represents the cell's text-validation status
 * (`extractMetadataFields` in sqliteIndex.ts reads `valueEdits[valueEdits.length - 1]`).
 */
const getLastValueEdit = (cell: CustomNotebookCellData): EditHistory | null => {
    const edits = cell.metadata?.edits ?? [];
    const valueEdits = edits.filter((edit) => edit.editMap && EditMapUtils.isValue(edit.editMap));
    return valueEdits.length > 0 ? valueEdits[valueEdits.length - 1] : null;
};

/**
 * Snapshot of the validations that currently apply to a cell's live text, plus the
 * exact value string they were attached to. Captured BEFORE the cell copy is mutated
 * so the validations can later be re-attached only to identical surviving content.
 */
const collectCurrentTextValidations = (
    cell: CustomNotebookCellData
): { validations: ValidationEntry[]; value: string | undefined } => {
    const lastValueEdit = getLastValueEdit(cell);
    const validatedBy = lastValueEdit?.validatedBy;
    return {
        validations: Array.isArray(validatedBy)
            ? validatedBy.filter(isObjectValidationEntry)
            : [],
        value: typeof lastValueEdit?.value === "string" ? lastValueEdit.value : undefined,
    };
};

/**
 * Union `incoming` validation entries into `existing`, deduped by username. Mirrors
 * the semantics of `mergeValidatedByArrays` in the shared resolver: the original
 * `creationTimestamp` is kept, and a newer `updatedTimestamp` wins. Returns a new array.
 */
const unionValidationEntries = (
    existing: ValidationEntry[],
    incoming: ValidationEntry[]
): ValidationEntry[] => {
    const result = existing.map((entry) => ({ ...entry }));
    for (const entry of incoming) {
        const index = result.findIndex((e) => e.username === entry.username);
        if (index === -1) {
            result.push({ ...entry });
        } else if (entry.updatedTimestamp > result[index].updatedTimestamp) {
            result[index] = { ...entry, creationTimestamp: result[index].creationTimestamp };
        }
    }
    return result;
};

/**
 * Remove all validation status from a cell copy: clears `validatedBy` from every edit
 * and from every attachment. Used on the SOURCE copy when "Keep validation status" is
 * OFF so the merge cannot carry any source validations into the target.
 */
const stripValidations = (cell: CustomNotebookCellData): void => {
    for (const edit of cell.metadata?.edits ?? []) {
        if (edit.validatedBy) {
            delete edit.validatedBy;
        }
    }
    const attachments = cell.metadata?.attachments;
    if (attachments) {
        for (const id of Object.keys(attachments)) {
            const attachment = attachments[id] as { validatedBy?: ValidationEntry[]; };
            if (attachment?.validatedBy) {
                delete attachment.validatedBy;
            }
        }
    }
};

export async function applyMigrationToTargetFile(params: {
    fromFileUri: vscode.Uri;
    toFileUri: vscode.Uri;
    matches: MigrationMatchResult[];
    forceOverride: boolean;
    /**
     * When true, text + audio validations are carried over to migrated cells
     * (preserving the original validator identity/timestamps); when false, no
     * validation status is transferred from the source. Defaults to false so
     * programmatic callers keep the historical behavior; the UI handler always
     * passes an explicit value (defaulting ON).
     */
    keepValidations?: boolean;
}): Promise<{ updated: number; skipped: number; }> {
    const { fromFileUri, toFileUri, matches, forceOverride, keepValidations = false } = params;
    const serializer = new CodexContentSerializer();

    let currentUser = "anonymous";
    try {
        const authApi = getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        currentUser = userInfo?.username || "anonymous";
    } catch {
        // keep anonymous
    }

    const [fromBytes, toBytes] = await Promise.all([
        vscode.workspace.fs.readFile(fromFileUri),
        vscode.workspace.fs.readFile(toFileUri),
    ]);

    const [fromNotebook, toNotebook] = await Promise.all([
        serializer.deserializeNotebook(fromBytes, new vscode.CancellationTokenSource().token),
        serializer.deserializeNotebook(toBytes, new vscode.CancellationTokenSource().token),
    ]);

    const fromCellsById = new Map<string, CustomNotebookCellData>();
    fromNotebook.cells.forEach((cell: CustomNotebookCellData) => {
        const cellId = getCellId(cell);
        if (cellId) {
            fromCellsById.set(cellId, cell);
        }
    });

    const toCellsById = new Map<string, { index: number; cell: CustomNotebookCellData }>();
    toNotebook.cells.forEach((cell: CustomNotebookCellData, index: number) => {
        const cellId = getCellId(cell);
        if (cellId) {
            toCellsById.set(cellId, { index, cell });
        }
    });

    let updated = 0;
    let skipped = 0;
    const migrationTimestamp = Date.now();

    for (const match of matches) {
        const fromCell = fromCellsById.get(match.fromCellId);
        const toEntry = toCellsById.get(match.toCellId);
        if (!fromCell || !toEntry) {
            skipped += 1;
            continue;
        }

        const fromCellCopy = cloneCell(fromCell);
        const toCellCopy = cloneCell(toEntry.cell);

        // Capture the live text validations (and the exact value they apply to) from
        // both sides BEFORE mutating the copies, so we can re-attach them afterwards.
        const sourceValidationState = keepValidations
            ? collectCurrentTextValidations(fromCellCopy)
            : null;
        const targetValidationState = keepValidations
            ? collectCurrentTextValidations(toCellCopy)
            : null;

        if (!keepValidations) {
            // Discard: strip validations from the SOURCE copy only so the resolver
            // cannot carry them into the target. The target copy keeps its own.
            stripValidations(fromCellCopy);
        }

        if (forceOverride) {
            addMigrationEdit(fromCellCopy, migrationTimestamp, currentUser);
        } else {
            ensureValueEditForMerge(fromCellCopy, currentUser);
        }

        const mergedCell = mergeDuplicateCellsUsingResolverLogic([toCellCopy, fromCellCopy]);

        // Re-attach validations onto the merged cell's live text edit, but only those
        // whose original validated value is exactly the content that survived the merge.
        // This keeps a validation tied to the precise text it was applied to (we never
        // stamp "validated" onto text the validator never saw) and prevents the resolver's
        // same-value/different-timestamp edit handling from silently dropping a still-valid
        // validation when a newer edit displaces the one it lived on.
        if (keepValidations) {
            const mergedLastValueEdit = getLastValueEdit(mergedCell);
            if (mergedLastValueEdit && typeof mergedLastValueEdit.value === "string") {
                const finalValue = mergedLastValueEdit.value;
                const incoming: ValidationEntry[] = [];
                if (sourceValidationState && sourceValidationState.value === finalValue) {
                    incoming.push(...sourceValidationState.validations);
                }
                if (targetValidationState && targetValidationState.value === finalValue) {
                    incoming.push(...targetValidationState.validations);
                }
                if (incoming.length > 0) {
                    const existing = Array.isArray(mergedLastValueEdit.validatedBy)
                        ? mergedLastValueEdit.validatedBy.filter(isObjectValidationEntry)
                        : [];
                    mergedLastValueEdit.validatedBy = unionValidationEntries(existing, incoming);
                }
            }
        }

        toNotebook.cells[toEntry.index] = mergedCell;
        updated += 1;
    }

    if (updated > 0) {
        const content = await serializer.serializeNotebook(
            toNotebook,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(toFileUri, content);
    }

    return { updated, skipped };
}
