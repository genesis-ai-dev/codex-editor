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
 *   changed value or importer metadata field gets a timestamped MIGRATION
 *   edit appended so the change wins the sync merge on every machine.
 * - New cells with no old counterpart start with an empty target.
 * - Milestone cells are matched by chapter number so their ids are stable
 *   across the re-import too.
 *
 * This module is pure (no vscode imports) so the merge is unit-testable.
 */

import type { ReimportCellChange, ReimportMergeStats, ValidationEntry } from "../../../types";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { EditMapUtils } from "../../utils/editMapUtils";
import { isDocxFormattingContext } from "../../../sharedUtils/docxHtmlFormatting";
import { getReimportSourceText } from "./reimportSourceText";
import {
    appendImporterMetadataEdits,
    makeReimportEdit as makeEdit,
    mergeNotebookMetadata,
    remapNotebookMetadataCellIds,
} from "./reimportMetadata";
import {
    canStructurallyMatchBiblica,
    findMatchingParagraphGroup,
    indexByBiblicaParagraph,
    isBiblicaImportContext,
} from "./biblicaStructuralMatch";
import { describeReimportCell } from "./reimportChangeReport";

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

// Shared with the NewSourceUploader webview, which renders the change report
// before the user commits to an update.
export type { ReimportCellChange, ReimportMergeStats } from "../../../types";

export interface ReimportMergeResult {
    mergedSource: ReimportNotebook;
    mergedCodex: ReimportNotebook;
    stats: ReimportMergeStats;
    /** Per-cell change rows for the import review UI. */
    changes: ReimportCellChange[];
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

/** Cells that hold translatable content, in document order. */
const translatableCells = (notebook: ReimportNotebook): ReimportCell[] =>
    (notebook.cells ?? []).filter(
        (cell) =>
            isTextCell(cell) &&
            !isTombstoned(cell) &&
            cell.metadata?.type !== CodexCellTypes.MILESTONE,
    );

/**
 * Pair each cell of the existing source with its existing translation.
 *
 * The two files of a pair normally share cell ids, but that is a convention
 * rather than an invariant: cell-id migrations run over `.source` and `.codex`
 * files independently, and target-only edits (child cells, paratext) add ids
 * one side never sees. Once the ids drift apart the id join finds nothing,
 * every translation looks absent, and an update writes an empty target —
 * silently, because a cell with no counterpart is not counted as a dropped
 * translation.
 *
 * So when the id join misses, fall back to matching by position, but only if
 * both sides still hold the same number of translatable cells. Equal counts
 * mean the two files still describe the same document and only the ids moved;
 * unequal counts could pair unrelated cells, which is worse than reporting the
 * translation as missing.
 */
const resolveExistingTargets = (
    existingSource: ReimportNotebook,
    existingCodex: ReimportNotebook,
): Map<ReimportCell, ReimportCell> => {
    const byId = new Map<string, ReimportCell>();
    for (const cell of existingCodex.cells ?? []) {
        const id = cell.metadata?.id;
        if (typeof id === "string") byId.set(id, cell);
    }

    const pairs = new Map<ReimportCell, ReimportCell>();
    let missed = 0;
    for (const cell of existingSource.cells ?? []) {
        const id = cell.metadata?.id;
        const target = typeof id === "string" ? byId.get(id) : undefined;
        if (target) {
            pairs.set(cell, target);
        } else {
            missed++;
        }
    }
    if (missed === 0) return pairs;

    const sourceCells = translatableCells(existingSource);
    const codexCells = translatableCells(existingCodex);
    // Zip by document order even when the counts differ: extra source cells
    // stay unpaired (become inserts), extra target cells stay unused. Guessing
    // nothing at all is what produced the blank target.
    const shared = Math.min(sourceCells.length, codexCells.length);
    for (let index = 0; index < shared; index++) {
        if (!pairs.has(sourceCells[index])) {
            pairs.set(sourceCells[index], codexCells[index]);
        }
    }
    return pairs;
};

const ensureEdits = (cell: ReimportCell): ReimportEdit[] => {
    const metadata = (cell.metadata ??= {});
    return (metadata.edits ??= []);
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
 * Mark a cell as needing re-resolution, recorded as an edit for the same
 * reason tombstones are: the flag has to win the sync merge on every machine
 * rather than be reverted from a remote copy that never saw the re-import.
 */
const flagNeedsResolution = (cell: ReimportCell, timestamp: number): ReimportCell => {
    const metadata = (cell.metadata ??= {});
    const data = (metadata.data ??= {});
    if (data.needsResolution === true) return cell;
    data.needsResolution = true;
    ensureEdits(cell).push(makeEdit(EditMapUtils.dataNeedsResolution(), true, timestamp));
    return cell;
};

/** Legacy histories store a validator as a bare username; the sync merge revives those as live. */
const isActiveValidation = (entry: unknown): boolean =>
    typeof entry === "string" ||
    (typeof entry === "object" && entry !== null && (entry as ValidationEntry).isDeleted !== true);

/**
 * Withdraw every live sign-off on a cell, returning whether there was one.
 *
 * Each entry is marked deleted under a fresh `updatedTimestamp`, the same shape the editor's
 * un-validate writes: the sync merge keeps whichever entry per user was updated last, so a
 * validation that is simply dropped would come back from any remote copy of the file. Edits are
 * copied rather than mutated because they are still shared with the existing notebook.
 */
const revokeValidations = (cell: ReimportCell, timestamp: number): boolean => {
    const cellEdits = cell.metadata?.edits;
    if (!cell.metadata || !cellEdits) return false;
    let revoked = false;
    cell.metadata.edits = cellEdits.map((edit) => {
        if (!edit.validatedBy?.some(isActiveValidation)) return edit;
        revoked = true;
        return {
            ...edit,
            validatedBy: edit.validatedBy.map((entry): unknown => {
                if (!isActiveValidation(entry)) return entry;
                if (typeof entry === "string") {
                    return { username: entry, creationTimestamp: timestamp, updatedTimestamp: timestamp, isDeleted: true };
                }
                return { ...(entry as ValidationEntry), isDeleted: true, updatedTimestamp: timestamp };
            }),
        };
    });
    return revoked;
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
    const docx = isDocxFormattingContext(existingSource.metadata) && isDocxFormattingContext(newSource.metadata);
    const sourceText = (cell: ReimportCell): string => getReimportSourceText(cell, docx);
    const freshToRetainedCellIds = new Map<string, string>();

    const oldTargets = resolveExistingTargets(existingSource, existingCodex);

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
            targetCell: oldTargets.get(cell),
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
        const text = sourceText(cell);
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
        insertedCells: 0,
        flaggedCells: 0,
        unvalidatedCells: 0,
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
        return { sourceCell, codexCell, normalizedText: sourceText(sourceCell), isText };
    });

    // Cells that already found an old counterpart. Later passes must skip
    // them, or a structurally matched cell would be matched a second time
    // against an unrelated old cell with the same text.
    const adopted = new Set<PendingCell>();
    /** Which old cell each new cell took over, for gap alignment below. */
    const matchedEntry = new Map<PendingCell, OldCellEntry>();

    const adoptOldCell = (cell: PendingCell, entry: OldCellEntry, carriedValue: string) => {
        entry.consumed = true;
        adopted.add(cell);
        matchedEntry.set(cell, entry);
        const oldId = entry.sourceCell.metadata!.id as string;
        const freshId = cell.sourceCell.metadata?.id;
        if (typeof freshId === "string") freshToRetainedCellIds.set(freshId, oldId);
        const oldSourceMetadata = entry.sourceCell.metadata as Record<string, unknown>;

        // Source side: keep the old id and edit history; record the new value
        // and locator changes as MIGRATION edits so they survive the sync merge.
        cell.sourceCell.metadata = {
            ...(cell.sourceCell.metadata ?? {}),
            id: oldId,
            edits: [...(entry.sourceCell.metadata?.edits ?? [])],
        };
        appendValueEditIfChanged(cell.sourceCell, entry.sourceCell.value, now);
        appendImporterMetadataEdits(
            cell.sourceCell,
            oldSourceMetadata,
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
        appendImporterMetadataEdits(
            cell.codexCell,
            oldTargetMetadata,
            now,
        );

        stats.matchedCells++;
        if (carriedValue.trim() !== "") {
            stats.translationsCarried++;
        }
    };

    // Flags live on both sides: the source cell so the editor can show what
    // changed, the target cell so progress/navigation can surface the work.
    const flaggedPending = new Set<PendingCell>();
    const markNeedsResolution = (cell: PendingCell) => {
        if (flaggedPending.has(cell)) return;
        flaggedPending.add(cell);
        flagNeedsResolution(cell.sourceCell, now);
        flagNeedsResolution(cell.codexCell, now);
        stats.flaggedCells++;
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
        const freshId = cell.sourceCell.metadata?.id;
        if (typeof freshId === "string") freshToRetainedCellIds.set(freshId, oldId);
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

    // Pass 0 (Biblica): match on IDML locators, which are independent of the
    // cell's content. This runs before text matching so a cell whose content
    // the importer legitimately changed still finds its old translation
    // instead of being tombstoned and replaced by an empty cell.
    if (canStructurallyMatchBiblica(existingSource, newSource)) {
        const oldIndex = indexByBiblicaParagraph(oldEntries, (entry) => entry.sourceCell);
        const newIndex = indexByBiblicaParagraph(
            pending.filter((cell) => cell.isText),
            (cell) => cell.sourceCell,
        );
        for (const newGroup of newIndex.groups) {
            const oldMembers = (
                findMatchingParagraphGroup(oldIndex, newGroup)?.members ?? []
            ).filter((member) => !member.item.consumed);
            // No old counterpart at all: a paragraph the document gained.
            // Its cells stay unmatched and get inserted in document order.
            if (oldMembers.length === 0) continue;

            // A paragraph that now yields a different number of cells was
            // re-split by the importer. Every cell in it needs re-resolving,
            // because the existing translation may straddle the new
            // boundaries even where the text still matches.
            const wasResplit = oldMembers.length !== newGroup.members.length;

            newGroup.members.forEach((newMember, index) => {
                const cell = newMember.item;
                if (wasResplit) markNeedsResolution(cell);

                const entry = oldMembers[index]?.item;
                // Extra new slice in a re-split paragraph: nothing to adopt,
                // it becomes an inserted (empty, flagged) cell.
                if (!entry || entry.consumed) return;

                // Old slices past the end of the new group have nowhere to go.
                // Fold their translations into this last slice rather than
                // losing them; the flag above tells the user to sort it out.
                const isLastNewSlice = index === newGroup.members.length - 1;
                const surplus = isLastNewSlice ? oldMembers.slice(index + 1) : [];
                const carried = [entry, ...surplus.map((member) => member.item)]
                    .map((candidate) => candidate.targetCell?.value?.trim() ?? "")
                    .filter((value) => value !== "")
                    .join(" ");

                const contentChanged =
                    sourceText(cell.sourceCell) !== sourceText(entry.sourceCell);
                adoptOldCell(cell, entry, carried);
                for (const member of surplus) {
                    member.item.consumed = true;
                    stats.droppedOldCells++;
                }
                if (contentChanged) markNeedsResolution(cell);
            });
        }
    }

    // Pass 1: exact text match.
    const unmatched: PendingCell[] = [];
    for (const cell of pending) {
        if (!cell.isText || !cell.normalizedText || adopted.has(cell)) continue;
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
            const oldText = sourceText(entry.sourceCell);
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

    // Pass 3 (Biblica): align what is left by position.
    //
    // The passes above all need either a locator or recognisable text. When an
    // importer fix rewrites a cell's text and its locators do not line up with
    // what is on disk, a cell matches on nothing, its old counterpart is
    // tombstoned, and the translation is orphaned — for a document where that
    // happens broadly, the whole target comes out blank.
    //
    // Cells that DID match are reliable anchors, so unmatched cells between
    // two anchors can be paired off in order against the unmatched old cells
    // from the same span. Everything paired here is content-changed by
    // definition, so it is all flagged for review rather than trusted.
    if (isBiblicaImportContext(existingSource.metadata) && isBiblicaImportContext(newSource.metadata)) {
        const textPending = pending.filter((cell) => cell.isText);
        const remainingOld = oldEntries.filter((entry) => !entry.consumed);

        // Anchor positions in both sequences, plus sentinels for the spans
        // before the first and after the last anchor.
        const anchorPositions: Array<{ newIndex: number; oldOrder: number; }> = [];
        textPending.forEach((cell, newIndex) => {
            const entry = matchedEntry.get(cell);
            if (entry) anchorPositions.push({ newIndex, oldOrder: entry.order });
        });

        const spans: Array<{ newFrom: number; newTo: number; oldFrom: number; oldTo: number; }> = [];
        let previous = { newIndex: -1, oldOrder: -1 };
        for (const anchor of [...anchorPositions, { newIndex: textPending.length, oldOrder: Infinity }]) {
            if (anchor.newIndex > previous.newIndex + 1) {
                spans.push({
                    newFrom: previous.newIndex + 1,
                    newTo: anchor.newIndex,
                    oldFrom: previous.oldOrder,
                    oldTo: anchor.oldOrder,
                });
            }
            previous = anchor;
        }

        for (const span of spans) {
            const newCells = textPending
                .slice(span.newFrom, span.newTo)
                .filter((cell) => !adopted.has(cell));
            const oldCells = remainingOld.filter(
                (entry) => !entry.consumed && entry.order > span.oldFrom && entry.order < span.oldTo,
            );
            newCells.forEach((cell, index) => {
                const entry = oldCells[index];
                // More new cells than old in this span: genuinely new content,
                // which stays unmatched and is reported as inserted.
                if (!entry || entry.consumed) return;
                adoptOldCell(cell, entry, entry.targetCell?.value ?? "");
                markNeedsResolution(cell);
            });
        }
    }

    // A sign-off was given against the old source. Wherever that source changed, or the cell was
    // flagged for any other reason, the translation has to be checked again, so the flag goes on
    // (containment matches change the source without being flagged above) and the sign-off comes off.
    for (const cell of adopted) {
        const entry = matchedEntry.get(cell);
        if (entry && sourceText(cell.sourceCell) !== sourceText(entry.sourceCell)) {
            markNeedsResolution(cell);
        }
        if (flaggedPending.has(cell) && revokeValidations(cell.codexCell, now)) {
            stats.unvalidatedCells++;
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

    // Change report, in document order: what the user will see appear, what
    // they will have to re-resolve, and what will disappear from the file.
    const changes: ReimportCellChange[] = [];
    for (const cell of pending) {
        if (!cell.isText) continue;
        if (!adopted.has(cell)) {
            stats.insertedCells++;
            changes.push(
                describeReimportCell("inserted", cell.sourceCell, cell.codexCell.value, flaggedPending.has(cell), sourceText),
            );
        } else if (flaggedPending.has(cell)) {
            changes.push(
                describeReimportCell("updated", cell.sourceCell, cell.codexCell.value, true, sourceText),
            );
        }
    }
    for (const entry of retiredEntries) {
        changes.push(
            describeReimportCell("removed", entry.sourceCell, entry.targetCell?.value, false, sourceText),
        );
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

    const remappedSourceMetadata = remapNotebookMetadataCellIds(
        newSource.metadata,
        freshToRetainedCellIds,
    );
    const remappedCodexMetadata = remapNotebookMetadataCellIds(
        newCodex.metadata,
        freshToRetainedCellIds,
    );

    return {
        mergedSource: {
            cells: mergedSourceCells,
            metadata: mergeNotebookMetadata(existingSource.metadata, remappedSourceMetadata, now),
        },
        mergedCodex: {
            cells: mergedCodexCells,
            metadata: mergeNotebookMetadata(existingCodex.metadata, remappedCodexMetadata, now),
        },
        stats,
        changes,
    };
};
