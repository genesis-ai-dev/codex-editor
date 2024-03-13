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
                appearance="secondary"
                className="h-fit w-fit col-span-1"
                aria-label="left"
            >
                <i className="codicon codicon-chevron-left"></i>
            </VSCodeButton>
            {/* Middle Element */}
            <div
                id="note-container prose"
                className="col-span-6 w-full space-y-4"
            >
                <div className="font-semibold text-lg">
                    {currentTranslationQuestion?.Question}
                </div>
                <div className="text-base">
                    {currentTranslationQuestion?.Response}
                </div>
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
                appearance="secondary"
                className="h-fit w-fit col-span-1 ml-auto"
                aria-label="right"
            >
                <i className="codicon codicon-chevron-right"></i>
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
