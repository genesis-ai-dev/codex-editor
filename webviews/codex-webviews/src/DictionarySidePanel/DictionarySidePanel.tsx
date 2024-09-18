import { vscode } from "./utilities/vscode";
import { useEffect, useState } from "react";
import { Dictionary } from "codex-types";
import { numberOfEntries } from "./utils";
import "./App.css";
import { DictionarySummaryPostMessages } from "../../../../types";
import {
    VSCodeButton,
    VSCodeBadge,
    VSCodePanelView,
    VSCodePanels,
    VSCodePanelTab,
} from "@vscode/webview-ui-toolkit/react";

function App() {
    const [entries, setEntries] = useState<number>(0);
    const [wordsInProjectDraft, setWordsInProjectDraft] = useState<number>(0);
    const [frequentWords, setFrequentWords] = useState<string[]>([]);

    useEffect(() => {
        const handleReceiveMessage = (
            event: MessageEvent<DictionarySummaryPostMessages>
        ) => {
            const message = event.data;
            switch (message.command) {
                case "providerSendsDataToWebview": {
                    const dictionary: Dictionary = message.data;
                    setEntries(numberOfEntries(dictionary));
                    break;
                }
                case "providerSendsUpdatedWordFrequenciesToWebview": {
                    setWordsInProjectDraft(
                        Object.keys(message.wordFrequencies).length
                    );
                    console.log(
                        "Entry count updated to:",
                        Object.keys(message.wordFrequencies).length
                    );
                    break;
                }
                case "providerSendsFrequentWordsToWebview": {
                    setFrequentWords(message.words);
                    break;
                }
            }
        };
        window.addEventListener("message", handleReceiveMessage);
        return () => {
            window.removeEventListener("message", handleReceiveMessage);
        };
    }, []);

    const refreshWordFrequency = () => {
        vscode.postMessage({
            command: "refreshWordFrequency",
        } as DictionarySummaryPostMessages);
    };

    const addFrequentWordsToDictionary = () => {
        vscode.postMessage({
            command: "addFrequentWordsToDictionary",
            words: frequentWords,
        } as DictionarySummaryPostMessages);
        setFrequentWords([]);
    };

    return (
        <div className="vscode-panel p-4 max-w-sm mx-auto">
            <VSCodePanels>
                <VSCodePanelTab id="dictionary-summary">
                    Dictionary Summary
                </VSCodePanelTab>
                <VSCodePanelView id="dictionary-summary">
                    <div className="flex flex-col items-center justify-center gap-2">
                        <p className="text-2xl font-bold mb-4">
                            Entries in dictionary: {entries}
                            <br />
                            Words not in dictionary:{" "}
                            {wordsInProjectDraft - entries}
                        </p>
                        <div className="space-y-2">
                            <VSCodeButton
                                className="w-full"
                                appearance="secondary"
                                onClick={() =>
                                    vscode.postMessage({
                                        command: "showDictionaryTable",
                                    })
                                }
                            >
                                <span className="codicon codicon-list-flat"></span>
                                Show Dictionary Table
                            </VSCodeButton>
                        </div>
                    </div>
                </VSCodePanelView>
                <VSCodePanelTab id="word-frequency">
                    Word Frequency
                </VSCodePanelTab>
                <VSCodePanelView>
                    <div className="space-y-2 mb-4 flex flex-col items-center justify-center gap-2">
                        <VSCodeButton
                            className="w-full"
                            appearance="secondary"
                            onClick={refreshWordFrequency}
                        >
                            <span className="codicon codicon-refresh"></span>
                            Refresh Word Frequency
                        </VSCodeButton>
                        <VSCodeButton
                            className="w-full"
                            appearance="secondary"
                            onClick={addFrequentWordsToDictionary}
                        >
                            <span className="codicon codicon-add"></span>
                            Add Frequent Words
                        </VSCodeButton>
                        <div className="flex flex-wrap gap-2 mt-4">
                            {frequentWords.map((word, index) => (
                                <VSCodeBadge key={index}>{word}</VSCodeBadge>
                            ))}
                        </div>
                    </div>
                </VSCodePanelView>
            </VSCodePanels>
        </div>
    );
}

export default App;
