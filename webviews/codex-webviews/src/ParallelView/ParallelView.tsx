import React, { useState, useEffect } from "react";
import {
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
    VSCodeDivider,
    VSCodeTextArea,
    VSCodeButton,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { OpenFileMessage } from "./types";
import { TranslationPair } from "../../../../types";

import SearchBar from "./SearchBar";
import VerseItem from "./CellItem";

const vscode = acquireVsCodeApi();

function ParallelView() {
    const [verses, setVerses] = useState<TranslationPair[]>([]);
    const [lastQuery, setLastQuery] = useState<string>("");
    const [chatInput, setChatInput] = useState<string>("");

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "searchResults") {
                setVerses(message.data as TranslationPair[]);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const handleUriClick = (uri: string, word: string) => {
        vscode.postMessage({
            command: "openFileAtLocation",
            uri,
            word: word,
        } as OpenFileMessage);
    };

    const searchBoth = (query: string, event?: React.FormEvent) => {
        if (event) {
            event.preventDefault();
        }
        setLastQuery(query);
        vscode.postMessage({
            command: "search",
            database: "both",
            query: query,
        });
    };

    const handleSaveClick = (index: number, before: string, after: string, uri: string) => {
        vscode.postMessage({
            command: "applyEdit",
            uri: uri,
            before: before,
            after: after,
        });

        setVerses((prevVerses) => {
            const newVerses = [...prevVerses];
            newVerses[index] = {
                ...newVerses[index],
                targetCell: { ...newVerses[index].targetCell, content: after },
            };
            return newVerses;
        });
    };

    const handleSendMessage = () => {
        if (chatInput.trim()) {
            // TODO: Implement send message functionality
            console.log("Sending message:", chatInput);
            setChatInput("");
        }
    };

    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab1">Parallel Passages</VSCodePanelTab>
            <VSCodePanelView id="view1">
                <div className="container">
                    <SearchBar
                        query={lastQuery}
                        onQueryChange={setLastQuery}
                        onSearch={(event) => {
                            searchBoth(lastQuery, event);
                        }}
                    />
                    <VSCodeDivider />
                    {verses.length > 0 ? (
                        <div className="verses-container">
                            {verses.map((item, index) => (
                                <VerseItem
                                    key={index}
                                    item={item}
                                    onUriClick={handleUriClick}
                                    onSaveClick={handleSaveClick}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className="no-results">
                            No results found. Try a different search query.
                        </p>
                    )}
                    <VSCodeDivider />
                    <div
                        className="chat-input-container"
                        style={{
                            position: "fixed",
                            bottom: 0,
                            left: 0,
                            right: 0,
                            padding: "10px",
                            display: "flex",
                            alignItems: "flex-end",
                            backgroundColor: "var(--vscode-editor-background)",
                            boxShadow: "0 -2px 10px rgba(0, 0, 0, 0.1)",
                        }}
                    >
                        <VSCodeTextArea
                            value={chatInput}
                            onChange={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                setChatInput(target.value);
                            }}
                            onKeyPress={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                            placeholder="Type your message here..."
                            resize="vertical"
                            style={{
                                flexGrow: 1,
                                marginRight: "10px",
                                minHeight: "50px",
                                maxHeight: "200px",
                            }}
                        />
                        <VSCodeButton onClick={handleSendMessage} appearance="primary">
                            Send
                        </VSCodeButton>
                    </div>
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
}

export default ParallelView;
