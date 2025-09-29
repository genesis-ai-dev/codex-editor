import { useEffect } from "react";
import { Dispatch, SetStateAction } from "react";
import { QuillCellContent, SpellCheckResponse } from "../../../../../types";
import { CustomNotebookMetadata } from "../../../../../types";

interface UseVSCodeMessageHandlerProps {
    setContent: (
        content: QuillCellContent[],
        isSourceText: boolean,
        sourceCellMap: { [k: string]: { content: string; versions: string[]; }; }
    ) => void;
    setSpellCheckResponse: Dispatch<SetStateAction<SpellCheckResponse | null>>;
    jumpToCell: (cellId: string) => void;
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
    setAudioAttachments: (attachments: { [cellId: string]: "available" | "missing" | "deletedOnly" | "none"; }) => void;

    // A/B testing handlers
    showABTestVariants?: (data: { variants: string[]; cellId: string; testId: string; }) => void;
}

export const useVSCodeMessageHandler = ({
    setContent,
    setSpellCheckResponse,
    jumpToCell,
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
}: UseVSCodeMessageHandlerProps) => {
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case "providerSendsInitialContent":
                    setContent(message.content, message.isSourceText, message.sourceCellMap);

                    // Derive audio attachment availability from QuillCellContent.attachments
                    try {
                        const units = (message.content || []) as QuillCellContent[];
                        const availability: { [cellId: string]: "available" | "missing" | "deletedOnly" | "none"; } = {};
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
                case "providerSendsSpellCheckResponse":
                    setSpellCheckResponse(message.content);
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
                case "providerUpdatesNotebookMetadataForWebview":
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
                        setAudioAttachments(message.attachments);
                    }
                    break;
                case "providerSendsABTestVariants":
                    if (showABTestVariants) {
                        showABTestVariants(message.content);
                    }
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
    ]);
};
