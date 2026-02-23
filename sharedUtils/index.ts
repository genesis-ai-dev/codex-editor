import { QuillCellContent, ValidationEntry } from "../types";
import { EditMapUtils } from "../src/utils/editMapUtils";

export const removeHtmlTags = (content: string) => {
    if (!content) return '';

    try {
        // Use proper DOM parsing for better HTML handling when available
        if (typeof document !== 'undefined') {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;

            // Remove footnote elements completely
            const footnotes = tempDiv.querySelectorAll('sup.footnote-marker, sup[data-footnote], sup');
            footnotes.forEach(footnote => footnote.remove());

            // Remove spell check markup
            const spellCheckElements = tempDiv.querySelectorAll('.spell-check-error, .spell-check-suggestion, [class*="spell-check"]');
            spellCheckElements.forEach(el => el.remove());

            // Replace paragraph end tags with spaces to preserve word boundaries
            tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, ' ');

            // Get clean text content
            const textContent = tempDiv.textContent || tempDiv.innerText || '';

            return textContent
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();
        }
    } catch (error) {
        console.warn('DOM parsing failed in removeHtmlTags, using fallback:', error);
    }

    // Fallback for server-side or when DOM parsing fails
    return content
        .replace(/<sup[^>]*class=["']footnote-marker["'][^>]*>[\s\S]*?<\/sup>/gi, '') // Remove footnotes
        .replace(/<sup[^>]*data-footnote[^>]*>[\s\S]*?<\/sup>/gi, '') // Remove data-footnote sups
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '') // Remove any remaining sup tags
        .replace(/<\/p>/gi, ' ') // Replace paragraph end tags with spaces to preserve word boundaries
        .replace(/<[^>]*>/g, "") // Remove HTML tags
        .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, "") // Remove common HTML entities
        .replace(/&nbsp; ?/g, " ") // Remove &nbsp;
        .replace(/&#\d+;/g, "") // Remove numeric HTML entities
        .replace(/&[a-zA-Z]+;/g, "") // Remove other named HTML entities
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim();
};

export const getCellValueData = (cell: QuillCellContent) => {
    // Ensure editHistory exists and is an array
    const editHistory = cell.editHistory || [];

    // Find the latest edit that matches the current cell content (strict match).
    // Falls back to the latest value edit if the strict match fails, which can happen
    // when the merge step during save subtly normalizes the stored value.
    const reversed = editHistory.slice().reverse();
    const latestEditThatMatchesCellValue =
        reversed.find((edit) => EditMapUtils.isValue(edit.editMap) && edit.value === cell.cellContent) ??
        reversed.find((edit) => EditMapUtils.isValue(edit.editMap) && !edit.preview);

    // Get audio validation from attachments instead of edits
    let audioValidatedBy: ValidationEntry[] = [];
    if (cell.attachments) {
        const audioAttachments = Object.entries(cell.attachments).filter(([, attachment]: [string, any]) =>
            attachment && attachment.type === "audio" && !attachment.isDeleted
        );

        if (audioAttachments.length > 0) {
            // Prefer the explicitly selected audio attachment when available
            let currentAudioAttachmentEntry: [string, any] | null = null;

            const selectedAudioId = cell.metadata?.selectedAudioId;
            if (selectedAudioId) {
                currentAudioAttachmentEntry =
                    audioAttachments.find(([attachmentId]) => attachmentId === selectedAudioId) ?? null;
            }

            // Fall back to the most recently updated audio attachment
            if (!currentAudioAttachmentEntry) {
                currentAudioAttachmentEntry = audioAttachments
                    .sort(([, a]: [string, any], [, b]: [string, any]) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
            }

            if (currentAudioAttachmentEntry) {
                const [, currentAudioAttachment] = currentAudioAttachmentEntry;
                if (currentAudioAttachment?.validatedBy) {
                    audioValidatedBy = currentAudioAttachment.validatedBy;
                }
            }
        }
    }

    return {
        cellId: cell.cellMarkers?.[0] || "",
        cellContent: cell.cellContent || "",
        cellType: cell.cellType,
        validatedBy: latestEditThatMatchesCellValue?.validatedBy || [],
        audioValidatedBy: audioValidatedBy,
        editType: latestEditThatMatchesCellValue?.type || "user-edit",
        author: latestEditThatMatchesCellValue?.author || "",
        timestamp: latestEditThatMatchesCellValue?.timestamp || Date.now(),
        cellLabel: cell.cellLabel || "",
    };
};

// Validation enablement helpers (shared between webview and tests)
export type AudioAvailabilityState = boolean | "available" | "deletedOnly" | "none" | undefined;

export const hasTextContent = (htmlContent: string | undefined | null): boolean => {
    if (!htmlContent) return false;
    const text = removeHtmlTags(htmlContent);
    if (text.length === 0) {
        return false;
    }

    // eslint-disable-next-line no-misleading-character-class
    const normalized = text.replace(/[\u200B\u200C\u200D\u200E\u200F\u202F\u2060\uFEFF]/g, "");
    const trimmed = normalized.trim().toLowerCase();

    if (trimmed.length === 0) {
        return false;
    }

    if (trimmed === "click to translate" || trimmed === "no text") {
        return false;
    }

    return true;
};

export const hasAudioAvailable = (state: AudioAvailabilityState): boolean => {
    if (typeof state === "boolean") return state;
    return state === "available";
};

export const shouldDisableValidation = (
    htmlContent: string | undefined | null,
): boolean => {
    return !hasTextContent(htmlContent);
};

// Progress helpers shared across provider and webviews
export const cellHasAudioUsingAttachments = (
    attachments: Record<string, any> | undefined,
    selectedAudioId?: string
): boolean => {
    const atts = attachments;
    if (!atts || Object.keys(atts).length === 0) return false;

    if (selectedAudioId && atts[selectedAudioId]) {
        const att = atts[selectedAudioId];
        return att && att.type === "audio" && !att.isDeleted && att.isMissing !== true;
    }

    return Object.values(atts).some(
        (att: any) => att && att.type === "audio" && !att.isDeleted && att.isMissing !== true
    );
};

// Count only active (non-deleted) validation entries. Requires isDeleted === false so legacy
// or malformed entries (e.g. missing isDeleted) are not counted as validated.
export function countActiveValidations(validatedBy: ValidationEntry[] | undefined): number {
    return (validatedBy?.filter((v) => v && typeof v === "object" && v.isDeleted === false).length ?? 0);
}

export const computeValidationStats = (
    cellValueData: Array<{
        validatedBy?: ValidationEntry[];
        audioValidatedBy?: ValidationEntry[];
        cellContent?: string;
    }>,
    minimumValidationsRequired: number,
    minimumAudioValidationsRequired: number
): {
    validatedCells: number;
    audioValidatedCells: number;
    fullyValidatedCells: number;
} => {
    // Only count a cell as text-validated if it has actual text content. Empty/placeholder
    // cells should not inflate validation % when no validations are meaningfully applied.
    const validatedCells = cellValueData.filter((cell) => {
        if (!hasTextContent(cell.cellContent)) return false;
        return countActiveValidations(cell.validatedBy) >= minimumValidationsRequired;
    }).length;

    const audioValidatedCells = cellValueData.filter((cell) => {
        return countActiveValidations(cell.audioValidatedBy) >= minimumAudioValidationsRequired;
    }).length;

    const fullyValidatedCells = cellValueData.filter((cell) => {
        const textOk =
            hasTextContent(cell.cellContent) &&
            countActiveValidations(cell.validatedBy) >= minimumValidationsRequired;
        const audioOk = countActiveValidations(cell.audioValidatedBy) >= minimumAudioValidationsRequired;
        return textOk && audioOk;
    }).length;

    return { validatedCells, audioValidatedCells, fullyValidatedCells };
};

/**
 * Cell-like shape used for progress exclusion checks (notebook cell or serialized cell).
 */
export type CellForProgressCheck = {
    metadata?: {
        id?: string;
        type?: string;
        parentId?: string;
        data?: { merged?: boolean; parentId?: string; type?: string; };
    };
};

/**
 * Returns true if the cell should be excluded from progress (not counted in totalCells).
 * Paratext and child cells (e.g. type "text" with parentId) must not count toward progress.
 */
export function shouldExcludeCellFromProgress(cell: CellForProgressCheck): boolean {
    const md = cell.metadata;
    const cellData = md?.data as { merged?: boolean; parentId?: string; type?: string; } | undefined;
    const cellId = (md?.id ?? "").toString();

    if (md?.type === "milestone" || cellData?.merged) {
        return true;
    }
    const isParatext =
        md?.type === "paratext" ||
        cellData?.type === "paratext" ||
        cellId.includes("paratext-");
    if (isParatext) {
        return true;
    }
    if (!cellId || cellId.trim() === "") {
        return true;
    }
    const parentId = md?.parentId ?? cellData?.parentId;
    if (parentId != null && parentId !== "") {
        return true;
    }
    return false;
}

/**
 * Returns true if the cell should be excluded from progress when already in QuillCellContent form.
 * Use this to filter lists before computing validation stats so paratext/child never count.
 */
export function shouldExcludeQuillCellFromProgress(cell: QuillCellContent): boolean {
    const cellId = (cell.cellMarkers?.[0] ?? "").toString();
    if (!cellId || cellId.trim() === "") {
        return true;
    }
    if (cell.merged) {
        return true;
    }
    const typeLower = (cell.cellType ?? "").toString().toLowerCase();
    if (typeLower === "milestone") {
        return true;
    }
    if (typeLower === "paratext" || cellId.includes("paratext-")) {
        return true;
    }
    const parentId = cell.metadata?.parentId ?? cell.data?.parentId;
    if (parentId != null && parentId !== "") {
        return true;
    }
    return false;
}

export const computeProgressPercents = (
    totalCells: number,
    cellsWithValues: number,
    cellsWithAudioValues: number,
    validatedCells: number,
    audioValidatedCells: number,
    fullyValidatedCells: number
): {
    percentTranslationsCompleted: number;
    percentAudioTranslationsCompleted: number;
    percentFullyValidatedTranslations: number;
    percentAudioValidatedTranslations: number;
    percentTextValidatedTranslations: number;
} => {
    const safeDiv = (num: number) => (totalCells > 0 ? (num / totalCells) * 100 : 0);
    return {
        percentTranslationsCompleted: safeDiv(cellsWithValues),
        percentAudioTranslationsCompleted: safeDiv(cellsWithAudioValues),
        percentFullyValidatedTranslations: safeDiv(fullyValidatedCells),
        percentAudioValidatedTranslations: safeDiv(audioValidatedCells),
        percentTextValidatedTranslations: safeDiv(validatedCells),
    };
};

// Re-export corpus utilities
export * from "./corpusUtils";
