import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();

interface SimilarWord {
    word: string;
}

function App() {
    const [similarWords, setSimilarWords] = useState<SimilarWord[]>([]);
    const [query, setQuery] = useState("");

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "similarWords":
                    setSimilarWords(message.data);
                    break;
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    const searchSimilarWords = (word: string) => {
        setQuery(word);
        vscode.postMessage({
            command: "getSimilar",
            word: word,
        });
    };

    const getRandomDistance = () => {
        return 1; // Consistent distance of 1
    };

    const getCircleSize = (word: string) => {
        const baseSize = 60;
        const lengthFactor = word.length * 5;
        return baseSize + lengthFactor;
    };

    const getStrokeWidth = (word: string) => {
        const baseWidth = 2;
        const lengthFactor = word.length * 0.2;
        return baseWidth + lengthFactor;
    };

    const trainModel = () => {
        vscode.postMessage({
            command: "train",
        });
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100vh",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", marginBottom: "2em" }}>
                <VSCodeTextField
                    placeholder="Enter a word"
                    value={query}
                    onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                />
                <VSCodeButton onClick={() => searchSimilarWords(query)}>Search</VSCodeButton>
            </div>

            <div style={{ display: "flex", marginBottom: "2em" }}>
                <VSCodeButton onClick={() => trainModel()}>Train Model</VSCodeButton>
            </div>

            {similarWords.length > 0 && (
                <div
                    style={{
                        position: "relative",
                        width: "500px",
                        height: "500px",
                    }}
                >
                    <svg
                        width="100%"
                        height="100%"
                        style={{ position: "absolute", top: 0, left: 0, zIndex: -1 }}
                    >
                        {similarWords.map((item, index) => {
                    
                            const angle = (index * 2 * Math.PI) / similarWords.length;
                            const distance = getRandomDistance();
                            const x = 50 + Math.cos(angle) * distance * 40;
                            const y = 50 + Math.sin(angle) * distance * 40;
                            return (
                                <line
                                    key={index}
                                    x1="50%"
                                    y1="50%"
                                    x2={`${x}%`}
                                    y2={`${y}%`}
                                    strokeWidth={getStrokeWidth(item)}
                                />
                            );
                        })}
                    </svg>

                    <div
                        style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            width: `${getCircleSize(query)}px`,
                            height: `${getCircleSize(query)}px`,
                            borderRadius: "50%",
                            background: "var(--vscode-sideBar-background)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "20px",
                            fontWeight: "bold",
                            zIndex: 1,
                        }}
                    >
                        {query}
                    </div>

                    {similarWords.map((item, index) => {
                        const angle = (index * 2 * Math.PI) / similarWords.length;
                        const distance = getRandomDistance();
                        const x = 50 + Math.cos(angle) * distance * 40;
                        const y = 50 + Math.sin(angle) * distance * 40;
                        return (
                            <div
                                key={index}
                                style={{
                                    position: "absolute",
                                    top: `${y}%`,
                                    left: `${x}%`,
                                    transform: "translate(-50%, -50%)",
                                    background: "var(--vscode-sideBar-background)", // Updated background color
                                    borderRadius: "50%",
                                    width: `${getCircleSize(item)}px`,
                                    height: `${getCircleSize(item)}px`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "16px",
                                    cursor: "pointer",
                                    color: "var(--vscode-editor-foreground)",
                                    zIndex: 2,
                                }}
                                onClick={() => searchSimilarWords(item)}
                            >
                                {item}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default App;