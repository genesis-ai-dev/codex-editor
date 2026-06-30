import { CodexCellTypes, EditType } from "../../../../../types/enums";
import { EditMapUtils } from "../../../../utils/editMapUtils";
import { parseVerseRef } from "../../../../utils/verseRefUtils";
import { isBibleTypeImporter } from "../../../../../sharedUtils/importerTypeUtils";

/**
 * Verse-range duplication repair (issue #848 / Pattani Malay).
 *
 * When a book exists in two versifications at once — verse-RANGE cells ("MAT 8:14-15")
 * coexisting with SINGLE-verse cells ("MAT 8:14", "MAT 8:15") — the codex merge resolver keeps
 * BOTH (it dedupes by metadata.id, and the two forms carry different ids), so the duplicates
 * accumulate with translated content stranded across the two forms. This module collapses the
 * duplication WITHOUT losing content or imposing a versification, and is shared by:
 *   - the one-off repair migration (migration_repairVerseRangeDuplication), and
 *   - the codex merge resolver (so duplication self-heals on every git sync and can't recur).
 *
 * Pure (no vscode); safe to unit-test standalone.
 */

interface VerseRepairCell {
    cell: any;
    id: string;
    ref: string;
    verses: number[];
    isRange: boolean;
    content: boolean;
}

/** True when a cell value carries real text once HTML tags / whitespace are stripped. */
export function verseRepairHasContent(value: unknown): boolean {
    if (typeof value !== "string" || value.length === 0) return false;
    const text = value
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > 0;
}

function verseRepairIsCoveredByKept(
    v: number,
    cluster: VerseRepairCell[],
    keep: Set<string>
): boolean {
    for (const c of cluster) if (keep.has(c.id) && c.verses.includes(v)) return true;
    return false;
}

/**
 * Decide which cells in one coverage cluster to keep vs tombstone.
 *   - Every cell with content is KEPT.
 *   - A CONFLICT (two content cells sharing a verse) returns `conflict: true` and tombstones
 *     nothing — the repair never auto-removes translated text.
 *   - Empty cells are kept only to cover verses no content cell covers, preferring the chapter's
 *     dominant structural form; the rest are tombstoned.
 *   - If the kept set does not cover every cluster verse exactly once, bail out (tombstone none).
 */
function classifyVerseCluster(
    cluster: VerseRepairCell[],
    dominantForm: "range" | "single"
): { conflict: boolean; tombstone: string[] } {
    const content = cluster.filter((c) => c.content);

    const seenVerse = new Set<number>();
    for (const c of content) {
        for (const v of c.verses) {
            if (seenVerse.has(v)) return { conflict: true, tombstone: [] };
            seenVerse.add(v);
        }
    }

    const keep = new Set<string>(content.map((c) => c.id));
    const coveredByContent = new Set<number>();
    for (const c of content) for (const v of c.verses) coveredByContent.add(v);

    const allVerses = new Set<number>();
    for (const c of cluster) for (const v of c.verses) allVerses.add(v);
    const need = new Set<number>([...allVerses].filter((v) => !coveredByContent.has(v)));

    if (need.size > 0) {
        const empties = cluster.filter((c) => !c.content);
        const formRank = (c: VerseRepairCell) =>
            dominantForm === "single" ? (c.isRange ? 1 : 0) : c.isRange ? 0 : 1;
        empties.sort((a, b) => formRank(a) - formRank(b) || a.verses.length - b.verses.length);
        for (const c of empties) {
            if (keep.has(c.id)) continue;
            const coversNeeded = c.verses.some((v) => need.has(v));
            const overlapsKept = c.verses.some(
                (v) =>
                    !need.has(v) &&
                    (coveredByContent.has(v) || verseRepairIsCoveredByKept(v, cluster, keep))
            );
            if (coversNeeded && !overlapsKept) {
                keep.add(c.id);
                for (const v of c.verses) need.delete(v);
            }
            if (need.size === 0) break;
        }
    }

    // Sanity: kept cells must cover every cluster verse exactly once, else leave it for review.
    const cover = new Map<number, number>();
    for (const c of cluster) {
        if (!keep.has(c.id)) continue;
        for (const v of c.verses) cover.set(v, (cover.get(v) || 0) + 1);
    }
    for (const v of allVerses) {
        if ((cover.get(v) || 0) !== 1) return { conflict: false, tombstone: [] };
    }

    // Defensive: never tombstone a content cell (content is always in `keep` above).
    const tombstone = cluster.filter((c) => !keep.has(c.id) && !c.content).map((c) => c.id);
    return { conflict: false, tombstone };
}

export interface VerseDuplicationRepairPlan {
    tombstoneIds: string[];
    conflicts: Array<{ chapter: number; refs: string[] }>;
}

/**
 * Build a repair plan for a notebook's cells: which empty duplicate cells to soft-delete and
 * which overlapping-content conflicts to leave for manual review. Pure + idempotent (only live
 * cells are considered, so a clean or already-repaired notebook yields an empty plan).
 */
export function planVerseDuplicationRepair(cells: any[]): VerseDuplicationRepairPlan {
    const tombstoneIds: string[] = [];
    const conflicts: Array<{ chapter: number; refs: string[] }> = [];
    if (!Array.isArray(cells) || cells.length === 0) return { tombstoneIds, conflicts };

    // Live text cells with a parseable ref, grouped by chapter.
    const byChapter = new Map<number, VerseRepairCell[]>();
    for (const cell of cells) {
        const md = cell?.metadata;
        if (md?.type !== CodexCellTypes.TEXT) continue;
        if (md?.data?.deleted === true) continue;
        const id = md?.id;
        if (typeof id !== "string" || id.length === 0) continue;
        const ref = md?.data?.globalReferences?.[0];
        if (typeof ref !== "string") continue;
        const parsed = parseVerseRef(ref);
        if (!parsed) continue;
        const verses: number[] = [];
        if (parsed.kind === "range") {
            for (let v = parsed.verseStart; v <= parsed.verseEnd; v++) verses.push(v);
        } else {
            verses.push(parsed.verse);
        }
        if (verses.length === 0) continue;
        const arr = byChapter.get(parsed.chapter) || [];
        arr.push({
            cell,
            id,
            ref,
            verses,
            isRange: parsed.kind === "range",
            content: verseRepairHasContent(cell.value),
        });
        byChapter.set(parsed.chapter, arr);
    }

    for (const [chapter, chCells] of byChapter) {
        // Dominant structural form among CONTENT cells in this chapter.
        let rangeCount = 0;
        let singleCount = 0;
        for (const c of chCells) if (c.content) c.isRange ? rangeCount++ : singleCount++;
        const dominantForm: "range" | "single" = rangeCount > singleCount ? "range" : "single";

        // Connected components by shared verse coverage.
        const verseMap = new Map<number, VerseRepairCell[]>();
        for (const c of chCells)
            for (const v of c.verses) {
                const arr = verseMap.get(v) || [];
                arr.push(c);
                verseMap.set(v, arr);
            }
        const seen = new Set<string>();
        for (const startCell of chCells) {
            if (seen.has(startCell.id)) continue;
            const cluster: VerseRepairCell[] = [];
            const stack = [startCell];
            seen.add(startCell.id);
            while (stack.length) {
                const cur = stack.pop()!;
                cluster.push(cur);
                for (const v of cur.verses)
                    for (const neighbor of verseMap.get(v) || [])
                        if (!seen.has(neighbor.id)) {
                            seen.add(neighbor.id);
                            stack.push(neighbor);
                        }
            }
            if (cluster.length < 2) continue; // no duplication

            const result = classifyVerseCluster(cluster, dominantForm);
            if (result.conflict) {
                conflicts.push({ chapter, refs: cluster.map((c) => c.ref) });
                continue;
            }
            for (const id of result.tombstone) tombstoneIds.push(id);
        }
    }

    return { tombstoneIds, conflicts };
}

/**
 * Plan + apply the repair to a cell array in place. Soft-deletes empty duplicate cells with a
 * MIGRATION edit (row + history preserved so the deletion wins on later merges). Conflicts are
 * left untouched. Idempotent. No-op for known non-Bible importer types (mirrors
 * {@link reorderVerseRangeCells}). Returns how many cells were tombstoned and how many
 * overlapping-content conflicts were left for manual review.
 */
export function applyVerseDuplicationRepair(
    cells: any[],
    options?: { importerType?: string | null }
): { tombstoned: number; conflicts: number } {
    const importerType = options?.importerType;
    if (
        typeof importerType === "string" &&
        importerType.trim() &&
        !isBibleTypeImporter(importerType)
    ) {
        return { tombstoned: 0, conflicts: 0 };
    }

    const plan = planVerseDuplicationRepair(cells);
    if (plan.tombstoneIds.length === 0) {
        return { tombstoned: 0, conflicts: plan.conflicts.length };
    }

    const cellById = new Map<string, any>();
    for (const c of cells) {
        const id = c?.metadata?.id;
        if (typeof id === "string") cellById.set(id, c);
    }

    const timestamp = Date.now();
    let tombstoned = 0;
    for (const id of plan.tombstoneIds) {
        const cell = cellById.get(id);
        if (!cell) continue;
        const md = cell.metadata || (cell.metadata = {});
        if (md.data?.deleted === true) continue;
        if (verseRepairHasContent(cell.value)) continue; // never delete content
        md.data = md.data || {};
        md.data.deleted = true;
        md.edits = md.edits || [];
        md.edits.push({
            editMap: EditMapUtils.dataDeleted(),
            value: true,
            timestamp,
            type: EditType.MIGRATION,
            author: "system",
            validatedBy: [],
        });
        tombstoned++;
    }

    return { tombstoned, conflicts: plan.conflicts.length };
}
