import React, { useState, useEffect } from "react";
import { VSCodePanelTab, VSCodePanelView, VSCodePanels } from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { Item, OpenFileMessage, SearchCommand, SearchResults } from './types';
import { compareVerses } from './utils';
import SearchBar from './SearchBar';
import VerseItem from './VerseItem';
import { SmartEditClient } from './SmartEditClient';

const vscode = acquireVsCodeApi();
const editClient = new SmartEditClient(vscode);

function App() {
    const [searchResults, setSearchResults] = useState<SearchResults>({
        bibleResults: [],
        codexResults: [],
    });
    const [lastQuery, setLastQuery] = useState<string>("");
    const [verses, setVerses] = useState<Item[]>([]);
    const [before, setBefore] = useState<string>("");
    const [after, setAfter] = useState<string>("");
    const [smartEditingIndex, setSmartEditingIndex] = useState<number>(-1);

    


    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "searchResults") {
                const { bible_results, codex_results } = message.data;
                setSearchResults({
                    bibleResults: bible_results,
                    codexResults: codex_results,
                });
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    useEffect(() => {
        const combinedVerses = compareVerses(searchResults);
        setVerses(combinedVerses);
    }, [searchResults]);

    const handleUriClick = (uri: string, word: string) => {
        vscode.postMessage({
            command: "openFileAtLocation",
            uri,
            word: word,
        } as OpenFileMessage);
    };

    const searchBoth = (query: string) => {
        setLastQuery(query);
        vscode.postMessage({
            command: "search",
            database: "both",
            query: query,
        } as SearchCommand);
    };

    const handleSaveClick = (index: number, before: string, after: string, uri: string) => {
        vscode.postMessage({
            command: 'applyEdit',
            uri: uri,
            before: before,
            after: after
        });
        
        setVerses(prevVerses => {
            const newVerses = [...prevVerses];
            newVerses[index] = {...newVerses[index], codexText: after};
            return newVerses;
        });

        searchBoth(lastQuery);
    };
    const getEdit = async (query: string, setSmartEditText: React.Dispatch<React.SetStateAction<string>>) => {
        try {
            editClient.getSmartEdit(before, after, query)
                .then(result => {
                    setSmartEditText(result.toString());
                });

        } catch (error) {
            console.error('Error getting smart edit:', error);
            return '';
        }
    }

    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab1">Parallel Passages</VSCodePanelTab>
            <VSCodePanelView id="view1">
                <div className="container">
                    <SearchBar
                        query={lastQuery}
                        onQueryChange={setLastQuery}
                        onSearch={() =>{
                                setSmartEditingIndex(-1);
                                setBefore('');
                                setAfter('');
                                searchBoth(lastQuery);
                            }
                        }
                    />
                    {verses.length > 0 && (
                        <div className="verses-container">
                            {verses.map((item, index) => (
                                <VerseItem
                                    key={index}
                                    item={item}
                                    index={index}
                                    onUriClick={handleUriClick}
                                    onSaveClick={handleSaveClick}
                                    setBefore={setBefore}
                                    setAfter={setAfter}
                                    searchBoth={searchBoth}
                                    setSmartEditingIndex={setSmartEditingIndex}
                                    smartEditingIndex={smartEditingIndex}
                                    getEdit={getEdit}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
}

export default App;