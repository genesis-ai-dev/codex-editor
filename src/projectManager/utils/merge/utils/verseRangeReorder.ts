import { CodexCellTypes, EditType } from "../../../../../types/enums";
import { extractParentCellIdFromParatext } from "../../../../providers/codexCellEditorProvider/utils/cellUtils";
import {
    parseVerseRef,
    getSortKeyFromParsedRef,
    stripCellIdSuffix,
    type ParsedVerseRef,
} from "../../../../utils/verseRefUtils";

/**
 * Result of running {@link reorderVerseRangeCells}.
 *
 * - `cells` — the (possibly) reordered cell array. The same cell instances are reused; only the
 *   array order and a few metadata fields are touched.
 * - `mutated` — `true` when this function mutated metadata on at least one cell (cellLabel /
 *   chapterNumber autofill, or `:1`-style cell id suffix stripped from `globalReferences[0]`).
 * - `orderChanged` — `true` when the output cell order differs from the input order.
 *
 * The helper does NOT add edit-history entries, soft-delete cells, merge values, or modify any
 * field other than the ones listed above. It is safe to call from the codex merge resolver on
 * every merge — orphan paratext soft-delete and child→parent merging stay in the migration.
 */
export interface VerseRangeReorderResult {
    cells: any[];
    mutated: boolean;
    orderChanged: boolean;
}

/** Decide whether a cell already carries a non-MIGRATION edit on `metadata.cellLabel`. */
function hasUserCellLabelEdit(cell: any): boolean {
    const edits = cell?.metadata?.edits;
    if (!Array.isArray(edits)) return false;
    for (const edit of edits) {
        if (!edit || edit.type === EditType.MIGRATION) continue;
        const editMap = edit.editMap;
        if (!Array.isArray(editMap)) continue;
        if (editMap.length === 2 && editMap[0] === "metadata" && editMap[1] === "cellLabel") {
            return true;
        }
    }
    return false;
}

/**
 * Pure reorder/relabel pass for a notebook's cells. Used by both the verse-range migration and
 * the codex merge resolver so that the migrated cell ordering survives git syncs.
 *
 * Behavior:
 *   - Early-exits when the file has no milestones AND no verse-range cells (`parsed.kind === "range"`).
 *     Non-scripture notebooks (notes, glossaries, etc.) are returned untouched.
 *   - Builds two paratext buckets per parent — BEFORE and AFTER — based on each paratext's original
 *     index relative to its parent's original index, and emits each bucket on the correct side of
 *     the parent. Paratext that was originally adjacent to its parent (e.g. a chapter-heading
 *     paratext between a milestone and the first verse) stays where it was.
 *   - Strips legacy `:1`-style cell-id suffixes from `globalReferences[0]` (idempotent).
 *   - Auto-fills `cellLabel` and `chapterNumber` on verse-range cells from the parsed ref, but
 *     skips the autofill when the cell already has a non-MIGRATION `metadata.cellLabel` edit so
 *     that human relabels are not clobbered.
 *   - Orphan paratexts (parentId not present in the file) are NOT touched: they keep their
 *     original index and are never soft-deleted by this helper. The migration handles orphan
 *     soft-delete itself so that resolver-time calls have zero mutating side-effects beyond
 *     ordering and the safe relabel/cleanup listed above.
 */
export function reorderVerseRangeCells(cells: any[]): VerseRangeReorderResult {
    if (!Array.isArray(cells) || cells.length === 0) {
        return { cells: cells ?? [], mutated: false, orderChanged: false };
    }

    // First pass: cheap detection so we can no-op on non-scripture notebooks.
    let hasMilestone = false;
    let hasRangeCell = false;
    for (const cell of cells) {
        const md = cell?.metadata;
        if (!md) continue;
        if (md.type === CodexCellTypes.MILESTONE) {
            hasMilestone = true;
        } else if (
            md.type !== CodexCellTypes.PARATEXT &&
            md.type !== CodexCellTypes.STYLE
        ) {
            const ref = md.data?.globalReferences?.[0];
            if (typeof ref === "string") {
                const parsed = parseVerseRef(ref);
                if (parsed?.kind === "range") hasRangeCell = true;
            }
        }
        if (hasMilestone && hasRangeCell) break;
    }

    if (!hasMilestone && !hasRangeCell) {
        return { cells, mutated: false, orderChanged: false };
    }

    // Second pass: full partition. We track each cell's original index so we can place paratexts
    // on the correct side of their parent (BEFORE vs AFTER) and decide where orphan paratexts
    // belong in the final output.
    const milestones: Array<{ cell: any; chapter: number | null; originalIndex: number; }> = [];
    const contentWithRef: Array<{
        cell: any;
        parsed: ParsedVerseRef;
        sortKey: { book: string; chapter: number; verse: number; };
        originalIndex: number;
    }> = [];
    const contentWithoutRef: Array<{ cell: any; originalIndex: number; }> = [];
    const styleOrOther: Array<{ cell: any; originalIndex: number; }> = [];
    const paratextOriginal: Array<{ cell: any; originalIndex: number; parentId: string | null; }> = [];

    let mutated = false;

    // First pass: classify every cell and remember the original index of each id.
    const originalIndexById = new Map<string, number>();
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const id = cell?.metadata?.id;
        if (typeof id === "string" && id.length > 0) {
            originalIndexById.set(id, i);
        }
    }

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const md = cell?.metadata || {};
        const cellType = md.type;
        const cellId = md.id;

        if (cellType === CodexCellTypes.MILESTONE) {
            const milestoneValue = typeof cell?.value === "string" ? cell.value : "";
            const chapter = extractChapterNumberFromMilestoneValue(milestoneValue);
            milestones.push({ cell, chapter, originalIndex: i });
            continue;
        }

        if (cellType === CodexCellTypes.PARATEXT && cellId) {
            const parentId = extractParentCellIdFromParatext(
                typeof cellId === "string" ? cellId : String(cellId),
                md
            );
            paratextOriginal.push({ cell, originalIndex: i, parentId });
            continue;
        }

        if (cellType === CodexCellTypes.STYLE) {
            styleOrOther.push({ cell, originalIndex: i });
            continue;
        }

        const rawRef = md.data?.globalReferences?.[0];
        if (typeof rawRef === "string") {
            const cleanedRef = stripCellIdSuffix(rawRef);
            if (cleanedRef !== rawRef) {
                if (!md.data) md.data = {};
                md.data.globalReferences = [cleanedRef];
                cell.metadata = md;
                mutated = true;
            }
        }
        const ref = md.data?.globalReferences?.[0];
        const parsed = typeof ref === "string" ? parseVerseRef(ref) : null;
        if (parsed) {
            const sortKey = getSortKeyFromParsedRef(parsed);
            contentWithRef.push({ cell, parsed, sortKey, originalIndex: i });
        } else {
            contentWithoutRef.push({ cell, originalIndex: i });
        }
    }

    // Bucket paratexts by parent + side (BEFORE/AFTER), and collect orphans separately.
    const paratextBeforeParent = new Map<string, any[]>();
    const paratextAfterParent = new Map<string, any[]>();
    const orphanParatexts: Array<{ cell: any; originalIndex: number; }> = [];
    for (const pt of paratextOriginal) {
        const parentId = pt.parentId;
        const parentIndex =
            typeof parentId === "string" ? originalIndexById.get(parentId) : undefined;
        if (parentId && parentIndex !== undefined) {
            if (pt.originalIndex < parentIndex) {
                if (!paratextBeforeParent.has(parentId)) paratextBeforeParent.set(parentId, []);
                paratextBeforeParent.get(parentId)!.push(pt.cell);
            } else {
                if (!paratextAfterParent.has(parentId)) paratextAfterParent.set(parentId, []);
                paratextAfterParent.get(parentId)!.push(pt.cell);
            }
        } else {
            orphanParatexts.push({ cell: pt.cell, originalIndex: pt.originalIndex });
        }
    }

    // Partition content-with-ref by (book, chapter), sort each by verse start.
    const contentByChapter = new Map<string, typeof contentWithRef>();
    for (const item of contentWithRef) {
        const key = `${item.sortKey.book}\t${item.sortKey.chapter}`;
        if (!contentByChapter.has(key)) contentByChapter.set(key, []);
        contentByChapter.get(key)!.push(item);
    }
    for (const arr of contentByChapter.values()) {
        arr.sort((a, b) => a.sortKey.verse - b.sortKey.verse);
    }

    const newCells: any[] = [];
    const consumedParentIds = new Set<string>();

    const emitContentCell = (item: (typeof contentWithRef)[0]) => {
        const { cell, parsed } = item;
        const md = cell.metadata || {};
        const parentId = md.id;

        if (parsed.kind === "range" && !hasUserCellLabelEdit(cell)) {
            if (md.cellLabel !== parsed.cellLabel) {
                md.cellLabel = parsed.cellLabel;
                mutated = true;
            }
            if (md.chapterNumber === undefined || md.chapterNumber === null) {
                md.chapterNumber = String(parsed.chapter);
                mutated = true;
            }
            cell.metadata = md;
        }

        if (typeof parentId === "string") {
            const before = paratextBeforeParent.get(parentId);
            if (before) {
                for (const pt of before) newCells.push(pt);
                consumedParentIds.add(parentId);
            }
        }
        newCells.push(cell);
        if (typeof parentId === "string") {
            const after = paratextAfterParent.get(parentId);
            if (after) {
                for (const pt of after) newCells.push(pt);
                consumedParentIds.add(parentId);
            }
        }
    };

    for (const { cell, chapter } of milestones) {
        newCells.push(cell);
        if (chapter != null) {
            const keysToDelete: string[] = [];
            for (const [key, items] of contentByChapter.entries()) {
                const [, chapStr] = key.split("\t");
                if (parseInt(chapStr, 10) === chapter) {
                    for (const item of items) emitContentCell(item);
                    keysToDelete.push(key);
                }
            }
            for (const k of keysToDelete) contentByChapter.delete(k);
        }
    }

    // Emit remaining content-with-ref (chapter not matched to any milestone) in deterministic order.
    const remaining: typeof contentWithRef = [];
    for (const items of contentByChapter.values()) remaining.push(...items);
    remaining.sort(
        (a, b) =>
            a.sortKey.book.localeCompare(b.sortKey.book) ||
            a.sortKey.chapter - b.sortKey.chapter ||
            a.sortKey.verse - b.sortKey.verse
    );
    for (const item of remaining) emitContentCell(item);

    // Emit content-without-ref cells, attaching any paratexts whose parent matches.
    for (const { cell } of contentWithoutRef) {
        const parentId = cell.metadata?.id;
        if (typeof parentId === "string") {
            const before = paratextBeforeParent.get(parentId);
            if (before) {
                for (const pt of before) newCells.push(pt);
                consumedParentIds.add(parentId);
            }
        }
        newCells.push(cell);
        if (typeof parentId === "string") {
            const after = paratextAfterParent.get(parentId);
            if (after) {
                for (const pt of after) newCells.push(pt);
                consumedParentIds.add(parentId);
            }
        }
    }

    // Any paratext buckets we didn't consume (parent existed but was filtered out, e.g. as a
    // style cell) get appended in the same relative order they appeared originally so they
    // aren't lost.
    const leftoverBuckets: Array<{ cell: any; originalIndex: number; }> = [];
    for (const [parentId, bucket] of paratextBeforeParent) {
        if (consumedParentIds.has(parentId)) continue;
        for (const pt of bucket) {
            const originalIndex = (() => {
                const id = pt.metadata?.id;
                return typeof id === "string"
                    ? originalIndexById.get(id) ?? Number.MAX_SAFE_INTEGER
                    : Number.MAX_SAFE_INTEGER;
            })();
            leftoverBuckets.push({ cell: pt, originalIndex });
        }
    }
    for (const [parentId, bucket] of paratextAfterParent) {
        if (consumedParentIds.has(parentId)) continue;
        for (const pt of bucket) {
            const originalIndex = (() => {
                const id = pt.metadata?.id;
                return typeof id === "string"
                    ? originalIndexById.get(id) ?? Number.MAX_SAFE_INTEGER
                    : Number.MAX_SAFE_INTEGER;
            })();
            leftoverBuckets.push({ cell: pt, originalIndex });
        }
    }

    // Style/other and orphan paratexts retain their relative ordering by original index.
    const tail: Array<{ cell: any; originalIndex: number; }> = [
        ...styleOrOther,
        ...orphanParatexts,
        ...leftoverBuckets,
    ];
    tail.sort((a, b) => a.originalIndex - b.originalIndex);
    for (const { cell } of tail) newCells.push(cell);

    const oldIds = cells.map((c) => c?.metadata?.id ?? "").join(",");
    const newIds = newCells.map((c) => c?.metadata?.id ?? "").join(",");
    const orderChanged = oldIds !== newIds;

    return { cells: newCells, mutated, orderChanged };
}

/**
 * Extracts a chapter number from a milestone cell's value (e.g. "John 4", "4", "GEN 2").
 * Mirrors the local helper in migrationUtils so the helper file has no circular import.
 */
function extractChapterNumberFromMilestoneValue(value: string | undefined): number | null {
    if (value == null || typeof value !== "string") return null;
    const matches = value.match(/(\d+)(?!.*\d)/);
    if (matches?.[1]) {
        const n = parseInt(matches[1], 10);
        return !isNaN(n) && n > 0 ? n : null;
    }
    const parsed = parseInt(value, 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : null;
}
