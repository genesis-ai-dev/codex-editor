import React, { useEffect, useState } from "react";
import { MessageType, TranslationWord } from "../types";
import { vscode } from "../utilities/vscode";
import { markdownToHTML } from "../utilities/markdownToHTML";

const TranslationWordRenderer = ({
    translationWord,
}: {
    translationWord: TranslationWord | null;
}) => {
    const { content, loading } = useTranslationWordContent(translationWord);

    if (loading) {
        return <div>Loading...</div>;
    }
    return (
        <div
            dangerouslySetInnerHTML={{ __html: content ?? "" }}
            className="prose prose-xl"
        />
    );
};

const useTranslationWordContent = (translationWord: TranslationWord | null) => {
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case "update-tw-content":
                    setContent(markdownToHTML(event.data.payload.content));
                    setLoading(false);
                    break;
            }
        });
    }, []);

    useEffect(() => {
        vscode.postMessage({
            type: MessageType.GET_TW_CONTENT,
            payload: { translationWord },
        });
        setLoading(true);
    }, [translationWord]);

    return { content, loading };
};

export default TranslationWordRenderer;
