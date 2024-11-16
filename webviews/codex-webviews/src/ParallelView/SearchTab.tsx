import React from "react";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import VerseItem from "./CellItem";
import SearchBar from "./SearchBar";
import { TranslationPair } from "../../../../types";

interface SearchTabProps {
    verses: TranslationPair[];
    pinnedVerses: TranslationPair[];
    lastQuery: string;
    onQueryChange: (query: string) => void;
    onSearch: (query: string, event?: React.FormEvent) => void;
    onPinToggle: (item: TranslationPair, isPinned: boolean) => void;
    onUriClick: (uri: string, word: string) => void;
}

function SearchTab({
    verses,
    pinnedVerses,
    lastQuery,
    onQueryChange,
    onSearch,
    onPinToggle,
    onUriClick,
}: SearchTabProps) {
    return (
        <div
            className="container"
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
            <div
                style={{
                    backgroundColor: "transparent",
                    flexShrink: 0,
                }}
            >
                <SearchBar
                    query={lastQuery}
                    onQueryChange={onQueryChange}
                    onSearch={(event) => onSearch(lastQuery, event)}
                />
                <VSCodeDivider />
            </div>

            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {verses.length > 0 ? (
                    <div className="verses-container">
                        {verses.map((item, index) => (
                            <VerseItem
                                key={index}
                                item={item}
                                onUriClick={onUriClick}
                                isPinned={pinnedVerses.some((v) => v.cellId === item.cellId)}
                                onPinToggle={onPinToggle}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="no-results">No results found. Try a different search query.</p>
                )}
            </div>
        </div>
    );
}

export default SearchTab;
