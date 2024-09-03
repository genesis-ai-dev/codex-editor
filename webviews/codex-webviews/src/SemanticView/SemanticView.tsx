import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeTextField, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();

function App() {
    const [similarWords, setSimilarWords] = useState<string[]>([]);
    const [query, setQuery] = useState("");

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            console.log('Received message in webview:', event.data);
            const message = event.data;
            switch (message.command) {
                case "similarWords":
                    if (Array.isArray(message.data)) {
                        setSimilarWords(message.data.filter(word => word.toLowerCase() !== query.toLowerCase()));
                    } else {
                        console.error('Received invalid data for similarWords:', message.data);
                    }
                    break;
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [query]);

    const searchSimilarWords = (word: string) => {
        console.log('Sending getSimilar message for word:', word);
        setQuery(word);
        vscode.postMessage({
            command: "server.getSimilar",
            word: word,
        });
    };

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            padding: "1.5em",
            boxSizing: "border-box",
            height: "100%",
            fontFamily: "var(--vscode-font-family)",
            color: "var(--vscode-foreground)",
            backgroundColor: "var(--vscode-editor-background)",
        }}>
            <div style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "1.5em",
            }}>
                <VSCodeTextField
                    placeholder="Enter a word"
                    value={query}
                    onChange={(e: any) => setQuery(e.target.value)}
                    style={{ flexGrow: 1, marginRight: "1em" }}
                />
                <VSCodeButton appearance="primary" onClick={() => searchSimilarWords(query)}>Search</VSCodeButton>
            </div>

            <VSCodeDivider />

            {similarWords.length > 0 ? (
                <div style={{ overflowY: "auto", marginTop: "1.5em" }}>
                    <h3 style={{ marginBottom: "1em", color: "var(--vscode-foreground)" }}>Similar Words:</h3>
                    <div style={{ 
                        display: "flex", 
                        flexWrap: "wrap", 
                        gap: "0.5em",
                    }}>
                        {similarWords.map((word, index) => (
                            <VSCodeButton 
                                key={index} 
                                appearance="secondary" 
                                onClick={() => searchSimilarWords(word)}
                                style={{
                                    margin: "0.25em",
                                    transition: "all 0.2s ease-in-out",
                                }}
                            >
                                {word}
                            </VSCodeButton>
                        ))}
                    </div>
                </div>
            ) : query && (
                <div style={{ 
                    marginTop: "1.5em", 
                    textAlign: "center", 
                    color: "var(--vscode-descriptionForeground)"
                }}>
                    No similar words found for "{query}".
                </div>
            )}
        </div>
    );
}

export default App;