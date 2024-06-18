import React, { useState, useEffect } from "react";
import {
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
    VSCodeButton,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();

interface Item {
    ref: string;
    text: string;
    uri: string;
}

interface OpenFileMessage {
    command: "openFileAtLocation";
    uri: string;
    word: string;
}

interface searchCommand {
    command: string;
    query: string;
    database: string;
}

function App() {
    const [searchResults, setSearchResults] = useState<{
        bibleResults: Item[];
        codexResults: Item[];
    }>({
        bibleResults: [],
        codexResults: [],
    });
    const [loading, setLoading] = useState<boolean>(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "searchResults": {
                    const {
                        bible_results,
                        codex_results,
                    }: {
                        bible_results: Item[];
                        codex_results: Item[];
                    } = message.data;
                    const parsedBibleResults = bible_results;
                    const parsedCodexResults = codex_results;
                    setSearchResults({
                        bibleResults: parsedBibleResults,
                        codexResults: parsedCodexResults,
                    });
                    break;
                }
                case "completed":
                    setLoading(false);
                    break;
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    const handleUriClick = (uri: string, word: string) => {
        console.log(`URI clicked: ${uri}`);
        vscode.postMessage({
            command: "openFileAtLocation",
            uri,
            word: word,
        } as OpenFileMessage);
    };

    const handleEmbedAllDocuments = () => {
        console.log("Embedding all codex documents...");
        setLoading(true);

        vscode.postMessage({
            command: "embedAllDocuments",
        });
    };

    const handleEmbedBible = () => {
        console.log("Embedding all bible documents...");
        setLoading(true);
        vscode.postMessage({
            command: "embedSource",
        });
    };

    const searchBoth = (query: string) => {
        vscode.postMessage({
            command: "search",
            database: "both",
            query: query,
        } as searchCommand);
    };

    const PassageTab: React.FC = () => {
        const [query, setQuery] = React.useState("");

        const compareVerses = () => {
            const combinedVerses = searchResults.bibleResults.map((bibleVerse) => {
                const codexVerse = searchResults.codexResults.find(
                    (codexVerse) => codexVerse.ref === bibleVerse.ref
                );
                return {
                    ...bibleVerse,
                    codexText: codexVerse ? codexVerse.text : null,
                    codexUri: codexVerse ? codexVerse.uri : null,
                };
            });

            const uniqueCodexVerses = searchResults.codexResults.filter(
                (codexVerse) =>
                    !searchResults.bibleResults.some(
                        (bibleVerse) => bibleVerse.ref === codexVerse.ref
                    )
            );

            return [...combinedVerses, ...uniqueCodexVerses];
        };

        const verses = compareVerses();

        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2em",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "95%",
                    margin: "auto",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        marginTop: "2em",
                        width: "100%",
                    }}
                >
                    <VSCodeTextField
                        placeholder="Enter text here"
                        style={{ flexGrow: 1 }}
                        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                    />
                    <VSCodeButton onClick={() => searchBoth(query)}>
                        Search
                    </VSCodeButton>
                </div>

                {loading ? (
                    <p>
                        Loading, this may take up to 30 minutes, please do not close this
                        tab.
                    </p>
                ) : null}
                {verses.length > 0 ? (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "1em",
                        }}
                    >
                        {verses.map((item, index) => (
                            <div
                                key={index}
                                style={{
                                    marginBottom: "5px",
                                    background: "var(--vscode-sideBar-dropBackground)",
                                    borderRadius: "5px",
                                    alignContent: "center",
                                    display: "flex",
                                    flexDirection: "column",
                                    padding: "5px",
                                    width: "100%",
                                    border: item.text && item.codexText
                                        ? "2px solid rgba(0, 255, 0, 0.5)"
                                        : "2px solid rgba(255, 0, 0, 0.5)",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        marginBottom: "10px",
                                    }}
                                >
                                    <span>{item.ref}</span>
                                </div>
                                {item.text && (
                                    <div
                                        style={{
                                            borderRadius: "10px",
                                            margin: "10px",
                                            padding: "5px",
                                        }}
                                    >
                                        <span
                                            style={{
                                                background: "rgba(0, 255, 0, 0.2)",
                                                padding: "2px 5px",
                                                borderRadius: "5px",
                                                marginBottom: "5px",
                                                display: "inline-flex",
                                                alignItems: "center",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    marginRight: "5px",
                                                }}
                                            >
                                                📖
                                            </span>
                                            Source
                                        </span>
                                        <p
                                            style={{
                                                cursor: "pointer",
                                            }}
                                            onClick={() => handleUriClick(item.uri, `${item.ref}`)}
                                        >
                                            {item.text}
                                        </p>
                                    </div>
                                )}
                                {item.codexText && (
                                    <div
                                        style={{
                                            borderRadius: "10px",
                                            margin: "10px",
                                            padding: "5px",
                                        }}
                                    >
                                        <span
                                            style={{
                                                background: "rgba(0, 255, 0, 0.2)",
                                                padding: "2px 5px",
                                                borderRadius: "5px",
                                                marginBottom: "5px",
                                                display: "inline-flex",
                                                alignItems: "center",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    marginRight: "5px",
                                                }}
                                            >
                                                🎯
                                            </span>
                                            Target
                                        </span>
                                        <p
                                            style={{
                                                cursor: "pointer",
                                            }}
                                            onClick={() =>
                                                handleUriClick(item.codexUri || "", `${item.ref}`)
                                            }
                                        >
                                            {item.codexText}
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : null}
                {!loading && (
                    <div
                        style={{
                            marginBottom: "5px",
                            background: "var(--vscode-sideBar-dropBackground)",
                            borderRadius: "5px",
                            alignContent: "center",
                            display: "flex",
                            flexDirection: "column",
                            padding: "5px",
                            width: "100%",
                        }}
                    >
                        <p
                            style={{
                                background: "none",
                                borderRadius: "10px",
                                margin: "10px",
                                padding: "5px",
                                textAlign: "center",
                            }}
                        >
                            Results.
                        </p>
                    </div>
                )}
            </div>
        );
    };

    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab1">Parallel Passages</VSCodePanelTab>
            <VSCodePanelView id="view1">
                <PassageTab />
            </VSCodePanelView>
        </VSCodePanels>
    );
}

export default App;