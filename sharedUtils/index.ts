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

    // Find the latest edit that matches the current cell content
    const latestEditThatMatchesCellValue = editHistory
        .slice()
        .reverse()
        .find((edit) => EditMapUtils.isValue(edit.editMap) && edit.value === cell.cellContent);

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
    audioState: AudioAvailabilityState
): boolean => {
    return !hasTextContent(htmlContent);
};
