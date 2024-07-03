import { vscode } from "./utilities/vscode";
import { useEffect, useState } from "react";
import { Dictionary } from "codex-types";
import { numberOfEntries } from "./utils";
import "./App.css";

function App() {
    const [entries, setEntries] = useState(0);
    const [glosserInfo, setGlosserInfo] = useState(null);
    const [glosserCounts, setGlosserCounts] = useState(null);

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
                    setGlosserInfo(glosserInfo);
                    setGlosserCounts(glosserCounts);
                    console.log("Glosser info:", glosserInfo);
                    console.log("Glosser counts:", glosserCounts);
                    break;
                }
            }
        };
        window.addEventListener("message", handleReceiveMessage);
        return () => {
            window.removeEventListener("message", handleReceiveMessage);
        };
    }, []);

    // Request dictionary data update
    vscode.postMessage({ command: "updateData" });

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
                <p className="glosser-info">Glosser Info: {glosserInfo}</p>
                <p className="glosser-counts">
                    Glosser Counts: {glosserCounts}
                </p>
            </div>
        </div>
    );
}

export default App;
