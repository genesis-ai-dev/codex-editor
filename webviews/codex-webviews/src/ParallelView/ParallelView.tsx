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
import ReactMarkdown from "react-markdown";

import SearchBar from "./SearchBar";
import VerseItem from "./CellItem";
import ChatInput from "./ChatInput";

const vscode = acquireVsCodeApi();

function ParallelView() {
    const [verses, setVerses] = useState<TranslationPair[]>([]);
    const [lockedVerses, setLockedVerses] = useState<TranslationPair[]>([]);
    const [lastQuery, setLastQuery] = useState<string>("");
    const [chatInput, setChatInput] = useState<string>("");
    const [chatResponse, setChatResponse] = useState<string | null>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "searchResults") {
                setVerses([...lockedVerses, ...(message.data as TranslationPair[])]);
            } else if (message.command === "chatResponse") {
                setChatResponse(message.data);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [lockedVerses]);

    const handleUriClick = (uri: string, word: string) => {
        console.log("handleUriClick", uri, word);
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

    const handleLockToggle = (item: TranslationPair, isLocked: boolean) => {
        if (isLocked) {
            setLockedVerses([...lockedVerses, item]);
        } else {
            setLockedVerses(lockedVerses.filter((v) => v.cellId !== item.cellId));
        }
    };

    const handleChatSubmit = () => {
        if (!chatInput.trim()) return;

        vscode.postMessage({
            command: "chat",
            query: chatInput,
            context: verses.map((verse) => verse.cellId),
        });
        setChatInput("");
    };

    const handleChatFocus = () => {
        setVerses([...lockedVerses]);
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
                                    isLocked={lockedVerses.some((v) => v.cellId === item.cellId)}
                                    onLockToggle={handleLockToggle}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className="no-results">
                            No results found. Try a different search query.
                        </p>
                    )}
                    <VSCodeDivider />
                    {chatResponse && (
                        <div
                            className="chat-response"
                            style={{
                                padding: "12px",
                                margin: "12px 0",
                                background: "var(--vscode-editor-background)",
                                borderRadius: "6px",
                            }}
                        >
                            <ReactMarkdown>{chatResponse}</ReactMarkdown>
                        </div>
                    )}
                    <VSCodeDivider />
                    <ChatInput
                        value={chatInput}
                        onChange={setChatInput}
                        onSubmit={handleChatSubmit}
                        onFocus={handleChatFocus}
                    />
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
}

export default ParallelView;
