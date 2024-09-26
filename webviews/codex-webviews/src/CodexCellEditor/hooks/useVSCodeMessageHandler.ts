import { useEffect } from "react";
import {
    QuillCellContent,
    CodexNotebookAsJSONData,
    EditorReceiveMessages,
} from "../../../../../types";

export const useVSCodeMessageHandler = ({
    setContent,
    setSpellCheckResponse,
    jumpToCell,
    updateCell,
    autocompleteChapterComplete,
    updateTextDirection,
}: {
    setContent: React.Dispatch<React.SetStateAction<QuillCellContent[]>>;
    setSpellCheckResponse: React.Dispatch<React.SetStateAction<CodexNotebookAsJSONData>>;
    jumpToCell: (cellId: string) => void;
    updateCell: (data: { cellId: string; newContent: string; progress: number }) => void;
    autocompleteChapterComplete: () => void;
    updateTextDirection: (direction: "ltr" | "rtl") => void;
}) => {
    useEffect(() => {
        const messageListener = (event: MessageEvent<EditorReceiveMessages>) => {
            const message = event.data;
            switch (message.type) {
                case "jumpToSection": {
                    jumpToCell(message.content);
                    break;
                }
                case "providerSendsInitialContent":
                    setContent(message.content);
                    break;
                case "providerSendsSpellCheckResponse":
                    setSpellCheckResponse(message.content);
                    break;
                case "providerUpdatesCell":
                    // updateCell(message.content);
                    break;
                case "providerCompletesChapterAutocompletion":
                    autocompleteChapterComplete();
                    break;
                case "providerUpdatesTextDirection":
                    updateTextDirection(message.textDirection);
                    break;
            }
        };

        window.addEventListener("message", messageListener);
        return () => window.removeEventListener("message", messageListener);
    }, [
        setContent,
        setSpellCheckResponse,
        jumpToCell,
        updateCell,
        autocompleteChapterComplete,
        updateTextDirection,
    ]);
};
