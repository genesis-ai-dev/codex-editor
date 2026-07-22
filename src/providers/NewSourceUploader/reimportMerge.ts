/**
 * Re-import merge logic ("update existing import").
 *
 * When a user imports a document whose original file is already in the
 * project, we can rebuild the existing source/codex pair from the fresh parse
 * (fixing importer bugs, picking up document changes) while carrying over the
 * translation work.
 *
 * SYNC SAFETY: projects sync via a CRDT-style merge (`resolveCodexCustomMerge`)
 * that unions cells by id and resolves each field from the most recent entry
 * in the cell's edit history. A plain file rewrite would not survive that:
 * hard-deleted cells get re-inserted from the remote copy, and value/data
 * changes without edit entries get reverted to the remote's newest edit.
 * Therefore every change this merge makes is expressed as a CRDT operation:
 *
 * - Old cells with no counterpart in the new parse are never removed; they
 *   are soft-deleted (`data.deleted = true` plus a `dataDeleted` edit), the
 *   same tombstone mechanism the editor's delete-cell action uses.
 * - Matched cells keep their OLD cell id (so translations, edit history,
 *   comments, and audio stay attached), keep their old edit history, and any
 *   changed value or `data` field gets a timestamped MIGRATION edit appended
 *   so the change wins the sync merge on every machine.
 * - New cells with no old counterpart start with an empty target.
 * - Milestone cells are matched by chapter number so their ids are stable
 *   across the re-import too.
 *
 * This module is pure (no vscode imports) so the merge is unit-testable.
 */

import { CodexCellTypes, EditType } from "../../../types/enums";
import { EditMapUtils } from "../../utils/editMapUtils";
import { extractPlainTextFromHtml } from "../../../sharedUtils/htmlStructureUtils";

export interface ReimportEdit {
    editMap: readonly string[];
    value: unknown;
    timestamp: number;
    type: EditType;
    author?: string;
    validatedBy?: unknown[];
}

export interface ReimportCell {
    kind?: number;
    value: string;
    languageId?: string;
    metadata?: {
        id?: string;
        type?: string;
        edits?: ReimportEdit[];
        data?: Record<string, unknown>;
        parentId?: string;
        [key: string]: unknown;
    };
}

export interface ReimportNotebook {
    cells: ReimportCell[];
    metadata?: Record<string, unknown>;
}

export interface ReimportMergeStats {
    /** TEXT cells in the new parse. */
    totalNewCells: number;
    /** New cells that matched an old cell (old id preserved). */
    matchedCells: number;
    /** Matched cells whose old target had translated content. */
    translationsCarried: number;
    /** Old TEXT cells with no counterpart in the new parse (soft-deleted). */
    droppedOldCells: number;
    /** Soft-deleted old cells that had translated content (hidden work). */
    droppedTranslations: number;
}

export interface ReimportMergeResult {
    mergedSource: ReimportNotebook;
    mergedCodex: ReimportNotebook;
    stats: ReimportMergeStats;
}

/** Target-cell metadata that must survive a re-import (keyed to the cell id). */
const PRESERVED_TARGET_METADATA_KEYS = [
    "edits",
    "attachments",
    "selectedAudioId",
    "selectionTimestamp",
    "cellLabel",
    "isLocked",
] as const;

/** Notebook metadata that identifies the existing pair and must not change. */
const PRESERVED_NOTEBOOK_METADATA_KEYS = [
    "id",
    "fileDisplayName",
    "sourceFsPath",
    "codexFsPath",
    "navigation",
    "sourceCreatedAt",
    "corpusMarker",
    "textDirection",
    "videoUrl",
    "lineNumbersEnabled",
    "lineNumbersEnabledSource",
] as const;

const normalizeText = (html: string | undefined): string =>
    extractPlainTextFromHtml(html ?? "");

const isTextCell = (cell: ReimportCell): boolean =>
    (cell.metadata?.type ?? CodexCellTypes.TEXT) === CodexCellTypes.TEXT;

const isTombstoned = (cell: ReimportCell): boolean =>
    cell.metadata?.data?.deleted === true;

/**
 * Chapter key for milestone cells: the last number in the label, matching the
 * content-alignment rule in the sync resolver (`resolveCodexCustomMerge`).
 */
const milestoneChapterKey = (cell: ReimportCell): string | null => {
    const label = (cell.value || "").trim();
    if (!label) return null;
    const chapterMatch = label.match(/(\d+)(?!.*\d)/);
    return chapterMatch ? chapterMatch[1] : label;
};

interface OldCellEntry {
    order: number;
    sourceCell: ReimportCell;
    targetCell: ReimportCell | undefined;
    consumed: boolean;
}

const hasTranslation = (entry: OldCellEntry): boolean =>
    Boolean(entry.targetCell?.value && entry.targetCell.value.trim() !== "");

const mergeNotebookMetadata = (
    existing: Record<string, unknown> | undefined,
    incoming: Record<string, unknown> | undefined,
): Record<string, unknown> => {
    const merged: Record<string, unknown> = { ...(existing ?? {}), ...(incoming ?? {}) };
    for (const key of PRESERVED_NOTEBOOK_METADATA_KEYS) {
        if (existing && existing[key] !== undefined) {
            merged[key] = existing[key];
        }
    }
    return merged;
};

const REIMPORT_AUTHOR = "system";

const makeEdit = (
    editMap: readonly string[],
    value: unknown,
    timestamp: number,
): ReimportEdit => ({
    editMap,
    value,
    timestamp,
    type: EditType.MIGRATION,
    author: REIMPORT_AUTHOR,
    validatedBy: [],
});

const ensureEdits = (cell: ReimportCell): ReimportEdit[] => {
    const metadata = (cell.metadata ??= {});
    return (metadata.edits ??= []);
};

/**
 * Append MIGRATION edits describing every difference between the cell's old
 * `data` fields and its new ones, so the changes (e.g. corrected
 * `paragraphIndex`) propagate through the sync merge instead of being
 * reverted to the remote's newest edit.
 */
const appendDataFieldEdits = (
    cell: ReimportCell,
    oldData: Record<string, unknown> | undefined,
    timestamp: number,
): void => {
    const newData = cell.metadata?.data ?? {};
    const edits = ensureEdits(cell);
    for (const [field, value] of Object.entries(newData)) {
        if (value === undefined) continue;
        if (JSON.stringify(oldData?.[field]) === JSON.stringify(value)) continue;
        edits.push(makeEdit(EditMapUtils.metadataNested("data", field), value, timestamp));
    }
};

/** Append a value edit when the cell's value differs from its previous value. */
const appendValueEditIfChanged = (
    cell: ReimportCell,
    previousValue: string | undefined,
    timestamp: number,
): void => {
    if (cell.value === previousValue) return;
    ensureEdits(cell).push(makeEdit(EditMapUtils.value(), cell.value, timestamp));
};

/**
 * Soft-delete a cell: set the tombstone flag and record it as an edit (the
 * same mechanism as the editor's delete-cell action), so the deletion wins
 * the sync merge instead of the cell being resurrected from a remote copy.
 */
const tombstoneCell = (cell: ReimportCell, timestamp: number): ReimportCell => {
    if (isTombstoned(cell)) return cell;
    const metadata = (cell.metadata ??= {});
    const data = (metadata.data ??= {});
    data.deleted = true;
    ensureEdits(cell).push(makeEdit(EditMapUtils.dataDeleted(), true, timestamp));
    return cell;
};

/**
 * Merge a freshly parsed notebook pair into an existing pair.
 *
 * Matching is two-pass:
 * 1. Exact match on normalized source text. When several old cells share the
 *    same text (e.g. duplicated import artifacts), the one carrying a
 *    translation wins, so no work is lost to a duplicate.
 * 2. Containment: an unmatched new cell absorbs unmatched old cells whose
 *    text it fully contains, in document order (covers re-segmentation where
 *    several old paragraphs merged into one new cell). Their translations are
 *    concatenated; the first absorbed cell donates its id.
 */
export const mergeReimportedNotebookPair = (
    existingSource: ReimportNotebook,
    existingCodex: ReimportNotebook,
    newSource: ReimportNotebook,
    newCodex: ReimportNotebook,
): ReimportMergeResult => {
    const now = Date.now();

    const oldTargetById = new Map<string, ReimportCell>();
    for (const cell of existingCodex.cells ?? []) {
        const id = cell.metadata?.id;
        if (typeof id === "string") {
            oldTargetById.set(id, cell);
        }
    }

    // Index old source TEXT cells by normalized text (document order
    // preserved). Cells that are already tombstoned are passed through
    // untouched rather than matched.
    const oldEntries: OldCellEntry[] = [];
    const oldByText = new Map<string, OldCellEntry[]>();
    const oldMilestonesByChapter = new Map<string, OldCellEntry[]>();
    const oldPassthrough: OldCellEntry[] = [];
    (existingSource.cells ?? []).forEach((cell, order) => {
        const id = cell.metadata?.id;
        if (typeof id !== "string") return;
        const entry: OldCellEntry = {
            order,
            sourceCell: cell,
            targetCell: oldTargetById.get(id),
            consumed: false,
        };
        if (isTombstoned(cell)) {
            oldPassthrough.push(entry);
            return;
        }
        if (cell.metadata?.type === CodexCellTypes.MILESTONE) {
            const key = milestoneChapterKey(cell);
            if (key) {
                const list = oldMilestonesByChapter.get(key);
                if (list) {
                    list.push(entry);
                } else {
                    oldMilestonesByChapter.set(key, [entry]);
                }
            } else {
                oldPassthrough.push(entry);
            }
            return;
        }
        const text = normalizeText(cell.value);
        if (!isTextCell(cell) || !text) {
            // Unmatched cell shapes (empty text, unexpected types) are kept
            // as-is rather than removed — a removed cell would just be
            // re-inserted by the sync merge from a remote copy.
            oldPassthrough.push(entry);
            return;
        }
        oldEntries.push(entry);
        const list = oldByText.get(text);
        if (list) {
            list.push(entry);
        } else {
            oldByText.set(text, [entry]);
        }
    });

    const newCodexById = new Map<string, ReimportCell>();
    for (const cell of newCodex.cells ?? []) {
        const id = cell.metadata?.id;
        if (typeof id === "string") {
            newCodexById.set(id, cell);
        }
    }

    const stats: ReimportMergeStats = {
        totalNewCells: 0,
        matchedCells: 0,
        translationsCarried: 0,
        droppedOldCells: 0,
        droppedTranslations: 0,
    };

    type PendingCell = {
        sourceCell: ReimportCell;
        codexCell: ReimportCell;
        normalizedText: string;
        isText: boolean;
    };

    const pending: PendingCell[] = (newSource.cells ?? []).map((sourceCell) => {
        const newId = sourceCell.metadata?.id;
        const codexCell: ReimportCell =
            (typeof newId === "string" ? newCodexById.get(newId) : undefined) ?? {
                // 2 = vscode.NotebookCellKind.Code, the kind used for all cells
                kind: sourceCell.kind ?? 2,
                value: "",
                languageId: sourceCell.languageId ?? "html",
                metadata: { ...(sourceCell.metadata ?? {}), edits: [] },
            };
        const isText = isTextCell(sourceCell) && sourceCell.metadata?.type !== CodexCellTypes.MILESTONE;
        if (isText) stats.totalNewCells++;
        return { sourceCell, codexCell, normalizedText: normalizeText(sourceCell.value), isText };
    });

    const adoptOldCell = (cell: PendingCell, entry: OldCellEntry, carriedValue: string) => {
        entry.consumed = true;
        const oldId = entry.sourceCell.metadata!.id as string;
        const oldSourceMetadata = entry.sourceCell.metadata as Record<string, unknown>;

        // Source side: keep the old id and edit history; record the new value
        // and data changes as MIGRATION edits so they survive the sync merge.
        cell.sourceCell.metadata = {
            ...(cell.sourceCell.metadata ?? {}),
            id: oldId,
            edits: [...(entry.sourceCell.metadata?.edits ?? [])],
        };
        appendValueEditIfChanged(cell.sourceCell, entry.sourceCell.value, now);
        appendDataFieldEdits(
            cell.sourceCell,
            oldSourceMetadata.data as Record<string, unknown> | undefined,
            now,
        );

        // Target side: keep everything keyed to the id (edits, attachments,
        // labels) and carry the translation over.
        const preserved: Record<string, unknown> = {};
        const oldTargetMetadata = entry.targetCell?.metadata as
            | Record<string, unknown>
            | undefined;
        if (oldTargetMetadata) {
            for (const key of PRESERVED_TARGET_METADATA_KEYS) {
                if (oldTargetMetadata[key] !== undefined) {
                    preserved[key] = oldTargetMetadata[key];
                }
            }
        }
        // Own copy of the history: edits appended below must not mutate the
        // old cell's array.
        preserved.edits = [...((preserved.edits as ReimportEdit[] | undefined) ?? [])];
        cell.codexCell.metadata = {
            ...(cell.codexCell.metadata ?? {}),
            ...preserved,
            id: oldId,
            type: cell.codexCell.metadata?.type ?? CodexCellTypes.TEXT,
        };
        cell.codexCell.value = carriedValue;
        appendValueEditIfChanged(cell.codexCell, entry.targetCell?.value, now);
        appendDataFieldEdits(
            cell.codexCell,
            oldTargetMetadata?.data as Record<string, unknown> | undefined,
            now,
        );

        stats.matchedCells++;
        if (carriedValue.trim() !== "") {
            stats.translationsCarried++;
        }
    };

    // Milestones: match by chapter number so ids stay stable across re-import.
    for (const cell of pending) {
        if (cell.sourceCell.metadata?.type !== CodexCellTypes.MILESTONE) continue;
        const key = milestoneChapterKey(cell.sourceCell);
        if (!key) continue;
        const candidates = (oldMilestonesByChapter.get(key) ?? []).filter(
            (entry) => !entry.consumed,
        );
        if (candidates.length === 0) continue;
        const entry = candidates[0];
        entry.consumed = true;
        const oldId = entry.sourceCell.metadata!.id as string;
        // Keep the old value (e.g. "<docName> 1" vs the importer's bare "1")
        // so no value edit is needed; only the id and history carry over.
        cell.sourceCell.metadata = {
            ...(cell.sourceCell.metadata ?? {}),
            id: oldId,
            edits: [...(entry.sourceCell.metadata?.edits ?? [])],
        };
        cell.sourceCell.value = entry.sourceCell.value;
        if (entry.targetCell) {
            cell.codexCell.metadata = {
                ...(cell.codexCell.metadata ?? {}),
                id: oldId,
                edits: [...(entry.targetCell.metadata?.edits ?? [])],
            };
            cell.codexCell.value = entry.targetCell.value;
        } else {
            cell.codexCell.metadata = { ...(cell.codexCell.metadata ?? {}), id: oldId };
        }
    }

    // Pass 1: exact text match.
    const unmatched: PendingCell[] = [];
    for (const cell of pending) {
        if (!cell.isText || !cell.normalizedText) continue;
        const candidates = (oldByText.get(cell.normalizedText) ?? []).filter(
            (entry) => !entry.consumed,
        );
        if (candidates.length === 0) {
            unmatched.push(cell);
            continue;
        }
        // Prefer the duplicate that carries a translation.
        const chosen = candidates.find(hasTranslation) ?? candidates[0];
        adoptOldCell(cell, chosen, chosen.targetCell?.value ?? "");
    }

    // Pass 2: containment (old cells whose text the new cell fully contains).
    // Very short fragments are excluded so boilerplate snippets don't attach
    // their translation to an unrelated cell.
    const MIN_CONTAINMENT_LENGTH = 10;
    for (const cell of unmatched) {
        const contained = oldEntries.filter((entry) => {
            if (entry.consumed) return false;
            const oldText = normalizeText(entry.sourceCell.value);
            return oldText.length >= MIN_CONTAINMENT_LENGTH && cell.normalizedText.includes(oldText);
        });
        if (contained.length === 0) continue;
        contained.sort((a, b) => a.order - b.order);

        const carried = contained
            .map((entry) => entry.targetCell?.value?.trim() ?? "")
            .filter((value) => value !== "")
            .join(" ");
        adoptOldCell(cell, contained[0], carried);
        // The remaining absorbed cells are retired below as tombstones (their
        // translation, if any, was concatenated into the adopting cell).
        for (const entry of contained.slice(1)) {
            entry.consumed = true;
            stats.droppedOldCells++;
        }
    }

    // Old cells with no counterpart are SOFT-deleted, never removed: the sync
    // merge unions cells by id, so a hard-deleted cell would simply be
    // re-inserted from any remote copy of the old file. Absorbed containment
    // cells (consumed but not id-donors) are retired the same way.
    const retiredEntries: OldCellEntry[] = [];
    const donorIds = new Set(
        pending
            .map((cell) => cell.sourceCell.metadata?.id)
            .filter((id): id is string => typeof id === "string"),
    );
    const retireEntry = (entry: OldCellEntry) => {
        retiredEntries.push(entry);
        tombstoneCell(entry.sourceCell, now);
        if (entry.targetCell) {
            tombstoneCell(entry.targetCell, now);
        }
    };
    for (const entry of oldEntries) {
        const id = entry.sourceCell.metadata?.id;
        if (typeof id === "string" && donorIds.has(id)) continue;
        if (!entry.consumed) {
            stats.droppedOldCells++;
            if (hasTranslation(entry)) {
                stats.droppedTranslations++;
            }
        }
        retireEntry(entry);
    }
    // Unmatched old milestones are retired the same way.
    for (const entries of oldMilestonesByChapter.values()) {
        for (const entry of entries) {
            if (!entry.consumed) {
                retireEntry(entry);
            }
        }
    }

    const mergedSourceCells = pending.map((cell) => cell.sourceCell);
    const mergedCodexCells: ReimportCell[] = [];
    const mergedIds = new Set(donorIds);

    // Re-insert user-created paratext cells after their surviving parents;
    // paratext cells whose parent was retired are tombstoned alongside it.
    const paratextByParent = new Map<string, ReimportCell[]>();
    const orphanedParatext: ReimportCell[] = [];
    for (const cell of existingCodex.cells ?? []) {
        if (cell.metadata?.type !== CodexCellTypes.PARATEXT) continue;
        const parentId = cell.metadata?.parentId;
        if (typeof parentId === "string" && mergedIds.has(parentId)) {
            const list = paratextByParent.get(parentId);
            if (list) {
                list.push(cell);
            } else {
                paratextByParent.set(parentId, [cell]);
            }
        } else {
            orphanedParatext.push(tombstoneCell(cell, now));
        }
    }

    for (const cell of pending) {
        mergedCodexCells.push(cell.codexCell);
        const id = cell.codexCell.metadata?.id;
        if (typeof id === "string") {
            const children = paratextByParent.get(id);
            if (children) {
                mergedCodexCells.push(...children);
            }
        }
    }

    // Append tombstoned/passthrough cells at the end (hidden from display but
    // present for the sync merge).
    for (const entry of [...oldPassthrough, ...retiredEntries]) {
        mergedSourceCells.push(entry.sourceCell);
        if (entry.targetCell) {
            mergedCodexCells.push(entry.targetCell);
        }
    }
    mergedCodexCells.push(...orphanedParatext);

    return {
        mergedSource: {
            cells: mergedSourceCells,
            metadata: mergeNotebookMetadata(existingSource.metadata, newSource.metadata),
        },
        mergedCodex: {
            cells: mergedCodexCells,
            metadata: mergeNotebookMetadata(existingCodex.metadata, newCodex.metadata),
        },
        stats,
    };
};
