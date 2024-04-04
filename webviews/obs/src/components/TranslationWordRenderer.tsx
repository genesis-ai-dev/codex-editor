import React, { useEffect, useState } from "react";
import { MessageType } from "../types";
import { vscode } from "../utilities/vscode";
import { markdownToHTML } from "../utilities/markdownToHTML";

const TranslationWordRenderer = ({
    translationWord,
}: {
    translationWord: { path: string } | null;
}) => {
    const { content, loading } = useTranslationWordContent(translationWord);

    if (content === null && !loading) {
        return (
            <div className="prose-base">
                <i>
                    <h2>Select a translation word to view its content.</h2>
                </i>
            </div>
        );
    }

    if (loading) {
        return <div>Loading...</div>;
    }
    return (
        <div
            dangerouslySetInnerHTML={{ __html: content ?? "" }}
            className="prose-lg"
        />
    );
};

const useTranslationWordContent = (
    translationWord: { path: string } | null,
) => {
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case "update-tw-content":
                    setContent(
                        event.data.payload.content !== null
                            ? markdownToHTML(event.data.payload.content)
                            : null,
                    );
                    setLoading(false);
                    break;
            }
        });
    }, []);

    useEffect(() => {
        if (!translationWord) {
            return;
        }

        vscode.postMessage({
            type: MessageType.GET_TW_CONTENT,
            payload: { translationWord },
        });
        setLoading(true);
    }, [translationWord]);

    return { content, loading };
};

export default TranslationWordRenderer;
