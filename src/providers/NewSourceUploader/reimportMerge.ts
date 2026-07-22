/**
 * Re-import merge logic ("update existing import").
 *
 * When a user imports a document whose original file is already in the
 * project, we can rebuild the existing source/codex pair from the fresh parse
 * (fixing importer bugs, picking up document changes) while carrying over the
 * translation work:
 *
 * - New cells are matched to existing cells by their source text. Matched
 *   cells keep their OLD cell id, so translations, edit history, comments,
 *   and audio attachments (all keyed by cell id) stay attached.
 * - Old cells with no counterpart in the new parse (removed from the
 *   document, or import artifacts like duplicated text-box content) are
 *   dropped together with their targets.
 * - New cells with no old counterpart start with an empty target.
 *
 * This module is pure (no vscode imports) so the merge is unit-testable.
 */

import { CodexCellTypes } from "../../../types/enums";
import { extractPlainTextFromHtml } from "../../../sharedUtils/htmlStructureUtils";

export interface ReimportCell {
    kind?: number;
    value: string;
    languageId?: string;
    metadata?: {
        id?: string;
        type?: string;
        edits?: unknown[];
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
    /** Old TEXT cells with no counterpart in the new parse (removed). */
    droppedOldCells: number;
    /** Dropped old cells that had translated content (lost work). */
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
    const oldTargetById = new Map<string, ReimportCell>();
    for (const cell of existingCodex.cells ?? []) {
        const id = cell.metadata?.id;
        if (typeof id === "string") {
            oldTargetById.set(id, cell);
        }
    }

    // Index old source TEXT cells by normalized text (document order preserved).
    const oldEntries: OldCellEntry[] = [];
    const oldByText = new Map<string, OldCellEntry[]>();
    (existingSource.cells ?? []).forEach((cell, order) => {
        if (!isTextCell(cell)) return;
        const id = cell.metadata?.id;
        const text = normalizeText(cell.value);
        if (typeof id !== "string" || !text) return;
        const entry: OldCellEntry = {
            order,
            sourceCell: cell,
            targetCell: oldTargetById.get(id),
            consumed: false,
        };
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

    // Pass 1: exact text match.
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
        const isText = isTextCell(sourceCell);
        if (isText) stats.totalNewCells++;
        return { sourceCell, codexCell, normalizedText: normalizeText(sourceCell.value), isText };
    });

    const adoptOldCell = (cell: PendingCell, entry: OldCellEntry, carriedValue: string) => {
        entry.consumed = true;
        const oldId = entry.sourceCell.metadata!.id as string;
        cell.sourceCell.metadata = { ...(cell.sourceCell.metadata ?? {}), id: oldId };

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
        cell.codexCell.metadata = {
            ...(cell.codexCell.metadata ?? {}),
            ...preserved,
            id: oldId,
            type: cell.codexCell.metadata?.type ?? CodexCellTypes.TEXT,
        };
        cell.codexCell.value = carriedValue;

        stats.matchedCells++;
        if (carriedValue.trim() !== "") {
            stats.translationsCarried++;
        }
    };

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
        // Mark the remaining absorbed cells consumed (their translation, if
        // any, was concatenated into the adopting cell).
        for (const entry of contained.slice(1)) {
            entry.consumed = true;
        }
    }

    // Old cells never consumed are dropped (their targets die with them).
    for (const entry of oldEntries) {
        if (entry.consumed) continue;
        stats.droppedOldCells++;
        if (hasTranslation(entry)) {
            stats.droppedTranslations++;
        }
    }

    const mergedSourceCells = pending.map((cell) => cell.sourceCell);
    const mergedCodexCells: ReimportCell[] = [];
    const mergedIds = new Set(
        pending
            .map((cell) => cell.sourceCell.metadata?.id)
            .filter((id): id is string => typeof id === "string"),
    );

    // Re-insert user-created paratext cells after their surviving parents.
    const paratextByParent = new Map<string, ReimportCell[]>();
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
