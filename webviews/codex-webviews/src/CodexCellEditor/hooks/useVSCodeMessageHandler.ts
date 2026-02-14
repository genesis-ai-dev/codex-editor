import { useEffect, useRef } from "react";
import { Dispatch, SetStateAction } from "react";
import { QuillCellContent, MilestoneIndex } from "../../../../../types";
import { CustomNotebookMetadata } from "../../../../../types";

interface UseVSCodeMessageHandlerProps {
    setContent: (
        content: QuillCellContent[],
        isSourceText: boolean,
        sourceCellMap: { [k: string]: { content: string; versions: string[]; }; }
    ) => void;
    jumpToCell: (cellId: string) => void;
    updateCell: (data: { cellId: string; newContent: string; progress: number; }) => void;
    autocompleteChapterComplete: () => void;
    updateTextDirection: (direction: "ltr" | "rtl") => void;
    updateNotebookMetadata: (metadata: CustomNotebookMetadata) => void;
    updateVideoUrl: (url: string) => void;

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
    jumpToCell,
    updateCell,
    autocompleteChapterComplete,
    updateTextDirection,
    updateNotebookMetadata,
    updateVideoUrl,

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
                    // Bootstrap audio availability from initial content
                    try {
                        const units = (message.content || []) as QuillCellContent[];
                        const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};
                        for (const unit of units) {
                            const cellId = unit?.cellMarkers?.[0];
                            if (!cellId) continue;
                            let hasAvailable = false; let hasMissing = false; let hasDeleted = false;
                            const atts = unit?.attachments || ({} as any);
                            for (const key of Object.keys(atts)) {
                                const att = (atts as any)[key];
                                if (att && att.type === "audio") {
                                    if (att.isDeleted) hasDeleted = true;
                                    else if (att.isMissing) hasMissing = true;
                                    else hasAvailable = true;
                                }
                            }
                            availability[cellId] = hasAvailable ? "available" : hasMissing ? "missing" : hasDeleted ? "deletedOnly" : "none";
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

                    // Derive audio attachment availability from QuillCellContent.attachments
                    try {
                        const units = (message.content || []) as QuillCellContent[];
                        const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};
                        for (const unit of units) {
                            const cellId = unit?.cellMarkers?.[0];
                            if (!cellId) continue;
                            let hasAvailable = false;
                            let hasMissing = false;
                            let hasDeleted = false;
                            const atts = unit?.attachments || {} as any;
                            for (const key of Object.keys(atts)) {
                                const att = (atts as any)[key];
                                if (att && att.type === "audio") {
                                    if (att.isDeleted) hasDeleted = true;
                                    else if (att.isMissing) hasMissing = true;
                                    else hasAvailable = true;
                                }
                            }
                            availability[cellId] = hasAvailable ? "available" : hasMissing ? "missing" : hasDeleted ? "deletedOnly" : "none";
                        }
                        setAudioAttachments(availability);
                    } catch {
                        // Swallow errors deriving attachments
                    }
                    break;
                case "jumpToSection":
                    jumpToCell(message.content);
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
                    // Bootstrap audio availability from initial cells
                    try {
                        const units = (message.cells || []) as QuillCellContent[];
                        const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};
                        for (const unit of units) {
                            const cellId = unit?.cellMarkers?.[0];
                            if (!cellId) continue;
                            let hasAvailable = false; let hasMissing = false; let hasDeleted = false;
                            const atts = unit?.attachments || ({} as any);
                            for (const key of Object.keys(atts)) {
                                const att = (atts as any)[key];
                                if (att && att.type === "audio") {
                                    if (att.isDeleted) hasDeleted = true;
                                    else if (att.isMissing) hasMissing = true;
                                    else hasAvailable = true;
                                }
                            }
                            availability[cellId] = hasAvailable ? "available" : hasMissing ? "missing" : hasDeleted ? "deletedOnly" : "none";
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
                    // Update audio availability for new cells
                    try {
                        const units = (message.cells || []) as QuillCellContent[];
                        const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};
                        for (const unit of units) {
                            const cellId = unit?.cellMarkers?.[0];
                            if (!cellId) continue;
                            let hasAvailable = false; let hasMissing = false; let hasDeleted = false;
                            const atts = unit?.attachments || ({} as any);
                            for (const key of Object.keys(atts)) {
                                const att = (atts as any)[key];
                                if (att && att.type === "audio") {
                                    if (att.isDeleted) hasDeleted = true;
                                    else if (att.isMissing) hasMissing = true;
                                    else hasAvailable = true;
                                }
                            }
                            availability[cellId] = hasAvailable ? "available" : hasMissing ? "missing" : hasDeleted ? "deletedOnly" : "none";
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
        jumpToCell,
        updateCell,
        autocompleteChapterComplete,
        updateTextDirection,
        updateNotebookMetadata,
        updateVideoUrl,
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
