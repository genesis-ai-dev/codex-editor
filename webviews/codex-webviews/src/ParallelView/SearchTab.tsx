import React, { useState, useEffect, useRef } from "react";
import { VSCodeDivider, VSCodeCheckbox, VSCodeButton, VSCodeProgressRing, VSCodeBadge } from "@vscode/webview-ui-toolkit/react";
import VerseItem from "./CellItem";
import { TranslationPair } from "../../../../types";
import "./SearchStyles.css";
import "./SharedStyles.css";

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
        // Implement Ctrl+Enter and Enter to search
        if (e.key === "Enter") {
            e.preventDefault();
            handleSearch();
        }
        
        // Escape key to close recent searches dropdown
        if (e.key === "Escape") {
            if (showRecentSearches) {
                setShowRecentSearches(false);
            }
            e.stopPropagation();
        }
        
        // Arrow down to focus the recent searches
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
        if (!target.closest('.search-input-container') && !target.closest('.recent-searches-dropdown')) {
            setShowRecentSearches(false);
        }
    };

    return (
        <div className="search-container" onClick={handleClickOutside}>
            <div className="search-bar-container">
                <form onSubmit={handleSearch} className="search-form">
                    <div className="search-input-container">
                        <input
                            ref={searchInputRef}
                            type="text"
                            className="search-input"
                            placeholder="Search Bible text (words or phrases)..."
                            value={lastQuery}
                            onChange={(e) => onQueryChange(e.target.value)}
                            onFocus={handleSearchFocus}
                            onKeyDown={handleKeyDown}
                            aria-label="Search Bible text (words or phrases)"
                        />
                        {isLoading ? (
                            <VSCodeProgressRing className="search-loading" aria-label="Searching"></VSCodeProgressRing>
                        ) : (
                            <VSCodeButton 
                                type="submit" 
                                appearance="icon" 
                                className="search-button-inline"
                                aria-label="Search"
                            >
                                <span className="codicon codicon-arrow-right" aria-hidden="true"></span>
                            </VSCodeButton>
                        )}
                        
                        {/* Recent searches dropdown */}
                        {showRecentSearches && recentSearches.length > 0 && (
                            <div className="recent-searches-dropdown">
                                <div className="recent-searches-header">
                                    <span>Recent Searches</span>
                                    <button 
                                        className="clear-recent-searches" 
                                        onClick={() => {
                                            setRecentSearches([]);
                                            localStorage.removeItem('recentBibleSearches');
                                            setShowRecentSearches(false);
                                        }}
                                        aria-label="Clear all recent searches"
                                    >
                                        Clear All
                                    </button>
                                </div>
                                <ul className="recent-searches-list">
                                    {recentSearches.map((search, index) => (
                                        <li key={`recent-${index}`}>
                                            <button 
                                                className="recent-search-item"
                                                onClick={() => handleRecentSearchClick(search)}
                                            >
                                                <span className="codicon codicon-history" aria-hidden="true"></span>
                                                <span>{search}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                    
                    <div className="search-toolbar">
                        <div className="search-toolbar-left">
                            <VSCodeButton 
                                appearance="icon" 
                                className="search-toolbar-button"
                                onClick={() => setIsSettingsExpanded(!isSettingsExpanded)} 
                                title="Search Settings"
                                aria-label="Toggle search settings"
                                aria-expanded={isSettingsExpanded}
                            >
                                <span className="codicon codicon-gear" aria-hidden="true"></span>
                                <span className="button-label">{isSettingsExpanded ? 'Hide Settings' : 'Settings'}</span>
                            </VSCodeButton>
                        </div>
                        
                        <div className="search-toolbar-right">
                            {verses.length > 0 && (
                                <VSCodeButton 
                                    appearance="icon" 
                                    className="search-toolbar-button"
                                    onClick={onPinAll} 
                                    title="Pin All Verses"
                                    aria-label="Pin all verses"
                                >
                                    <span className="codicon codicon-pin" aria-hidden="true"></span>
                                    <span className="button-label">Pin All</span>
                                    <VSCodeBadge>{verses.length}</VSCodeBadge>
                                </VSCodeButton>
                            )}
                        </div>
                    </div>
                </form>

                {isSettingsExpanded && (
                    <div className="settings-panel" role="region" aria-label="Search settings">
                        <VSCodeDivider />
                        <div className="settings-option">
                            <VSCodeCheckbox
                                id="complete-only-checkbox"
                                checked={completeOnly}
                                onChange={(e) => onCompleteOnlyChange((e.target as HTMLInputElement).checked)}
                            />
                            <label htmlFor="complete-only-checkbox" className="settings-label">
                                Show translated verses only
                            </label>
                        </div>
                    </div>
                )}
            </div>

            <div className="search-results" role="region" aria-label="Search results">
                {isLoading ? (
                    <div className="loading-state">
                        <VSCodeProgressRing aria-label="Loading search results"></VSCodeProgressRing>
                        <p>Searching verses...</p>
                    </div>
                ) : verses.length > 0 ? (
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
                ) : lastQuery ? (
                    <div className="empty-state">
                        <div className="empty-state-icon codicon codicon-search" aria-hidden="true"></div>
                        <h2 className="empty-state-title">No verses found</h2>
                        <p className="empty-state-description">
                            Try a different search term or reference
                        </p>
                    </div>
                ) : (
                    <div className="empty-state">
                        <div className="empty-state-icon codicon codicon-book" aria-hidden="true"></div>
                        <h2 className="empty-state-title">Search Bible Verses</h2>
                        <p className="empty-state-description">
                            Enter a word or phrase to find relevant verses
                        </p>
                        <div className="search-suggestions">
                            <div className="suggestion-chips">
                                <button 
                                    className="prompt-chip" 
                                    onClick={() => {
                                        onQueryChange("love");
                                        handleSearch();
                                    }}
                                >
                                    love
                                </button>
                                <button 
                                    className="prompt-chip" 
                                    onClick={() => {
                                        onQueryChange("faith");
                                        handleSearch();
                                    }}
                                >
                                    faith
                                </button>
                                <button 
                                    className="prompt-chip" 
                                    onClick={() => {
                                        onQueryChange("hope");
                                        handleSearch();
                                    }}
                                >
                                    hope
                                </button>
                                <button 
                                    className="prompt-chip" 
                                    onClick={() => {
                                        onQueryChange("forgive");
                                        handleSearch();
                                    }}
                                >
                                    forgive
                                </button>
                                <button 
                                    className="prompt-chip" 
                                    onClick={() => {
                                        onQueryChange("mercy");
                                        handleSearch();
                                    }}
                                >
                                    mercy
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default SearchTab;
