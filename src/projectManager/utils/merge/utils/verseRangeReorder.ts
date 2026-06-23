import { CodexCellTypes, EditType } from "../../../../../types/enums";
import { extractParentCellIdFromParatext } from "../../../../providers/codexCellEditorProvider/utils/cellUtils";
import {
    parseVerseRef,
    getSortKeyFromParsedRef,
    stripCellIdSuffix,
    type ParsedVerseRef,
} from "../../../../utils/verseRefUtils";
import { isBibleTypeImporter } from "../../../../../sharedUtils/importerTypeUtils";
import bibleData from "../../../../../webviews/codex-webviews/src/assets/bible-books-lookup.json";

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

export interface VerseRangeReorderOptions {
    /**
     * The notebook's `metadata.importerType`. When provided and the type is a known
     * non-Bible importer (docx, markdown, subtitles, …) the helper is a strict no-op:
     * those notebooks are documents, and any verse references they carry are citations,
     * not structural verse cells. Missing/unknown types fall back to the content checks.
     */
    importerType?: string | null;
}

/** Inclusive chapter range a milestone covers ("John 4" -> 4..4, "Job 4-31" -> 4..31). */
interface ChapterRange {
    start: number;
    end: number;
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
 *   - No-ops when `options.importerType` names a known non-Bible importer.
 *   - Early-exits when the file has no milestones AND no verse-range cells (`parsed.kind === "range"`).
 *     Non-scripture notebooks (notes, glossaries, etc.) are returned untouched.
 *   - Bails out (original order preserved) when no content cell carries a parseable verse ref —
 *     e.g. IDML-imported files whose globalReferences are book-only, like ["JOB"] — and when
 *     milestones exist but none of them can be matched to any content chapter (e.g. every
 *     milestone value is unparseable). Reordering in those cases would hoist every milestone to
 *     the top of the file and dump all text cells after them.
 *   - Milestone values may cover a chapter range ("Job 4-31"); content for any chapter in the
 *     range is placed under that milestone. In multi-book files the milestone's book name is
 *     resolved against the Bible book lookup so "Job 4" cannot capture "SNG 4:1" content.
 *   - Cells the helper cannot place by verse ref (section headings and markers imported as TEXT
 *     cells with empty globalReferences, STYLE cells, orphan paratexts, unmatched-chapter refs)
 *     stay anchored to the nearest preceding milestone/verse cell, preserving their original
 *     neighborhood instead of being moved to the end of the file.
 *   - Always emits paratext cells immediately BEFORE their parent cell. Section-heading style
 *     paratexts in scripture (e.g. \\s) belong above the verse they introduce. Multiple
 *     paratexts pointing at the same parent retain their original relative order.
 *   - Strips legacy `:1`-style cell-id suffixes from `globalReferences[0]` (idempotent).
 *   - Auto-fills `cellLabel` and `chapterNumber` on verse-range cells from the parsed ref, but
 *     skips the autofill when the cell already has a non-MIGRATION `metadata.cellLabel` edit so
 *     that human relabels are not clobbered.
 *   - Never drops cells: a final sweep appends anything not otherwise emitted, in original order.
 */
export function reorderVerseRangeCells(
    cells: any[],
    options?: VerseRangeReorderOptions
): VerseRangeReorderResult {
    if (!Array.isArray(cells) || cells.length === 0) {
        return { cells: cells ?? [], mutated: false, orderChanged: false };
    }

    // Known non-Bible importer -> the notebook is a document, not scripture. Any verse refs on
    // its cells are citations; reordering by them would scramble the document.
    const importerType = options?.importerType;
    if (typeof importerType === "string" && importerType.trim() && !isBibleTypeImporter(importerType)) {
        return { cells, mutated: false, orderChanged: false };
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

    // Second pass: full partition. We track each cell's original index so paratext parents can
    // be located, content can be assigned to the nearest milestone, and the final ordering stays
    // deterministic.
    type ContentItem = {
        cell: any;
        parsed: ParsedVerseRef;
        sortKey: SortKey;
        originalIndex: number;
    };
    const milestones: Array<{
        cell: any;
        range: ChapterRange | null;
        bookAbbr: string | null;
        originalIndex: number;
        assigned: ContentItem[];
    }> = [];
    const contentWithRef: ContentItem[] = [];
    const parentedParatexts = new Set<any>();

    let mutated = false;

    const originalIndexById = new Map<string, number>();
    for (let i = 0; i < cells.length; i++) {
        const id = cells[i]?.metadata?.id;
        if (typeof id === "string" && id.length > 0 && !originalIndexById.has(id)) {
            originalIndexById.set(id, i);
        }
    }

    // Paratexts are emitted immediately before their parent. Orphans (parent id missing from
    // the file) are NOT bucketed — they stay anchored in place like any other unplaceable cell.
    const paratextBeforeParent = new Map<string, any[]>();

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const md = cell?.metadata || {};
        const cellType = md.type;
        const cellId = md.id;

        if (cellType === CodexCellTypes.MILESTONE) {
            const milestoneValue = typeof cell?.value === "string" ? cell.value : "";
            milestones.push({
                cell,
                range: extractChapterRangeFromMilestoneValue(milestoneValue),
                bookAbbr: resolveBookAbbrFromMilestoneValue(milestoneValue),
                originalIndex: i,
                assigned: [],
            });
            continue;
        }

        if (cellType === CodexCellTypes.PARATEXT && cellId) {
            const parentId = extractParentCellIdFromParatext(
                typeof cellId === "string" ? cellId : String(cellId),
                md
            );
            if (typeof parentId === "string" && originalIndexById.has(parentId)) {
                if (!paratextBeforeParent.has(parentId)) paratextBeforeParent.set(parentId, []);
                paratextBeforeParent.get(parentId)!.push(cell);
                parentedParatexts.add(cell);
            }
            continue;
        }

        if (cellType === CodexCellTypes.STYLE) {
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
        }
    }

    // Bail out when no content cell carries a parseable verse ref (e.g. IDML-imported files
    // whose globalReferences are book-only, like ["JOB"], or empty). There is nothing to
    // partition by chapter — preserve the original order.
    if (contentWithRef.length === 0) {
        return { cells, mutated, orderChanged: false };
    }

    // Auto-fill cellLabel / chapterNumber on verse-range cells from the parsed ref. This is a
    // purely per-cell relabel that does not depend on ordering, so we apply it up front — that
    // way the relabel still happens even when one of the order-preserving bail-outs below fires.
    // User relabels (a non-MIGRATION cellLabel edit) are never clobbered.
    for (const item of contentWithRef) {
        const parsed = item.parsed;
        if (parsed.kind !== "range" || hasUserCellLabelEdit(item.cell)) continue;
        const md = item.cell.metadata || {};
        if (md.cellLabel !== parsed.cellLabel) {
            md.cellLabel = parsed.cellLabel;
            mutated = true;
        }
        if (md.chapterNumber === undefined || md.chapterNumber === null) {
            md.chapterNumber = String(parsed.chapter);
            mutated = true;
        }
        item.cell.metadata = md;
    }

    // In multi-book files a milestone may only claim chapters of its own book; a milestone whose
    // book cannot be resolved claims nothing. Single-book files match by chapter alone.
    const contentBooks = new Set<string>();
    for (const item of contentWithRef) contentBooks.add(item.sortKey.book.toUpperCase());
    const multiBook = contentBooks.size > 1;

    const covers = (
        milestone: (typeof milestones)[number],
        item: ContentItem
    ): boolean => {
        if (!milestone.range) return false;
        if (multiBook) {
            if (!milestone.bookAbbr) return false;
            if (milestone.bookAbbr !== item.sortKey.book.toUpperCase()) return false;
        }
        return (
            item.sortKey.chapter >= milestone.range.start &&
            item.sortKey.chapter <= milestone.range.end
        );
    };

    // Assign each content cell to the milestone section it lives in. We attach a cell ONLY to an
    // immediately-adjacent milestone (no other milestone sitting between the cell and that
    // milestone): the nearest milestone PRECEDING the cell if that one covers its chapter,
    // otherwise the nearest milestone FOLLOWING the cell if THAT one covers it. A cell is never
    // pulled across intervening milestones to a far-away covering milestone — that would, e.g.,
    // yank a trailing block of empty duplicate verse cells up into the live scripture. Cells with
    // no adjacent covering milestone stay anchored exactly where they are (handled below).
    //
    // Consequences worth noting:
    //   - A verse already sitting under its chapter milestone keeps its section; we only re-sort
    //     within the section, so a correctly-ordered notebook is a strict no-op.
    //   - A verse-range cell that drifted just above its milestone (nothing between it and that
    //     milestone) is pulled down via the "nearest following" branch — the original migration's
    //     core job.
    const milestoneIndices = milestones.map((m) => m.originalIndex);
    const assignedCells = new Set<any>();
    if (milestones.length > 0) {
        for (const item of contentWithRef) {
            // Binary-free scan is fine (milestone counts are small). Find the split point: the
            // first milestone whose original index is greater than the cell's.
            let nextM = milestones.length;
            for (let m = 0; m < milestones.length; m++) {
                if (milestoneIndices[m] > item.originalIndex) { nextM = m; break; }
            }
            const precedingM = nextM - 1; // nearest milestone before the cell, or -1
            let chosen: (typeof milestones)[number] | null = null;
            if (precedingM >= 0 && covers(milestones[precedingM], item)) {
                chosen = milestones[precedingM];
            } else if (nextM < milestones.length && covers(milestones[nextM], item)) {
                chosen = milestones[nextM];
            }
            if (chosen) {
                chosen.assigned.push(item);
                assignedCells.add(item.cell);
            }
        }
        // Sort each milestone's assigned content into canonical (chapter, verse) order. The sort
        // is stable, so cells sharing a sort key keep their original relative order.
        for (const milestone of milestones) {
            milestone.assigned.sort(
                (a, b) =>
                    a.sortKey.chapter - b.sortKey.chapter ||
                    a.sortKey.verse - b.sortKey.verse
            );
        }
    }

    // Bail out when milestones exist but none of them claimed any content (e.g. unparseable or
    // index-based milestone values that don't correspond to content chapters). Reordering would
    // detach every content cell from its milestone, so keep the original order.
    if (milestones.length > 0 && assignedCells.size === 0) {
        return { cells, mutated, orderChanged: false };
    }

    // Anchors are the cells the helper actively places: milestones plus the verse cells it
    // assigned to them (or ALL ref cells when the file has no milestones — legacy global sort).
    const anchorCells = new Set<any>();
    for (const m of milestones) anchorCells.add(m.cell);
    if (milestones.length > 0) {
        for (const cell of assignedCells) anchorCells.add(cell);
    } else {
        for (const item of contentWithRef) anchorCells.add(item.cell);
    }

    // Everything else stays attached to the nearest preceding anchor so unplaceable cells
    // (no-ref TEXT cells, STYLE cells, orphan paratexts, unmatched refs) keep their neighborhood.
    const attachments = new Map<any, any[]>();
    const startGroup: any[] = [];
    let lastAnchor: any = null;
    for (const cell of cells) {
        if (anchorCells.has(cell)) {
            lastAnchor = cell;
            continue;
        }
        if (parentedParatexts.has(cell)) continue;
        if (lastAnchor) {
            if (!attachments.has(lastAnchor)) attachments.set(lastAnchor, []);
            attachments.get(lastAnchor)!.push(cell);
        } else {
            startGroup.push(cell);
        }
    }

    const newCells: any[] = [];
    const emitted = new Set<any>();
    const emitCell = (cell: any) => {
        if (!cell || emitted.has(cell)) return;
        emitted.add(cell);
        const id = cell?.metadata?.id;
        if (typeof id === "string") {
            const before = paratextBeforeParent.get(id);
            if (before) {
                for (const pt of before) emitCell(pt);
            }
        }
        newCells.push(cell);
        const trailing = attachments.get(cell);
        if (trailing) {
            for (const attached of trailing) emitCell(attached);
        }
    };

    for (const cell of startGroup) emitCell(cell);

    if (milestones.length > 0) {
        for (const milestone of milestones) {
            emitCell(milestone.cell);
            for (const item of milestone.assigned) emitCell(item.cell);
        }
    } else {
        // No milestones: emit all ref cells in canonical (book, chapter, verse) order. This is
        // the original migration behavior for milestone-less files with verse-range cells.
        const sorted = [...contentWithRef].sort(
            (a, b) =>
                a.sortKey.book.localeCompare(b.sortKey.book) ||
                a.sortKey.chapter - b.sortKey.chapter ||
                a.sortKey.verse - b.sortKey.verse
        );
        for (const item of sorted) emitCell(item.cell);
    }

    // Safety net: never drop a cell. Anything not yet emitted is appended in original order.
    for (const cell of cells) emitCell(cell);

    if (newCells.length !== cells.length) {
        // Duplicate cell instances in the input (pathological) collapse in the emitted set.
        // Refuse to reorder rather than change the cell count during a merge.
        return { cells, mutated, orderChanged: false };
    }

    let orderChanged = false;
    for (let i = 0; i < cells.length; i++) {
        if (newCells[i] !== cells[i]) {
            orderChanged = true;
            break;
        }
    }

    return { cells: newCells, mutated, orderChanged };
}

type SortKey = { book: string; chapter: number; verse: number; };

/**
 * Extracts the inclusive chapter range from a milestone cell's value.
 * "John 4" / "4" -> 4..4; "Job 4-31" -> 4..31; no usable number -> null.
 */
function extractChapterRangeFromMilestoneValue(value: string | undefined): ChapterRange | null {
    if (value == null || typeof value !== "string") return null;
    const rangeMatch = value.match(/(\d+)\s*[-–—]\s*(\d+)\s*$/);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (!isNaN(start) && !isNaN(end) && start > 0 && start <= end) {
            return { start, end };
        }
        return null;
    }
    const matches = value.match(/(\d+)(?!.*\d)/);
    if (matches?.[1]) {
        const n = parseInt(matches[1], 10);
        return !isNaN(n) && n > 0 ? { start: n, end: n } : null;
    }
    const parsed = parseInt(value, 10);
    return !isNaN(parsed) && parsed > 0 ? { start: parsed, end: parsed } : null;
}

/**
 * Resolves the book portion of a milestone value ("Job 4-31" -> "JOB") against the Bible book
 * lookup. Returns null when the leading text is empty or doesn't match a known book name,
 * abbreviation, or OSIS id. Only consulted for multi-book files.
 */
function resolveBookAbbrFromMilestoneValue(value: string | undefined): string | null {
    if (value == null || typeof value !== "string") return null;
    const candidate = value.replace(/\s*\d+\s*([-–—]\s*\d+)?\s*$/, "").trim();
    if (!candidate) return null;
    const normalized = candidate.replace(/\.$/, "").toLowerCase();
    for (const book of bibleData as any[]) {
        if (typeof book?.abbr !== "string") continue;
        if (
            book.abbr.toLowerCase() === normalized ||
            (typeof book.name === "string" && book.name.toLowerCase() === normalized) ||
            (typeof book.osisId === "string" && book.osisId.toLowerCase() === normalized) ||
            (Array.isArray(book.abbreviations) &&
                book.abbreviations.some(
                    (a: any) => typeof a === "string" && a.replace(/\.$/, "").toLowerCase() === normalized
                ))
        ) {
            return book.abbr.toUpperCase();
        }
    }
    return null;
}
