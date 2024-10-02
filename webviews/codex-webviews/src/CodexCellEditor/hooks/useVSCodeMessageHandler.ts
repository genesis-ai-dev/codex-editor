import { useEffect } from "react";
import { Dispatch, SetStateAction } from "react";
import { QuillCellContent, SpellCheckResponse } from "../../../../../types";

interface UseVSCodeMessageHandlerProps {
    setContent: (content: QuillCellContent[], isSourceText: boolean) => void;
    setSpellCheckResponse: Dispatch<SetStateAction<SpellCheckResponse | null>>;
    jumpToCell: (cellId: string) => void;
    updateCell: (data: { cellId: string; newContent: string; progress: number }) => void;
    autocompleteChapterComplete: () => void;
    updateTextDirection: (direction: "ltr" | "rtl") => void;
}

export const useVSCodeMessageHandler = ({
    setContent,
    setSpellCheckResponse,
    jumpToCell,
    updateCell,
    autocompleteChapterComplete,
    updateTextDirection,
}: UseVSCodeMessageHandlerProps) => {
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case "providerSendsInitialContent":
                    console.log("providerSendsInitialContent", { message });
                    setContent(message.content, message.isSourceText);
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
    ]);
};
