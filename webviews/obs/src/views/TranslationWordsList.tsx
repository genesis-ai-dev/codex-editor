import { useEffect, useMemo, useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import { vscode } from "../utilities/vscode";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import TranslationWordRenderer from "../components/TranslationWordRenderer";

const TranslationWordsList = () => {
    const { translationWordsList } = useTranslationWordsList();

    const [currentIndex, setCurrentIndex] = useState(0);

    const currentTranslationWord = useMemo(
        () =>
            translationWordsList?.[currentIndex]
                ? {
                      path:
                          translationWordsList?.[currentIndex]?.twUriPath ??
                          null,
                  }
                : null,
        [currentIndex, translationWordsList],
    );

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
            <div id="note-container" className="col-span-6">
                <TranslationWordRenderer
                    translationWord={currentTranslationWord}
                />
            </div>
            {/* Right Button */}
            <VSCodeButton
                onClick={() =>
                    setCurrentIndex((prev) =>
                        prev === translationWordsList.length - 1
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

const useTranslationWordsList = () => {
    const [translationWordsList, setTranslationWordsList] = useState<
        Record<string, string>[]
    >([]);
    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case "update-twl":
                    setTranslationWordsList(event.data.payload.wordsList ?? []);
                    break;
            }
        });
    }, []);

    const existingTranslationWordsList = useMemo(() => {
        return translationWordsList.filter((word) => word.existsOnDisk);
    }, [translationWordsList]);

    return { translationWordsList: existingTranslationWordsList };
};

renderToPage(<TranslationWordsList />);
