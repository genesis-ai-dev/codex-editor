import React, { useState, useEffect } from "react";
import {
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
    VSCodeDivider,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { OpenFileMessage, SearchResults } from "./types";
import { TranslationPair } from "../../../../types";

import SearchBar from "./SearchBar";
import VerseItem from "./VerseItem";

const vscode = acquireVsCodeApi();

function ParallelView() {
    const [verses, setVerses] = useState<TranslationPair[]>([]);
    const [lastQuery, setLastQuery] = useState<string>("");
    
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

    const handleSaveClick = (
        index: number,
        before: string,
        after: string,
        uri: string,
    ) => {
        vscode.postMessage({
            command: "applyEdit",
            uri: uri,
            before: before,
            after: after,
        });

        setVerses((prevVerses) => {
            const newVerses = [...prevVerses];
            newVerses[index] = { ...newVerses[index], targetVerse: { ...newVerses[index].targetVerse, content: after } };
            return newVerses;
        });
    };
   
    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab1">Parallel Passages</VSCodePanelTab>
            <VSCodePanelView id="view1">
                <div className="container">
                    <h1 className="view-title">Parallel Passages</h1>
                    <VSCodeDivider />
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
                                <React.Fragment key={index}>
                                    <VerseItem
                                        item={item}
                                        index={index}
                                        onUriClick={handleUriClick}
                                        onSaveClick={handleSaveClick}
                                    />
                                    {index < verses.length - 1 && <VSCodeDivider />}
                                </React.Fragment>
                            ))}
                        </div>
                    ) : (
                        <p className="no-results">No results found. Try a different search query.</p>
                    )}
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
}

export default ParallelView;
