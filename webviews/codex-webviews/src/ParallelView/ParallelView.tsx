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

interface applyEdit {
    command: 'applyEdit',
    uri: string;
    before: string;
    after: string;
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
    const [lastQuery, setLastQuery] = useState<string>("");

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
        setLastQuery(query);  // Store the last query
        vscode.postMessage({
            command: "search",
            database: "both",
            query: query,
        } as searchCommand);
    };

    const PassageTab: React.FC = () => {
        const [query, setQuery] = React.useState("");
        const [editingIndex, setEditingIndex] = useState<number | null>(null);
        const [editedTexts, setEditedTexts] = useState<{ [key: number]: string }>({});
        const [verses, setVerses] = useState<any[]>([]);

        useEffect(() => {
            setVerses(compareVerses());
        }, [searchResults]);

        const handleEditClick = (index: number) => {
            setEditingIndex(index);
            setEditedTexts((prev) => ({
                ...prev,
                [index]: verses[index].codexText || "",
            }));
        };

        const handleTextChange = (index: number, text: string) => {
            setEditedTexts((prev) => ({
                ...prev,
                [index]: text,
            }));
        };

        const handleSaveClick = (index: number, before: string, after: string, uri: string) => {
            console.log(`Saving text at index ${index}: ${after}`);
            vscode.postMessage({
                command: 'applyEdit',
                uri: uri,
                before: before,
                after: after
            });
            setEditingIndex(null);
            
            // Update the verse in the UI immediately
            setVerses(prevVerses => {
                const newVerses = [...prevVerses];
                newVerses[index] = {...newVerses[index], codexText: after};
                return newVerses;
            });
            
            // Clear the edited text
            setEditedTexts(prev => {
                const newEditedTexts = {...prev};
                delete newEditedTexts[index];
                return newEditedTexts;
            });

            searchBoth(lastQuery);  // Trigger search for the last query after saving
        };

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
                        placeholder="Search anything or highlight text."
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
                                        : "2px solid rgba(0, 255, 0, 0.5)",
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
                                    {item.codexText && (
                                        <VSCodeButton
                                        onClick={() =>
                                            editingIndex === index
                                                ? handleSaveClick(index, item.codexText || "", editedTexts[index], item.codexUri || "")
                                                : handleEditClick(index)
                                        }
                                    >
                                        {editingIndex === index ? "Save" : "Edit"}
                                    </VSCodeButton>
                                    )}
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
                                        {editingIndex === index ? (
                                            <textarea
                                                value={editedTexts[index]}
                                                onChange={(e) =>
                                                    handleTextChange(index, e.target.value)
                                                }
                                                style={{
                                                    width: "100%",
                                                    height: "100px",
                                                    borderRadius: "10px",
                                                    padding: "10px",
                                                    border: "1px solid var(--vscode-sideBar-border)",
                                                    backgroundColor: "var(--vscode-editor-background)",
                                                    color: "var(--vscode-editor-foreground)",
                                                    fontFamily: "var(--vscode-font-family)",
                                                    fontSize: "var(--vscode-font-size)",
                                                }}
                                            />
                                        ) : (
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
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : null}
                {!loading && verses.length === 0 && (
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
                            No results found.
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