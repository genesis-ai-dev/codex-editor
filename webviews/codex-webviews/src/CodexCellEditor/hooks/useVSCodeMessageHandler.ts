import { useEffect } from "react";
import { Dispatch, SetStateAction } from "react";
import { QuillCellContent, SpellCheckResponse } from "../../../../../types";
import { CustomNotebookMetadata } from "../../../../../types";

interface UseVSCodeMessageHandlerProps {
    setContent: (
        content: QuillCellContent[],
        isSourceText: boolean,
        sourceCellMap: { [k: string]: { content: string; versions: string[] } }
    ) => void;
    setSpellCheckResponse: Dispatch<SetStateAction<SpellCheckResponse | null>>;
    jumpToCell: (cellId: string) => void;
    updateCell: (data: { cellId: string; newContent: string; progress: number }) => void;
    autocompleteChapterComplete: () => void;
    updateTextDirection: (direction: "ltr" | "rtl") => void;
    updateNotebookMetadata: (metadata: CustomNotebookMetadata) => void;
    updateVideoUrl: (url: string) => void;
    setAlertColorCodes: Dispatch<SetStateAction<{ [cellId: string]: number }>>;
    recheckAlertCodes: () => void;
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
}: UseVSCodeMessageHandlerProps) => {
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case "providerSendsInitialContent":
                    console.log("providerSendsInitialContent", { message });
                    setContent(message.content, message.isSourceText, message.sourceCellMap);
                    break;
                case "providerSendsSpellCheckResponse":
                    setSpellCheckResponse(message.content);
                    break;
                case "jumpToSection":
                    // FIXME: decide whether we want to jump to cells or just sections...
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
                case "providerSendsgetAlertCodeResponse":
                    setAlertColorCodes(message.content);
                    break;
                case "wordAdded":
                    recheckAlertCodes();
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
    ]);
};
