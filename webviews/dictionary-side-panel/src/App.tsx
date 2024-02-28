import { vscode } from "./utilities/vscode";
import { useEffect, useState } from "react";
import { Dictionary } from "codex-types";
import { numberOfEntries } from "./utils";
import "./App.css";

function App() {
    const [entries, setEntries] = useState(0);

    useEffect(() => {
        const handleReceiveMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "sendData": {
                    const dictionary: Dictionary = message.data;
                    setEntries(numberOfEntries(dictionary));
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
        </div>
    );
}

export default App;
