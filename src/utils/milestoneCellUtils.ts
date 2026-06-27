import { randomUUID } from "crypto";
import { CodexCellTypes, EditType } from "../../types/enums";
import { EditMapUtils } from "./editMapUtils";
import bibleData from "../../webviews/codex-webviews/src/assets/bible-books-lookup.json";

/**
 * Extracts the chapter number from a structured cellId of the form
 * "BOOK CHAPTER:VERSE" (e.g. `"GEN 1:1"` → `"1"`). Returns null when the
 * pattern does not match — including for UUID-shaped cell IDs.
 */
export function extractChapterFromCellId(cellId: string): string | null {
    if (!cellId) return null;
    // Pattern: <prefix><space><digits>:<digits>(:|end)
    // Captures the first digit run as the chapter; tolerates a trailing
    // verse-suffix (verse-range disambiguation).
    const match = cellId.match(/\s+(\d+):(\d+)(?::|$)/);
    if (match) {
        return match[1];
    }
    return null;
}

/**
 * Resolves a chapter label for a milestone cell using a cascade of metadata
 * locations, falling back to the milestone ordinal as the last resort. The
 * priority is intentional: explicit Biblica/USFM chapter metadata wins over
 * legacy `data.chapter`, which wins over a parsed `cellId`.
 */
export function extractChapterFromCell(cell: any, milestoneOrdinal: number): string {
    if (cell?.metadata?.chapterNumber !== undefined && cell.metadata.chapterNumber !== null) {
        return String(cell.metadata.chapterNumber);
    }
    if (cell?.metadata?.chapter !== undefined && cell.metadata.chapter !== null) {
        return String(cell.metadata.chapter);
    }
    if (cell?.metadata?.data?.chapter !== undefined && cell.metadata.data.chapter !== null) {
        return String(cell.metadata.data.chapter);
    }
    const cellId = cell?.metadata?.id || cell?.id;
    if (cellId) {
        const chapterFromId = extractChapterFromCellId(cellId);
        if (chapterFromId) {
            return chapterFromId;
        }
    }
    return milestoneOrdinal.toString();
}

/**
 * Pulls a book abbreviation out of `globalReferences`, then `cellMarkers`,
 * then a parsed `cellId`. Returns null when no abbreviation can be found —
 * e.g. when the cell is identified by a UUID rather than a scripture-shaped
 * id.
 */
export function extractBookNameFromCell(cell: any): string | null {
    const globalRefs = cell?.data?.globalReferences || cell?.metadata?.data?.globalReferences;
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        const firstRef = globalRefs[0];
        const bookMatch = firstRef.match(/^([^\s]+)/);
        if (bookMatch) {
            return bookMatch[1];
        }
    }
    if (cell?.cellMarkers?.[0]) {
        const firstMarker = cell.cellMarkers[0].split(":")[0];
        if (firstMarker) {
            const parts = firstMarker.split(" ");
            return parts[0];
        }
    }
    const cellId = cell?.metadata?.id || cell?.id;
    if (cellId) {
        const bookMatch = cellId.match(/^([^\s]+)/);
        if (bookMatch) {
            return bookMatch[1];
        }
    }
    return null;
}

/**
 * Translates a USFM/Biblica book abbreviation to its localized display name
 * (e.g. `"GEN"` → `"Genesis"`). Falls through to the abbreviation when no
 * mapping is found so the caller never gets back an empty string.
 */
export function getLocalizedBookName(bookAbbr: string): string {
    if (!bookAbbr) return bookAbbr;
    const bookInfo = (bibleData as any[]).find((book) => book.abbr === bookAbbr);
    return bookInfo?.name || bookAbbr;
}

/**
 * Computes the human-readable label for a milestone cell. Prefers
 * `"BookName ChapterNumber"` (e.g. `"Isaiah 1"`); falls back to the bare
 * chapter number for non-Bible content.
 */
export function buildMilestoneLabelFromCell(cell: any, milestoneOrdinal: number): string {
    const chapterNumber = extractChapterFromCell(cell, milestoneOrdinal);
    const bookAbbr = extractBookNameFromCell(cell);
    const bookName = bookAbbr ? getLocalizedBookName(bookAbbr) : null;
    return bookName ? `${bookName} ${chapterNumber}` : chapterNumber;
}

export interface MilestoneCellPayloadOptions {
    /**
     * Cell to derive book/chapter context from. The payload's display value
     * comes from this cell's metadata (chapter number, book abbreviation).
     */
    referenceCell: any;
    /**
     * 1-indexed milestone ordinal. Used as the final fallback when no
     * structured chapter metadata is available.
     */
    milestoneOrdinal: number;
    /**
     * Author name recorded against the initial edit entry. Callers pass
     * the current user; `migrationUtils` resolves this through `getAuthApi`,
     * the in-editor handler resolves it through `document.refreshAuthor`.
     */
    author: string;
    /** Stable UUID for the milestone cell. Generated on demand if omitted. */
    uuid?: string;
    /**
     * Optional override for the milestone label. When omitted we derive it
     * from `referenceCell` via `buildMilestoneLabelFromCell`. Callers that
     * already have a custom label (e.g. promoting a named subdivision) can
     * pass it directly.
     */
    valueOverride?: string;
    /**
     * Optional `metadata.data` blob to attach to the milestone cell at
     * creation time. Used by structural edits to persist subdivisions and
     * subdivision-name overrides on a brand-new milestone in one shot,
     * skipping a follow-up `updateCellData` call.
     */
    initialData?: Record<string, unknown>;
}

/**
 * Builds the on-disk shape of a milestone notebook cell. Centralising this
 * keeps importers, migrations, and in-editor structural edits aligned on
 * label format, edit-history shape, and the surrounding kind/languageId
 * envelope.
 *
 * The returned object matches `CustomNotebookCellData` shape for milestone
 * cells: `kind: 2` (NotebookCellKind.Code), `languageId: "html"`, an
 * INITIAL_IMPORT-style edit entry timestamped slightly in the past so it
 * sorts before any subsequent USER_EDIT.
 */
export function buildMilestoneCellPayload(opts: MilestoneCellPayloadOptions): any {
    const {
        referenceCell,
        milestoneOrdinal,
        author,
        uuid,
        valueOverride,
        initialData,
    } = opts;
    const cellUuid = uuid || randomUUID();
    const milestoneValue =
        valueOverride && valueOverride.length > 0
            ? valueOverride
            : buildMilestoneLabelFromCell(referenceCell, milestoneOrdinal);
    const currentTimestamp = Date.now();
    // Initial-import edit anchors the milestone label in the merge log so the
    // value survives 3-way merges even when the cell has not yet been touched
    // by a USER_EDIT. Stamping the timestamp slightly in the past keeps it
    // ordered before any subsequent user edit recorded in the same tick.
    const initialEdit = {
        editMap: EditMapUtils.value(),
        value: milestoneValue,
        timestamp: currentTimestamp - 1000,
        type: EditType.INITIAL_IMPORT,
        author,
        validatedBy: [],
    };

    const metadata: any = {
        id: cellUuid,
        type: CodexCellTypes.MILESTONE,
        edits: [initialEdit],
    };
    if (initialData && Object.keys(initialData).length > 0) {
        metadata.data = { ...initialData };
    }

    return {
        kind: 2, // vscode.NotebookCellKind.Code
        languageId: "html",
        value: milestoneValue,
        metadata,
    };
}
