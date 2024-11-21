import React, { useState } from "react";
import { VSCodeDivider, VSCodeCheckbox, VSCodeButton } from "@vscode/webview-ui-toolkit/react";
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
    completeOnly: boolean;
    onCompleteOnlyChange: (checked: boolean) => void;
    onPinAll: () => void;
}

function SearchTab({
    verses,
    pinnedVerses,
    lastQuery,
    onQueryChange,
    onSearch,
    onPinToggle,
    onUriClick,
    completeOnly,
    onCompleteOnlyChange,
    onPinAll,
}: SearchTabProps) {
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);

    return (
        <div
            className="container"
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
            <div style={{ backgroundColor: "transparent", flexShrink: 0, padding: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", height: "28px" }}>
                        <VSCodeButton
                            appearance="icon"
                            aria-label="Search Settings"
                            onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                            style={{
                                padding: 0,
                                margin: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                height: "28px",
                                minWidth: "28px",
                            }}
                        >
                            <span className="codicon codicon-gear"></span>
                        </VSCodeButton>
                        {verses.length > 0 && (
                            <VSCodeButton
                                appearance="icon"
                                aria-label="Pin All"
                                onClick={onPinAll}
                                style={{
                                    padding: 0,
                                    margin: 0,
                                    marginLeft: "5px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    height: "28px",
                                    minWidth: "28px",
                                }}
                            >
                                <span className="codicon codicon-pin"></span>
                            </VSCodeButton>
                        )}
                    </div>
                    <div style={{ flexGrow: 1, marginLeft: "10px" }}>
                        <SearchBar
                            query={lastQuery}
                            onQueryChange={onQueryChange}
                            onSearch={(event) => onSearch(lastQuery, event)}
                        />
                    </div>
                </div>
                {isSettingsExpanded && (
                    <div
                        style={{
                            marginBottom: "10px",
                            padding: "10px",
                            border: "1px solid var(--vscode-widget-border)",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center" }}>
                            <VSCodeCheckbox
                                id="complete-only-checkbox"
                                checked={completeOnly}
                                onChange={(e) =>
                                    onCompleteOnlyChange((e.target as HTMLInputElement).checked)
                                }
                            />
                            <label
                                htmlFor="complete-only-checkbox"
                                style={{ marginLeft: "8px", cursor: "pointer" }}
                            >
                                Search complete pairs only
                            </label>
                        </div>
                        {/* Add more settings here if needed */}
                    </div>
                )}
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
