import { useEffect, useRef } from "react";
import { Dispatch, SetStateAction } from "react";
import { QuillCellContent, SpellCheckResponse, MilestoneIndex } from "../../../../../types";
import { CustomNotebookMetadata } from "../../../../../types";

type AudioAvailability = "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";

/**
 * Derives the audio availability state for a cell based on its attachments and selection.
 *
 * Uses `audioAvailability` as the primary field, then falls back to the legacy
 * `isMissing` boolean.  When neither field is set the attachment is treated as
 * "unknown" (not counted as available) so that the filesystem-based check from
 * the provider can supply the definitive answer.  This prevents a sync merge
 * that drops the legacy `isMissing` flag from incorrectly showing a play icon.
 */
type AttAvailability = "available-local" | "available-pointer" | "missing" | "deletedOnly" | "unknown";

const classifyAttachment = (att: any): AttAvailability => {
    if (att.isDeleted) return "deletedOnly";
    if (att.audioAvailability) return att.audioAvailability as AttAvailability;
    if (att.isMissing === true) return "missing";
    if (att.isMissing === false) return "available-local";
    return "unknown";
};

const deriveAudioAvailability = (unit: QuillCellContent): AudioAvailability => {
    const atts = (unit?.attachments || {}) as Record<string, any>;
    let hasAvailableLocal = false;
    let hasAvailablePointer = false;
    let hasMissing = false;
    let hasDeleted = false;
    let hasUnknown = false;

    for (const key of Object.keys(atts)) {
        const att = atts[key];
        if (att?.type !== "audio") continue;

        const state = classifyAttachment(att);
        switch (state) {
            case "available-local":
                hasAvailableLocal = true;
                break;
            case "available-pointer":
                hasAvailablePointer = true;
                break;
            case "missing":
                hasMissing = true;
                break;
            case "deletedOnly":
                hasDeleted = true;
                break;
            default:
                hasUnknown = true;
                break;
        }
    }

    if (hasAvailableLocal) return "available-local";
    if (hasAvailablePointer) return "available-pointer";
    if (hasMissing) return "missing";
    if (hasUnknown) return "none";
    if (hasDeleted) return "deletedOnly";
    return "none";
};

interface UseVSCodeMessageHandlerProps {
    setContent: (
        content: QuillCellContent[],
        isSourceText: boolean,
        sourceCellMap: { [k: string]: { content: string; versions: string[]; }; }
    ) => void;
    setSpellCheckResponse: Dispatch<SetStateAction<SpellCheckResponse | null>>;
    jumpToCell: (cellId: string) => void;
    jumpToCellWithPosition?: (cellId: string, milestoneIndex: number, subsectionIndex: number) => void;
    updateCell: (data: { cellId: string; newContent: string; progress: number; }) => void;
    autocompleteChapterComplete: () => void;
    updateTextDirection: (direction: "ltr" | "rtl") => void;
    updateNotebookMetadata: (metadata: CustomNotebookMetadata) => void;
    updateVideoUrl: (url: string) => void;
    setAlertColorCodes: Dispatch<SetStateAction<{ [cellId: string]: number; }>>;
    recheckAlertCodes: () => void;

    // New handlers for provider-centric state management
    updateAutocompletionState?: (state: {
        isProcessing: boolean;
        totalCells: number;
        completedCells: number;
        currentCellId?: string;
        cellsToProcess: string[];
        progress: number;
    }) => void;

    updateSingleCellTranslationState?: (state: {
        isProcessing: boolean;
        cellId?: string;
        progress: number;
    }) => void;

    updateSingleCellQueueState?: (state: {
        isProcessing: boolean;
        totalCells: number;
        completedCells: number;
        currentCellId?: string;
        cellsToProcess: string[];
        progress: number;
    }) => void;

    // Handler for explicit completion messages
    updateCellTranslationCompletion?: (cellId: string, success: boolean, cancelled?: boolean, error?: string) => void;

    // Keep old handlers for backward compatibility
    autocompleteChapterStart?: (data: { cellIds: string[]; totalCells: number; }) => void;
    processingCell?: (data: { cellId: string; index: number; totalCells: number; }) => void;
    cellCompleted?: (data: { cellId: string; index: number; totalCells: number; }) => void;
    cellError?: (data: { cellId: string; index: number; totalCells: number; }) => void;
    singleCellTranslationStarted?: (data: { cellId: string; }) => void;
    singleCellTranslationProgress?: (data: { progress: number; }) => void;
    singleCellTranslationCompleted?: () => void;
    singleCellTranslationFailed?: () => void;
    setChapterNumber?: (chapterNumber: number) => void;
    setAudioAttachments: Dispatch<SetStateAction<{ [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; }>>;

    // A/B testing handlers
    showABTestVariants?: (data: { variants: string[]; cellId: string; testId: string; }) => void;

    // Milestone-based pagination handlers
    setContentPaginated?: (
        milestoneIndex: MilestoneIndex,
        cells: QuillCellContent[],
        currentMilestoneIndex: number,
        currentSubsectionIndex: number,
        isSourceText: boolean,
        sourceCellMap: { [k: string]: { content: string; versions: string[]; }; }
    ) => void;
    handleCellPage?: (
        milestoneIndex: number,
        subsectionIndex: number,
        cells: QuillCellContent[],
        sourceCellMap: { [k: string]: { content: string; versions: string[]; }; },
        allCellsInMilestone?: QuillCellContent[]
    ) => void;
}

export const useVSCodeMessageHandler = ({
    setContent,
    setSpellCheckResponse,
    jumpToCell,
    jumpToCellWithPosition,
    updateCell,
    autocompleteChapterComplete,
    updateTextDirection,
    updateNotebookMetadata,
    updateVideoUrl,
    setAlertColorCodes,
    recheckAlertCodes,

    // New handlers
    updateAutocompletionState,
    updateSingleCellTranslationState,
    updateSingleCellQueueState,
    updateCellTranslationCompletion,

    // Legacy handlers
    autocompleteChapterStart,
    processingCell,
    cellCompleted,
    cellError,
    singleCellTranslationStarted,
    singleCellTranslationProgress,
    singleCellTranslationCompleted,
    singleCellTranslationFailed,
    setChapterNumber,
    setAudioAttachments,
    showABTestVariants,
    setContentPaginated,
    handleCellPage,
}: UseVSCodeMessageHandlerProps) => {
    // Track the last applied provider revision so we can ignore out-of-order / stale payloads.
    const lastAppliedRevRef = useRef<number>(0);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case "providerSendsInitialContent":
                    setContent(message.content, message.isSourceText, message.sourceCellMap);
                    try {
                        const units = (message.content || []) as QuillCellContent[];
                        const availability: Record<string, AudioAvailability> = {};
                        for (const unit of units) {
                            const cellId = unit?.cellMarkers?.[0];
                            if (!cellId) continue;
                            availability[cellId] = deriveAudioAvailability(unit);
                        }
                        setAudioAttachments(availability);
                    } catch { /* ignore */ }
                    break;

                case "providerUpdatesNotebookMetadataForWebview":
                    // Hydrate auto-download flag and notify metadata update in one place
                    try {
                        if (typeof (message?.content?.autoDownloadAudioOnOpen) === "boolean") {
                            (window as any).__autoDownloadAudioOnOpen = !!message.content.autoDownloadAudioOnOpen;
                            (window as any).__autoDownloadAudioOnOpenInitialized = true;
                        }
                    } catch { console.error("Error deriving audio attachment availability"); }
                    try { updateNotebookMetadata(message.content); } catch { console.error("Error updating notebook metadata"); }
                    break;
                case "providerSendsSpellCheckResponse":
                    setSpellCheckResponse(message.content);
                    break;
                case "jumpToSection":
                    // Use pre-computed position from extension if available
                    if (
                        jumpToCellWithPosition &&
                        typeof message.milestoneIndex === "number" &&
                        typeof message.subsectionIndex === "number"
                    ) {
                        jumpToCellWithPosition(message.content, message.milestoneIndex, message.subsectionIndex);
                    } else {
                        // Fallback to old behavior
                        jumpToCell(message.content);
                    }
                    break;
                case "updateCell":
                    updateCell(message.data);
                    break;
                case "autocompleteChapterComplete":
                    autocompleteChapterComplete();
                    break;
                case "updateTextDirection":
                    updateTextDirection(message.direction);
                    break;
                case "updateNotebookMetadata":
                    updateNotebookMetadata(message.content);
                    break;
                case "updateVideoUrlInWebview":
                    updateVideoUrl(message.content);
                    break;
                case "providerSendsgetAlertCodeResponse":
                    setAlertColorCodes(message.content);
                    break;
                case "wordAdded":
                    recheckAlertCodes();
                    break;
                case "providerAutocompletionState":
                    if (updateAutocompletionState) {
                        updateAutocompletionState(message.state);
                    }
                    break;
                case "providerSingleCellTranslationState":
                    if (updateSingleCellTranslationState) {
                        updateSingleCellTranslationState(message.state);
                    }
                    break;
                case "providerSingleCellQueueState":
                    if (updateSingleCellQueueState) {
                        updateSingleCellQueueState(message.state);
                    }
                    break;
                case "cellTranslationCompleted":
                    if (updateCellTranslationCompletion) {
                        updateCellTranslationCompletion(message.cellId, message.success, message.cancelled, message.error);
                    }
                    break;
                case "autocompleteChapterStart":
                    if (autocompleteChapterStart) {
                        autocompleteChapterStart(message);
                    }
                    break;
                case "processingCell":
                    if (processingCell) {
                        processingCell(message);
                    }
                    break;
                case "cellCompleted":
                    if (cellCompleted) {
                        cellCompleted(message);
                    }
                    break;
                case "cellError":
                    if (cellError) {
                        cellError(message);
                    }
                    break;
                case "singleCellTranslationStarted":
                    if (singleCellTranslationStarted) {
                        singleCellTranslationStarted(message);
                    }
                    break;
                case "singleCellTranslationProgress":
                    if (singleCellTranslationProgress) {
                        singleCellTranslationProgress(message);
                    }
                    break;
                case "singleCellTranslationCompleted":
                    if (singleCellTranslationCompleted) {
                        singleCellTranslationCompleted();
                    }
                    break;
                case "singleCellTranslationFailed":
                    if (singleCellTranslationFailed) {
                        singleCellTranslationFailed();
                    }
                    break;
                case "providerUpdatesCell":
                    if (message.content?.cellId && message.content?.progress) {
                        if (updateCell) {
                            updateCell({
                                cellId: message.content.cellId,
                                newContent: message.content.text || "",
                                progress: message.content.progress,
                            });
                        }
                    }
                    break;
                case "setChapterNumber":
                    if (setChapterNumber) {
                        setChapterNumber(message.content);
                    }
                    break;
                case "providerSendsAudioAttachments":
                    if (message.attachments) {
                        // Merge incrementally and only trigger state update if a value actually changes
                        setAudioAttachments((prev) => {
                            try {
                                const incoming = message.attachments as Record<string, string>;
                                let changed = false;
                                const next = { ...(prev || {}) } as Record<string, string>;
                                for (const key of Object.keys(incoming)) {
                                    const val = incoming[key as keyof typeof incoming];
                                    if (next[key] !== val) {
                                        next[key] = val as any;
                                        changed = true;
                                    }
                                }
                                return changed ? (next as any) : prev;
                            } catch {
                                return message.attachments;
                            }
                        });
                    }
                    break;
                case "providerSendsABTestVariants":
                    if (showABTestVariants) {
                        showABTestVariants(message.content);
                    }
                    break;

                case "providerSendsInitialContentPaginated":
                    if (typeof (message as any).rev === "number") {
                        const msgRev = (message as any).rev as number;
                        if (msgRev < lastAppliedRevRef.current) {
                            break; // ignore stale payload
                        }
                        lastAppliedRevRef.current = msgRev;
                    }
                    if (setContentPaginated) {
                        setContentPaginated(
                            message.milestoneIndex,
                            message.cells,
                            message.currentMilestoneIndex,
                            message.currentSubsectionIndex,
                            message.isSourceText,
                            message.sourceCellMap
                        );
                    }
                    try {
                        const units = (message.cells || []) as QuillCellContent[];
                        const availability: Record<string, AudioAvailability> = {};
                        for (const unit of units) {
                            const cellId = unit?.cellMarkers?.[0];
                            if (!cellId) continue;
                            availability[cellId] = deriveAudioAvailability(unit);
                        }
                        setAudioAttachments(availability);
                    } catch { /* ignore */ }
                    break;

                case "providerSendsCellPage":
                    if (typeof (message as any).rev === "number") {
                        const msgRev = (message as any).rev as number;
                        if (msgRev < lastAppliedRevRef.current) {
                            break; // ignore stale payload
                        }
                        lastAppliedRevRef.current = msgRev;
                    }
                    if (handleCellPage) {
                        handleCellPage(
                            message.milestoneIndex,
                            message.subsectionIndex,
                            message.cells,
                            message.sourceCellMap,
                            message.allCellsInMilestone
                        );
                    }
                    try {
                        const units = (message.cells || []) as QuillCellContent[];
                        const availability: Record<string, AudioAvailability> = {};
                        for (const unit of units) {
                            const cellId = unit?.cellMarkers?.[0];
                            if (!cellId) continue;
                            availability[cellId] = deriveAudioAvailability(unit);
                        }
                        setAudioAttachments((prev) => ({ ...prev, ...availability }));
                    } catch { /* ignore */ }
                    break;
            }
        };

        window.addEventListener("message", handler);

        return () => {
            window.removeEventListener("message", handler);
        };
    }, [
        setContent,
        setSpellCheckResponse,
        jumpToCell,
        jumpToCellWithPosition,
        updateCell,
        autocompleteChapterComplete,
        updateTextDirection,
        updateNotebookMetadata,
        updateVideoUrl,
        setAlertColorCodes,
        recheckAlertCodes,
        updateAutocompletionState,
        updateSingleCellTranslationState,
        updateSingleCellQueueState,
        updateCellTranslationCompletion,
        autocompleteChapterStart,
        processingCell,
        cellCompleted,
        cellError,
        singleCellTranslationStarted,
        singleCellTranslationProgress,
        singleCellTranslationCompleted,
        singleCellTranslationFailed,
        setChapterNumber,
        setAudioAttachments,
        showABTestVariants,
        setContentPaginated,
        handleCellPage,
    ]);
};
