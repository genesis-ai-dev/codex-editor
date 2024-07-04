import { vscode } from "./utilities/vscode";
import { useEffect, useState, useCallback } from "react";
import { Dictionary } from "codex-types";
import { numberOfEntries } from "./utils";
import "./App.css";

// Add these types
type GlosserInfo = {
  status: string;
  num_source_texts: number;
  num_target_texts: number;
  num_known_glosses: number;
};

type GlosserCounts = {
  source_vocab_size: number;
  target_vocab_size: number;
  co_occurrences: number;
  known_glosses: number;
};

function App() {
    const [entries, setEntries] = useState(0);
    const [glosserInfo, setGlosserInfo] = useState<GlosserInfo | null>(null);
    const [glosserCounts, setGlosserCounts] = useState<GlosserCounts | null>(null);

    const requestData = useCallback(() => {
        vscode.postMessage({ command: "updateData" });
        vscode.postMessage({ command: "getGlosserData" });
    }, []);

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
                case "sendGlosserData": {
                    const { glosserInfo, glosserCounts } = message.data;
                    setGlosserInfo(glosserInfo || null);
                    setGlosserCounts(glosserCounts || null);
                    console.log("Glosser info:", glosserInfo);
                    console.log("Glosser counts:", glosserCounts);
                    break;
                }
            }
        };
        window.addEventListener("message", handleReceiveMessage);

        // Initial data request
        requestData();

        // Set up polling
        const pollInterval = setInterval(requestData, 5000); // Poll every 5 seconds

        return () => {
            window.removeEventListener("message", handleReceiveMessage);
            clearInterval(pollInterval);
        };
    }, [requestData]);

    return (
        <div className="app-container">
            <h1 className="title">Dictionary Summary</h1>
            <div className="card">
                <p className="entry-count">Entries in dictionary: {entries}</p>
                <button
                    className="show-table-btn"
                    onClick={() => {
                        vscode.postMessage({ command: "showDictionaryTable" });
                    }}
                >
                    Show Dictionary Table
                </button>
            </div>
            <div className="card">
                Glosser Info:
                {glosserInfo ? (
                    <p className="glosser-info">
                        Status: {glosserInfo.status}, 
                        Source Texts: {glosserInfo.num_source_texts}, 
                        Target Texts: {glosserInfo.num_target_texts}, 
                        Known Glosses: {glosserInfo.num_known_glosses}
                    </p>
                ) : (
                    <p>No glosser info available</p>
                )}
                {glosserCounts ? (
                    <p className="glosser-counts">
                        Source Vocab Size: {glosserCounts.source_vocab_size}, 
                        Target Vocab Size: {glosserCounts.target_vocab_size}, 
                        Co-occurrences: {glosserCounts.co_occurrences}, 
                        Known Glosses: {glosserCounts.known_glosses}
                    </p>
                ) : (
                    <p>No glosser counts available</p>
                )}
            </div>
        </div>
    );
}

export default App;