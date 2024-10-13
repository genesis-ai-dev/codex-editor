import { useEffect, useState } from "react";
import { vscode } from "../utilities/vscode";

export const useDocument = () => {
    const [document, setDocument] = useState<string | null>(null);
    const [isReadonly, setIsReadonly] = useState<boolean>(false);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case "update":
                    setDocument(event.data.payload.doc);
                    setIsReadonly(event.data.payload.isReadonly);
                    break;
            }
        });
    }, []);

    return { document, isReadonly };
};
