import * as vscode from "vscode";
import { CodexContentSerializer } from "@/serializer";
import { EditMapUtils } from "@/utils/editMapUtils";
import { EditType, CodexCellTypes } from "../../../types/enums";
import { parseVerseRef } from "../../utils/verseRefUtils";

/**
 * Result of scanning a single notebook file for parent cells whose merged-child
 * content was stripped from `value`/`mergedChildIds`/`cellLabel` by the
 * save-time resolver's tie-break bug.
 *
 * `changed` reflects whether at least one parent needs (or, after a non-dryRun
 * run, just had) edits appended.
 */
export interface MergedChildRecoveryResult {
    changed: boolean;
    parentsRecovered: number;
    perParent: Array<{
        parentId: string;
        appendedChildIds: string[];
        oldCellLabel?: string;
        newCellLabel?: string;
        mergedChildIdsChanged: boolean;
    }>;
}

interface RecoveryOptions {
    /** When true, do not write the file; just compute the report. Defaults to false. */
    dryRun?: boolean;
}

/**
 * Minimal cell shape this module touches. The deserialized notebook is loosely
 * typed (`any`), but everything the recovery reads/writes lives under
 * `metadata` / `value`, so we narrow with this local interface for safety.
 */
interface RecoverableCell {
    value?: string;
    metadata?: {
        id?: string;
        type?: string;
        parentId?: string;
        cellLabel?: string;
        data?: {
            deleted?: boolean;
            mergedChildIds?: string[];
            globalReferences?: string[];
        };
        edits?: Array<{
            editMap: readonly string[];
            value: unknown;
            timestamp: number;
            type: EditType;
            author: string;
            validatedBy: unknown[];
        }>;
    };
}

/**
 * Normalize a cell value for substring comparison: strip HTML attributes, then
 * tags, then collapse whitespace. Used so that a paraphrased middle child
 * (whose exact HTML may differ from the parent's text but whose words are
 * present) is not double-appended on recovery.
 *
 * Attributes are removed before tags because some attribute values in the
 * codex format carry literal un-escaped HTML (notably `data-footnote="<p>…</p>"`
 * on `<sup class="footnote-marker">`). Without stripping the attribute first,
 * the `<[^>]*>` tag regex stops at the first `>` inside the attribute value,
 * and the rest of the attribute leaks into the normalized text — which then
 * looks completely different between the parent (which stores `data-footnote`
 * with `&lt;`/`&gt;` escapes) and its soft-deleted child (which stores it raw),
 * even when the verse content is identical.
 */
export function normalizeForSubstring(value: string | undefined): string {
    if (!value) return "";
    return value
        .replace(/\s[a-zA-Z][\w:-]*\s*=\s*("[^"]*"|'[^']*')/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Floor on the number of word tokens a child must have before we trust the
 * fuzzy-bigram presence check. Below this, we fall back to "treat as missing"
 * because short token sequences can hit any overlap threshold by chance
 * against a long parent.
 */
export const MIN_FUZZY_TOKENS = 8;

/**
 * Minimum fraction of a child's bigrams that must be found in the parent for
 * `isChildPresentInParent` to consider the child already present. Calibrated
 * against real codex data: a verse that has been lightly edited in the parent
 * (inserted word, digit-vs-spelled number) lands near 0.7-0.95; a genuinely
 * missing verse sits near 0.
 */
export const FUZZY_BIGRAM_THRESHOLD = 0.6;

/**
 * Lowercase + Unicode-aware word tokenizer. Punctuation and whitespace become
 * separators; accents and non-Latin scripts are preserved (we don't know what
 * language the cells contain). Used by the fuzzy presence check.
 */
export function tokenize(normalized: string): string[] {
    return normalized
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * Build a multiset of consecutive token pairs (bigrams) keyed by "a\u0000b".
 * Multiset (not set) so that repeated phrases in the parent count toward
 * matching repeated phrases in the child rather than collapsing to one.
 */
function bigramMultiset(tokens: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = 0; i + 1 < tokens.length; i++) {
        const key = `${tokens[i]}\u0000${tokens[i + 1]}`;
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

/**
 * Tolerant "is the child already in the parent?" check used by the recovery.
 * Two-stage:
 *   1. Strict substring on the normalized values (fast path; matches the
 *      original behaviour for bit-identical content).
 *   2. Token-bigram overlap: of the child's bigrams, how many appear in the
 *      parent? If at least `threshold` (default `FUZZY_BIGRAM_THRESHOLD`),
 *      the child is treated as present.
 *
 * Children with fewer than `minTokens` (default `MIN_FUZZY_TOKENS`) tokens
 * never reach the fuzzy stage — for short verses the safe default is to
 * re-append (false positives = visible duplication; false negatives =
 * silent data loss, which is worse).
 */
export function isChildPresentInParent(
    normalizedParent: string,
    normalizedChild: string,
    options: { minTokens?: number; threshold?: number; } = {}
): boolean {
    if (normalizedParent.includes(normalizedChild)) return true;
    const childTokens = tokenize(normalizedChild);
    const minTokens = options.minTokens ?? MIN_FUZZY_TOKENS;
    if (childTokens.length < minTokens) return false;
    const childBigrams = bigramMultiset(childTokens);
    if (childBigrams.size === 0) return false;
    const parentBigrams = bigramMultiset(tokenize(normalizedParent));
    let matched = 0;
    let total = 0;
    for (const [bg, count] of childBigrams) {
        total += count;
        matched += Math.min(count, parentBigrams.get(bg) ?? 0);
    }
    const threshold = options.threshold ?? FUZZY_BIGRAM_THRESHOLD;
    return total > 0 && matched / total >= threshold;
}

/**
 * Find every parent cell that has at least one soft-deleted child whose
 * content has gone missing from the parent's current value, and compute the
 * target value / mergedChildIds / cellLabel for each such parent.
 *
 * This is the pure detection step shared by `detectMissingMergedChildren`
 * (which only reports) and `recoverMergedChildrenForFile` (which also writes).
 */
function planRecovery(cells: RecoverableCell[]): Array<{
    parentIndex: number;
    parent: RecoverableCell;
    missingChildren: RecoverableCell[];
    appendedChildIds: string[];
    desiredValue: string;
    desiredMergedChildIds: string[];
    mergedChildIdsChanged: boolean;
    oldCellLabel?: string;
    desiredCellLabel?: string;
    cellLabelChanged: boolean;
}> {
    const childrenByParent = new Map<string, Array<{ cell: RecoverableCell; index: number; }>>();
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const parentId = cell?.metadata?.parentId;
        if (typeof parentId !== "string" || parentId.length === 0) continue;
        const list = childrenByParent.get(parentId) || [];
        list.push({ cell, index: i });
        childrenByParent.set(parentId, list);
    }

    const plans: ReturnType<typeof planRecovery> = [];

    for (let i = 0; i < cells.length; i++) {
        const parent = cells[i];
        const parentMd = parent?.metadata;
        const parentId = parentMd?.id;
        if (typeof parentId !== "string" || parentId.length === 0) continue;
        // Skip non-content cells; only verse cells get merged-child recovery.
        const parentType = parentMd?.type;
        if (
            parentType === CodexCellTypes.MILESTONE ||
            parentType === CodexCellTypes.PARATEXT ||
            parentType === CodexCellTypes.STYLE
        ) {
            continue;
        }
        if (parentMd?.data?.deleted === true) continue;

        const children = childrenByParent.get(parentId);
        if (!children || children.length === 0) continue;

        // Sort children by document order so appended content reads in
        // verse order (matches the original migration's append order).
        const sortedChildren = children.slice().sort((a, b) => a.index - b.index);
        const softDeletedChildren = sortedChildren.filter(
            (c) => c.cell.metadata?.data?.deleted === true
        );
        if (softDeletedChildren.length === 0) continue;

        const parentValue = parent.value || "";
        const normalizedParent = normalizeForSubstring(parentValue);

        const missing: RecoverableCell[] = [];
        for (const child of softDeletedChildren) {
            const childValue = child.cell.value || "";
            if (childValue.length === 0) continue;
            const normalizedChild = normalizeForSubstring(childValue);
            if (normalizedChild.length === 0) continue;
            if (!isChildPresentInParent(normalizedParent, normalizedChild)) {
                missing.push(child.cell);
            }
        }

        const appendedChildIds = missing
            .map((c) => c.metadata?.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0);

        const existingMergedIds: string[] = Array.isArray(parentMd?.data?.mergedChildIds)
            ? parentMd!.data!.mergedChildIds!.slice()
            : [];

        // mergedChildIds should be the union of (existing tracked ids) and
        // (every soft-deleted child of this parent), preserving existing order
        // first then new ones in document order.
        const desiredMergedChildIds = existingMergedIds.slice();
        for (const child of softDeletedChildren) {
            const cid = child.cell.metadata?.id;
            if (typeof cid !== "string" || cid.length === 0) continue;
            if (!desiredMergedChildIds.includes(cid)) {
                desiredMergedChildIds.push(cid);
            }
        }
        const mergedChildIdsChanged =
            desiredMergedChildIds.length !== existingMergedIds.length ||
            desiredMergedChildIds.some((id, idx) => existingMergedIds[idx] !== id);

        // A parent is "affected" only when at least one soft-deleted child's
        // content is missing from parent.value. mergedChildIds and cellLabel
        // updates ride along on already-affected parents; we never write the
        // file just to fix tracking or label when content is intact.
        if (missing.length === 0) continue;

        const oldCellLabel = parentMd?.cellLabel;
        const ref = parentMd?.data?.globalReferences?.[0];
        const parsed = typeof ref === "string" ? parseVerseRef(ref) : null;
        const desiredCellLabel =
            parsed && parsed.kind === "range" ? parsed.cellLabel : undefined;
        const cellLabelChanged =
            typeof desiredCellLabel === "string" && desiredCellLabel !== oldCellLabel;

        const desiredValue = parentValue + missing.map((c) => c.value || "").join("");

        plans.push({
            parentIndex: i,
            parent,
            missingChildren: missing,
            appendedChildIds,
            desiredValue,
            desiredMergedChildIds,
            mergedChildIdsChanged,
            oldCellLabel,
            desiredCellLabel,
            cellLabelChanged,
        });
    }

    return plans;
}

/**
 * Pure detection helper: report which parents in this notebook lost merged-
 * child content (and/or tracking / label) without mutating anything.
 */
export function detectMissingMergedChildren(
    cells: RecoverableCell[]
): MergedChildRecoveryResult {
    const plans = planRecovery(cells);
    return {
        changed: plans.length > 0,
        parentsRecovered: plans.length,
        perParent: plans.map((p) => ({
            parentId: p.parent.metadata!.id!,
            appendedChildIds: p.appendedChildIds,
            oldCellLabel: p.oldCellLabel,
            newCellLabel: p.desiredCellLabel,
            mergedChildIdsChanged: p.mergedChildIdsChanged,
        })),
    };
}

/**
 * Read a `.codex` / `.source` file, recover parent cells whose merged-child
 * content was dropped, and write the file back when `dryRun` is false.
 *
 * Recovery shape per affected parent (only fields that changed get an edit):
 *   - value           edit at baseTs
 *   - mergedChildIds  edit at baseTs + 1
 *   - cellLabel       edit at baseTs + 2
 * where `baseTs = Date.now() + index * 100` so timestamps are unique within
 * the file. Unique timestamps are the whole point: the still-unfixed
 * `resolveMetadataConflictsUsingEditHistory` tie-break only mis-picks among
 * same-timestamp edits, so giving the recovery edit a fresh `Date.now()`
 * guarantees the resolver picks it next save.
 */
export async function recoverMergedChildrenForFile(
    uri: vscode.Uri,
    options: RecoveryOptions = {}
): Promise<MergedChildRecoveryResult> {
    const dryRun = options.dryRun === true;
    const serializer = new CodexContentSerializer();
    const fileContent = await vscode.workspace.fs.readFile(uri);
    const notebookData = (await serializer.deserializeNotebook(
        fileContent,
        new vscode.CancellationTokenSource().token
    )) as { cells?: RecoverableCell[];[key: string]: unknown; };

    const cells: RecoverableCell[] = notebookData.cells || [];
    if (cells.length === 0) {
        return { changed: false, parentsRecovered: 0, perParent: [] };
    }

    const plans = planRecovery(cells);
    const report: MergedChildRecoveryResult = {
        changed: plans.length > 0,
        parentsRecovered: plans.length,
        perParent: plans.map((p) => ({
            parentId: p.parent.metadata!.id!,
            appendedChildIds: p.appendedChildIds,
            oldCellLabel: p.oldCellLabel,
            newCellLabel: p.desiredCellLabel,
            mergedChildIdsChanged: p.mergedChildIdsChanged,
        })),
    };

    if (dryRun || plans.length === 0) {
        return report;
    }

    const now = Date.now();
    for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const baseTs = now + i * 100;
        const parent = plan.parent;
        const parentMd = parent.metadata || (parent.metadata = {});
        const parentData = parentMd.data || (parentMd.data = {});
        const parentEdits = parentMd.edits || (parentMd.edits = []);

        if (plan.missingChildren.length > 0) {
            parent.value = plan.desiredValue;
            parentEdits.push({
                editMap: EditMapUtils.value(),
                value: plan.desiredValue,
                timestamp: baseTs,
                type: EditType.MIGRATION,
                author: "system",
                validatedBy: [],
            });
        }

        if (plan.mergedChildIdsChanged) {
            parentData.mergedChildIds = plan.desiredMergedChildIds.slice();
            parentEdits.push({
                editMap: ["metadata", "data", "mergedChildIds"],
                value: plan.desiredMergedChildIds.slice(),
                timestamp: baseTs + 1,
                type: EditType.MIGRATION,
                author: "system",
                validatedBy: [],
            });
        }

        if (plan.cellLabelChanged && typeof plan.desiredCellLabel === "string") {
            parentMd.cellLabel = plan.desiredCellLabel;
            parentEdits.push({
                editMap: EditMapUtils.cellLabel(),
                value: plan.desiredCellLabel,
                timestamp: baseTs + 2,
                type: EditType.MIGRATION,
                author: "system",
                validatedBy: [],
            });
        }
    }

    notebookData.cells = cells;
    const updatedContent = await serializer.serializeNotebook(
        notebookData as unknown as Parameters<CodexContentSerializer["serializeNotebook"]>[0],
        new vscode.CancellationTokenSource().token
    );
    await vscode.workspace.fs.writeFile(uri, updatedContent);

    return report;
}
