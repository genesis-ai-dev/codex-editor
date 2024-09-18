import { vscode } from "./utilities/vscode";
import { useEffect, useState } from "react";
import { Dictionary } from "codex-types";
import { numberOfEntries } from "./utils";
import "./App.css";

function App() {
    const [entries, setEntries] = useState(0);
    const [frequentWords, setFrequentWords] = useState<string[]>([]);

    useEffect(() => {
        const handleReceiveMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "sendData": {
                    const dictionary: Dictionary = message.data;
                    setEntries(numberOfEntries(dictionary));
                    break;
                }
                case "updateEntryCount": {
                    setEntries(message.count);
                    console.log("Entry count updated to:", message.count);
                    break;
                }
                case "updateFrequentWords": {
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
        vscode.postMessage({ command: "refreshWordFrequency" });
    };

    const addFrequentWordsToDictionary = () => {
        vscode.postMessage({
            command: "addFrequentWordsToDictionary",
            words: frequentWords,
        });
        // Clear the frequent words list immediately in the UI
        setFrequentWords([]);
    };

    return (
        <div className="app-container">
            <h1 className="title">Dictionary Summary - ryder</h1>
            <div className="card">
                <p className="entry-count">Entries in dictionary: {entries}</p>
                <button
                    className="show-table-btn"
                    onClick={() =>
                        vscode.postMessage({ command: "showDictionaryTable" })
                    }
                >
                    Show Dictionary Table
                </button>
                <button className="refresh-btn" onClick={refreshWordFrequency}>
                    Refresh Word Frequency
                </button>
                <h2>Frequent Words Not in Dictionary</h2>
                <ul>
                    {frequentWords.map((word, index) => (
                        <li key={index}>{word}</li>
                    ))}
                </ul>
                <button
                    className="add-words-btn"
                    onClick={addFrequentWordsToDictionary}
                >
                    Add Frequent Words to Dictionary
                </button>
            </div>
        </div>
    );
}

export default App;
