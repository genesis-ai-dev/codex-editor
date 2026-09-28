/**
 * Matches cells of an old Biblica notebook against a freshly re-imported one.
 *
 * Biblica notebooks imported before the June 2026 importer rewrite turned every
 * non-verse IDML paragraph into a cell and used a simpler HTML shape. The current
 * importer keeps only `intro/*` note paragraphs and emits per-segment character
 * style markup, so cell ids, cell counts and cell boundaries all differ between
 * the two imports. Translations therefore have to be re-attached by identity
 * derived from the IDML itself rather than by cell id.
 *
 * Two signals are used, in order of trust:
 *  1. Paragraph identity — story + paragraph index + line-break segment index,
 *     all recorded by both importers in `metadata.data.relationships`.
 *  2. Source text — the English paragraph text, used when paragraph identity is
 *     missing or shifted, and only when it is unique on both sides.
 */

import type { CustomNotebookCellData } from "../../../../types";
import { CodexCellTypes } from "../../../../types/enums";

/** How an old cell was tied to a cell in the re-imported notebook. */
export type BiblicaMatchStrategy = "paragraphIdentity" | "sourceText";

/** Why an old cell carrying a translation could not be re-attached. */
export type BiblicaUnmatchedReason =
    /** The paragraph is not a cell in the new import (e.g. `head:*` scripture headings). */
    | "noCounterpartInNewImport"
    /** Several new cells are equally plausible, so picking one could corrupt the text. */
    | "ambiguous"
    /** The new cell it matched was already claimed by an earlier old cell. */
    | "newCellAlreadyClaimed";

export interface BiblicaCellMatch {
    oldCellId: string;
    newCellId: string;
    strategy: BiblicaMatchStrategy;
}

export interface BiblicaUnmatchedCell {
    oldCellId: string;
    reason: BiblicaUnmatchedReason;
    appliedParagraphStyle: string;
    /** Normalized English text of the old source cell. */
    sourceText: string;
    /** The translation that has no home in the new import (verbatim HTML). */
    translation: string;
}

export interface BiblicaMatchResult {
    matches: BiblicaCellMatch[];
    /** Old cells that hold a translation but could not be matched. */
    unmatchedTranslated: BiblicaUnmatchedCell[];
    /** Ids of new content cells that no old translation maps onto. */
    newCellsWithoutTranslation: string[];
}

export interface BiblicaMatchInput {
    oldSourceCells: CustomNotebookCellData[];
    oldCodexCells: CustomNotebookCellData[];
    newSourceCells: CustomNotebookCellData[];
}

interface CellRelationships {
    parentStory?: string;
    paragraphOrder?: number;
    segmentIndex?: number;
}

const getCellId = (cell: CustomNotebookCellData): string | null => {
    const id = cell.metadata?.id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
};

const getRelationships = (cell: CustomNotebookCellData): CellRelationships =>
    ((cell.metadata?.data as { relationships?: CellRelationships } | undefined)?.relationships ??
        {}) as CellRelationships;

export const getAppliedParagraphStyle = (cell: CustomNotebookCellData): string => {
    const style = (cell.metadata as { appliedParagraphStyle?: string } | undefined)
        ?.appliedParagraphStyle;
    return typeof style === "string" ? style : "";
};

/**
 * Story + paragraph + line-break segment. Returns null when the cell predates the
 * relationship metadata, in which case only source-text matching can apply.
 */
export const getParagraphIdentityKey = (cell: CustomNotebookCellData): string | null => {
    const { parentStory, paragraphOrder, segmentIndex } = getRelationships(cell);
    if (!parentStory || typeof paragraphOrder !== "number") {
        return null;
    }
    return `${parentStory}|${paragraphOrder}|${segmentIndex ?? 0}`;
};

/** Plain text of an HTML fragment, collapsed for comparison. */
export const normalizeCellText = (html: string | undefined): string =>
    (html ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // Soft hyphens are InDesign typesetting hints and are not part of the text.
        .replace(/\u00ad/g, "")
        .replace(/\s+/g, " ")
        .trim();

/**
 * Milestones are generated per import and hold chapter labels rather than
 * translatable paragraph text, so they are never migrated.
 */
export const isTranslatableCell = (cell: CustomNotebookCellData): boolean =>
    cell.metadata?.type !== CodexCellTypes.MILESTONE;

/** True when a codex cell holds actual translated text rather than an empty shell. */
export const hasTranslation = (cell: CustomNotebookCellData | undefined): boolean =>
    !!cell && normalizeCellText(cell.value).length > 0;

const addToBucket = <T>(map: Map<string, T[]>, key: string, item: T): void => {
    const bucket = map.get(key);
    if (bucket) {
        bucket.push(item);
    } else {
        map.set(key, [item]);
    }
};

/**
 * Re-attach the old notebook's translated cells to the re-imported notebook.
 *
 * Only old cells that actually carry a translation are matched; empty ones need
 * nothing carried over. A new cell is never claimed twice, so a translation can
 * never be duplicated into two cells.
 */
export function matchBiblicaCells(input: BiblicaMatchInput): BiblicaMatchResult {
    const { oldSourceCells, oldCodexCells, newSourceCells } = input;

    const oldCodexById = new Map<string, CustomNotebookCellData>();
    for (const cell of oldCodexCells) {
        const id = getCellId(cell);
        if (id) oldCodexById.set(id, cell);
    }

    const newContentCells = newSourceCells.filter(
        (cell) => isTranslatableCell(cell) && getCellId(cell)
    );

    const newByIdentity = new Map<string, CustomNotebookCellData[]>();
    const newByText = new Map<string, CustomNotebookCellData[]>();
    for (const cell of newContentCells) {
        const identity = getParagraphIdentityKey(cell);
        if (identity) addToBucket(newByIdentity, identity, cell);
        const text = normalizeCellText(cell.value);
        if (text) addToBucket(newByText, text, cell);
    }

    const matches: BiblicaCellMatch[] = [];
    const unmatchedTranslated: BiblicaUnmatchedCell[] = [];
    const claimedNewCellIds = new Set<string>();

    for (const oldSourceCell of oldSourceCells) {
        if (!isTranslatableCell(oldSourceCell)) continue;
        const oldCellId = getCellId(oldSourceCell);
        if (!oldCellId) continue;

        const oldTranslationCell = oldCodexById.get(oldCellId);
        if (!hasTranslation(oldTranslationCell)) continue;

        const oldText = normalizeCellText(oldSourceCell.value);
        const recordUnmatched = (reason: BiblicaUnmatchedReason): void => {
            unmatchedTranslated.push({
                oldCellId,
                reason,
                appliedParagraphStyle: getAppliedParagraphStyle(oldSourceCell),
                sourceText: oldText,
                translation: oldTranslationCell?.value ?? "",
            });
        };

        const identity = getParagraphIdentityKey(oldSourceCell);
        const identityCandidates = identity ? (newByIdentity.get(identity) ?? []) : [];
        const textCandidates = oldText ? (newByText.get(oldText) ?? []) : [];

        const { candidates, strategy } = identityCandidates.length > 0
            ? { candidates: identityCandidates, strategy: "paragraphIdentity" as const }
            : { candidates: textCandidates, strategy: "sourceText" as const };

        if (candidates.length === 0) {
            recordUnmatched("noCounterpartInNewImport");
            continue;
        }

        const unclaimed = candidates.filter((cell) => !claimedNewCellIds.has(getCellId(cell)!));
        if (unclaimed.length === 0) {
            recordUnmatched("newCellAlreadyClaimed");
            continue;
        }

        // A paragraph that the new importer split into several cells yields more than
        // one candidate. Prefer the one whose source text is identical, which pins the
        // translation to the right slice; without that evidence, refuse to guess.
        const chosen = unclaimed.length === 1
            ? unclaimed[0]
            : unclaimed.find((cell) => normalizeCellText(cell.value) === oldText);

        if (!chosen) {
            recordUnmatched("ambiguous");
            continue;
        }

        const newCellId = getCellId(chosen)!;
        claimedNewCellIds.add(newCellId);
        matches.push({ oldCellId, newCellId, strategy });
    }

    const newCellsWithoutTranslation = newContentCells
        .map((cell) => getCellId(cell)!)
        .filter((id) => !claimedNewCellIds.has(id));

    return { matches, unmatchedTranslated, newCellsWithoutTranslation };
}
