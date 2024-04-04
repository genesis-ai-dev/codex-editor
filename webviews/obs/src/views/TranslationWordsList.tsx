import { useEffect, useMemo, useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import { vscode } from "../utilities/vscode";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import TranslationWordRenderer from "../components/TranslationWordRenderer";

const TranslationWordsList = () => {
    const { translationWordsList, diskTwl } = useTranslationWordsList();

    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (diskTwl.length > 0) {
            setCurrentIndex(0);
        }
    }, [diskTwl, diskTwl.length]);

    const currentTranslationWord = useMemo(
        () =>
            diskTwl?.[currentIndex]
                ? {
                      path: diskTwl?.[currentIndex]?.twUriPath ?? null,
                  }
                : null,
        [currentIndex, diskTwl],
    );

    if (translationWordsList.length === 0) {
        return (
            <div className="prose-base">
                <h1>
                    <i>No Translation Words Found</i>
                </h1>
            </div>
        );
    }

    if (diskTwl.length === 0) {
        return (
            <div className="prose-base">
                <h3>
                    Found translation Words but they do not have corresponding
                    descriptions on disk.
                </h3>
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            <div className="flex justify-between">
                <VSCodeButton
                    onClick={() =>
                        setCurrentIndex((prev) =>
                            prev === 0 ? prev : prev - 1,
                        )
                    }
                    appearance="secondary"
                    aria-label="left"
                    className=""
                    disabled={currentIndex === 0}
                >
                    <i className="codicon codicon-chevron-left"></i>
                </VSCodeButton>

                <span className="w-fit">
                    {currentIndex + 1} / {diskTwl.length}
                </span>
                <VSCodeButton
                    onClick={() =>
                        setCurrentIndex((prev) =>
                            prev === diskTwl.length - 1 ? prev : prev + 1,
                        )
                    }
                    appearance="secondary"
                    aria-label="right"
                    className=""
                    disabled={currentIndex === diskTwl.length - 1}
                >
                    <i className="codicon codicon-chevron-right"></i>
                </VSCodeButton>
            </div>
            <div id="note-container" className="col-span-6">
                <TranslationWordRenderer
                    translationWord={currentTranslationWord}
                />
            </div>
            {/* Right Button */}
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
                    console.log(
                        "update-twl ---> IN WEBVIEW",
                        event.data.payload.wordsList,
                    );
                    setTranslationWordsList(event.data.payload.wordsList ?? []);
                    break;
            }
        });
    }, []);

    console.log("translationWordsList", translationWordsList);

    const existingTranslationWordsList = useMemo(() => {
        return translationWordsList.filter((word) => word.existsOnDisk);
    }, [translationWordsList]);

    return { diskTwl: existingTranslationWordsList, translationWordsList };
};

renderToPage(<TranslationWordsList />);
