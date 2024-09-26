import { useEffect } from "react";

export const useVSCodeMessageHandler = ({ setFile }: { setFile?: (file: File) => void }) => {
    useEffect(() => {
        const messageListener = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case "fileSelected": {
                    setFile?.(message.fileName);
                    break;
                }
            }
        };

        window.addEventListener("message", messageListener);
        return () => window.removeEventListener("message", messageListener);
    }, [setFile]);
};
