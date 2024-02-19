import React, { useState, useEffect } from "react";
import { WebviewHeader } from "../components/WebviewHeader";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

// Import other necessary modules and components

const vscode = acquireVsCodeApi();

interface SearchResult {
    book: string;
    chapter: string;
    verse: string;
    text: string;
    createdAt: string; // Assuming createdAt is a string that can be converted to a Date
    uri: string;
}

interface OpenFileMessage {
    command: "openFileAtLocation";
    uri: string;
    word: string;
}

function App() {
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [loadingProgress, setLoadingProgress] = useState<{
        currentStep: number;
        totalSteps: number;
    } | null>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "searchResults":
                    setSearchResults(message.data);
                    break;
                case "loadingProgress":
                    setLoadingProgress({
                        currentStep: message.currentStep,
                        totalSteps: message.totalSteps,
                    });
                    break;
                // Handle other cases
            }
        };

        window.addEventListener("message", handleMessage);

        // Cleanup function to remove the event listener
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    const handleUriClick = (uri: string, word: string) => {
        // Placeholder for callback function
        console.log(`URI clicked: ${uri}`);
        // TODO: Open the document with the given URI *at* the passage
        vscode.postMessage({
            command: "openFileAtLocation",
            uri,
            word: word, // FIXME: Replace with actual position
        } as OpenFileMessage);
    };
    const handleEmbedAllDocuments = () => {
        console.log("Embedding all documents...");
        vscode.postMessage({
            command: "embedAllDocuments",
        });
    };

    const renderProgressBar = () => {
        if (
            !loadingProgress ||
            loadingProgress.totalSteps == 0 ||
            loadingProgress.currentStep >= loadingProgress.totalSteps
        ) {
            return null;
        }
        const progressPercentage =
            (loadingProgress.currentStep / loadingProgress.totalSteps) * 100;
        return (
            <div
                style={{
                    height: "10px",
                    backgroundColor: "grey",
                    margin: "10px auto",
                    width: "90%",
                }}
            >
                <div
                    style={{
                        height: "100%",
                        width: `${progressPercentage}%`,
                        backgroundColor: "var(--vscode-sideBar-dropBackground)",
                    }}
                ></div>
                {progressPercentage < 100 && (
                    <p style={{ textAlign: "center" }}>
                        Loading, please do not close this tab.
                    </p>
                )}
                <br></br>
            </div>
        );
    };

    const EmbedAllDocumentsButton = ({
        callback,
    }: {
        callback: () => void;
    }) => (
        <VSCodeButton
            aria-label="Clear"
            appearance="icon"
            title="Refresh parallel passages index"
            onClick={callback}
            style={{
                backgroundColor: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
            }}
        >
            <i className="codicon codicon-refresh"></i>
        </VSCodeButton>
    );

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "1em",
                alignItems: "center",
            }}
        >
            {/* <h2 style={{ textAlign: "center", margin: "20px 0" }}>
                Parallel Passages
            </h2> */}
            <WebviewHeader title="Parallel Passages">
                <EmbedAllDocumentsButton callback={handleEmbedAllDocuments} />
            </WebviewHeader>
            {loadingProgress &&
            loadingProgress.currentStep < loadingProgress.totalSteps ? null : (
                <VSCodeButton onClick={handleEmbedAllDocuments} style={{}}>
                    Embed all documents
                </VSCodeButton>
            )}
            {renderProgressBar()}
            {searchResults.length > 0 ? (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "1em",
                    }}
                >
                    {searchResults.map((result, index) => (
                        <div
                            key={index}
                            style={{
                                marginBottom: "20px",
                                background: "var(--vscode-sideBar-background)",
                                borderRadius: "10px",
                                padding: "20px",
                            }}
                        >
                            <h3>
                                {result.book} {result.chapter}:{result.verse}
                            </h3>
                            <p
                                style={{
                                    background:
                                        "var(--vscode-sideBar-dropBackground)",
                                    borderRadius: "10px",
                                    margin: "10px",
                                    padding: "5px",
                                }}
                            >
                                {result.text}
                            </p>
                            <p>
                                <strong>Last indexed:</strong>{" "}
                                {new Date(result.createdAt).toLocaleString()}
                            </p>
                            <button
                                onClick={() =>
                                    handleUriClick(
                                        result.uri,
                                        `${result.chapter}:${result.verse}`,
                                    )
                                }
                                style={{
                                    marginTop: "10px",
                                    padding: "5px 10px",
                                }}
                            >
                                Open
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <p>No results found.</p>
            )}
        </div>
    );
}
export default App;
