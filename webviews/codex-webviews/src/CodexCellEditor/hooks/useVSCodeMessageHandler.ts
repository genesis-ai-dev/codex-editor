import { useEffect } from "react";
import { CellContent, CustomNotebookData } from "../../../../../types";

export const useVSCodeMessageHandler = (
    setContent: React.Dispatch<React.SetStateAction<CellContent[]>>,
    setSpellCheckResponse: React.Dispatch<
        React.SetStateAction<CustomNotebookData>
    >,
) => {
    useEffect(() => {
        const messageListener = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case "update":
                    try {
                        const jsonContent = JSON.parse(message.content);

                        setContent(jsonContent);
                    } catch (error) {
                        console.error("Failed to parse JSON content:", error);
                    }
                    break;
                case "spellCheckResponse":
                    try {
                        setSpellCheckResponse(message.content);
                    } catch (error) {
                        console.error("Failed to parse JSON content:", error);
                    }
                    break;
            }
        };

        window.addEventListener("message", messageListener);
        return () => window.removeEventListener("message", messageListener);
    }, [setContent, setSpellCheckResponse]);
};
