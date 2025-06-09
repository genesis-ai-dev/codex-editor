import React, { useState, useEffect, useRef } from "react";
import {
    VSCodeProgressRing,
} from "@vscode/webview-ui-toolkit/react";
import VerseItem from "./CellItem";
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
    const [isLoading, setIsLoading] = useState(false);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const [showRecentSearches, setShowRecentSearches] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    
    // Focus the search input on component mount
    useEffect(() => {
        if (searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, []);

    // Load recent searches from localStorage on mount
    useEffect(() => {
        const savedSearches = localStorage.getItem('recentBibleSearches');
        if (savedSearches) {
            setRecentSearches(JSON.parse(savedSearches).slice(0, 5));
        }
    }, []);

    const handleSearch = (event?: React.FormEvent) => {
        if (event) event.preventDefault();
        if (!lastQuery.trim()) return;
        
        setIsLoading(true);
        onSearch(lastQuery, event);
        
        // Save to recent searches
        const newRecentSearches = [
            lastQuery,
            ...recentSearches.filter(s => s !== lastQuery)
        ].slice(0, 5);
        
        setRecentSearches(newRecentSearches);
        localStorage.setItem('recentBibleSearches', JSON.stringify(newRecentSearches));
        setShowRecentSearches(false);
        
        // Shorter loading time for better UX
        setTimeout(() => setIsLoading(false), 600);
    };
    
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSearch();
        }
        
        if (e.key === "Escape") {
            if (showRecentSearches) {
                setShowRecentSearches(false);
            }
            e.stopPropagation();
        }
        
        if (e.key === "ArrowDown" && showRecentSearches) {
            e.preventDefault();
            const recentSearchElements = document.querySelectorAll('.recent-search-item');
            if (recentSearchElements.length > 0) {
                (recentSearchElements[0] as HTMLElement).focus();
            }
        }
    };
    
    const handleRecentSearchClick = (search: string) => {
        onQueryChange(search);
        setShowRecentSearches(false);
        setTimeout(() => handleSearch(), 0);
    };
    
    const handleSearchFocus = () => {
        if (recentSearches.length > 0) {
            setShowRecentSearches(true);
        }
    };
    
    const handleClickOutside = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (
            !target.closest(".search-input-container") &&
            !target.closest(".recent-searches-dropdown")
        ) {
            setShowRecentSearches(false);
        }
    };

    return (
        <div className="flex flex-col h-full p-4 gap-4" onClick={handleClickOutside}>
            <div className="card p-4">
                <form onSubmit={handleSearch} className="flex flex-col gap-4">
                    <div className="search-input-container">
                        <input
                            ref={searchInputRef}
                            type="text"
                            className="search-input"
                            placeholder="Search Bible text..."
                            value={lastQuery}
                            onChange={(e) => onQueryChange(e.target.value)}
                            onFocus={handleSearchFocus}
                            onKeyDown={handleKeyDown}
                            aria-label="Search Bible text"
                        />
                        
                        {isLoading ? (
                            <div className="search-loading">
                                <VSCodeProgressRing aria-label="Searching"></VSCodeProgressRing>
                            </div>
                        ) : (
                            <button
                                type="submit"
                                className="search-button"
                                disabled={!lastQuery.trim()}
                                aria-label="Search"
                            >
                                <span className="codicon codicon-search"></span>
                            </button>
                        )}

                        {showRecentSearches && recentSearches.length > 0 && (
                            <div className="recent-searches-dropdown">
                                <div className="dropdown-header">
                                    <span className="dropdown-header-text">
                                        Recent Searches
                                    </span>
                                    <button
                                        className="clear-all-button"
                                        onClick={() => {
                                            setRecentSearches([]);
                                            localStorage.removeItem("recentBibleSearches");
                                            setShowRecentSearches(false);
                                        }}
                                        aria-label="Clear all recent searches"
                                    >
                                        Clear All
                                    </button>
                                </div>
                                <div>
                                    {recentSearches.map((search, index) => (
                                        <button
                                            key={`recent-${index}`}
                                            className="recent-search-item"
                                            onClick={() => handleRecentSearchClick(search)}
                                        >
                                            <span className="codicon codicon-history" style={{ color: 'var(--gray-400)', fontSize: '14px' }}></span>
                                            <span>{search}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                            className="settings-toggle"
                            aria-label="Toggle search settings"
                            aria-expanded={isSettingsExpanded}
                        >
                            <span className="codicon codicon-settings-gear"></span>
                            <span>Settings</span>
                            <span className={`codicon codicon-chevron-${isSettingsExpanded ? 'up' : 'down'}`}></span>
                        </button>

                        {verses.length > 0 && (
                            <button
                                type="button"
                                onClick={onPinAll}
                                className="action-button"
                                aria-label="Pin all verses"
                            >
                                <span className="codicon codicon-pin"></span>
                                <span>Pin All</span>
                                <span className="badge">
                                    {verses.length}
                                </span>
                            </button>
                        )}
                    </div>
                </form>

                {isSettingsExpanded && (
                    <div className="settings-section">
                        <div className="settings-divider" />
                        <label className="custom-checkbox">
                            <input
                                type="checkbox"
                                className="checkbox-input"
                                checked={completeOnly}
                                onChange={(e) => onCompleteOnlyChange(e.target.checked)}
                            />
                            <span className="checkbox-label">
                                Show translated verses only
                            </span>
                        </label>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {isLoading ? (
                    <div className="empty-state">
                        <VSCodeProgressRing aria-label="Loading search results"></VSCodeProgressRing>
                        <div className="empty-state-title">Searching verses...</div>
                        <div className="empty-state-description">
                            Finding relevant passages in your Bible text
                        </div>
                    </div>
                ) : verses.length > 0 ? (
                    <div className="flex flex-col gap-3">
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
                ) : lastQuery ? (
                    <div className="empty-state">
                        <span className="empty-state-icon codicon codicon-search"></span>
                        <div className="empty-state-title">No results found</div>
                        <div className="empty-state-description">
                            No verses found for "{lastQuery}". Try different keywords or check your spelling.
                        </div>
                    </div>
                ) : (
                    <div className="empty-state">
                        <span className="empty-state-icon codicon codicon-search"></span>
                        <div className="empty-state-title">Search the Bible</div>
                        <div className="empty-state-description">
                            Enter words or phrases to find relevant verses in your translation project.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default SearchTab;
