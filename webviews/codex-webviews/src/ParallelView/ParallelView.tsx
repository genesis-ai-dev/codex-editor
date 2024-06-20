import React, { useState, useEffect } from "react";
import {
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
    VSCodeButton,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";

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

interface SearchCommand {
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

  

    const searchBoth = (query: string) => {
        setLastQuery(query);  // Store the last query
        vscode.postMessage({
            command: "search",
            database: "both",
            query: query,
        } as SearchCommand);
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
            
            setVerses(prevVerses => {
                const newVerses = [...prevVerses];
                newVerses[index] = {...newVerses[index], codexText: after};
                return newVerses;
            });
            
            setEditedTexts(prev => {
                const newEditedTexts = {...prev};
                delete newEditedTexts[index];
                return newEditedTexts;
            });

            searchBoth(lastQuery);
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
            <div className="container">
                <div className="search-bar">
                    <VSCodeTextField
                        placeholder="Search anything or highlight text."
                        style={{ flexGrow: 1 }}
                        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                    />
                    <VSCodeButton onClick={() => searchBoth(query)}>
                        Search
                    </VSCodeButton>
                </div>
                {verses.length > 0 ? (
                    <div className="verses-container">
                        {verses.map((item, index) => (
                            <div key={index} className={`verse-item ${item.text && item.codexText ? "both-present" : "one-present"}`}>
                                <div className="verse-header">
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
                                    <div className="verse-text">
                                        <span className="verse-label">
                                            <span>📖</span>
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
                                    <div className="verse-text">
                                        <span className="verse-label">
                                            <span>🎯</span>
                                            Target
                                        </span>
                                        {editingIndex === index ? (
                                            <textarea
                                                value={editedTexts[index]}
                                                onChange={(e) =>
                                                    handleTextChange(index, e.target.value)
                                                }
                                                className="verse-textarea"
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
