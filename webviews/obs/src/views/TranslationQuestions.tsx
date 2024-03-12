import React, { useEffect, useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import { vscode } from "../utilities/vscode";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

const TranslationQuestions = () => {
    const { translationQuestions } = useTranslationQuestions();
    const [currentIndex, setCurrentIndex] = useState(0);

    const currentTranslationQuestion = translationQuestions?.[currentIndex];
    return (
        <div className="grid grid-cols-8">
            {/* Left Button */}
            <VSCodeButton
                onClick={() =>
                    setCurrentIndex((prev) => (prev === 0 ? prev : prev - 1))
                }
                appearance="icon"
                aria-label="left"
            >
                <span className="arrow-button codicon codicon-chevron-left"></span>
                Previous
            </VSCodeButton>
            {/* Middle Element */}
            <div id="note-container prose" className="col-span-6">
                <div>{currentTranslationQuestion?.Question}</div>
                <div>{currentTranslationQuestion?.Response}</div>
            </div>
            {/* Right Button */}
            <VSCodeButton
                onClick={() =>
                    setCurrentIndex((prev) =>
                        prev === translationQuestions.length - 1
                            ? prev
                            : prev + 1,
                    )
                }
                appearance="icon"
                aria-label="right"
            >
                <span className="arrow-button codicon codicon-chevron-right"></span>
                Next
            </VSCodeButton>
        </div>
    );
};

const useTranslationQuestions = () => {
    const [translationQuestions, setTranslationQuestions] = useState<
        Record<string, string>[]
    >([]);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case "update-tq":
                    setTranslationQuestions(
                        event.data.payload.translationQuestions ?? [],
                    );
                    console.log(
                        "event.data.payload.translationQuestions: ",
                        event.data.payload,
                    );
                    break;
            }
        });
    }, []);

    return { translationQuestions };
};

renderToPage(<TranslationQuestions />);
