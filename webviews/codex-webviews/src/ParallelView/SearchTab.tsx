import React, { useState, useEffect, useRef } from "react";
import VerseItem from "./CellItem";
import { TranslationPair } from "../../../../types";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { Textarea } from "../components/ui/textarea";
import { canReplaceInHtml } from "./utils";

interface ProjectFile {
    uri: string;
    name: string;
    type: "source" | "target";
}

interface SearchTabProps {
    verses: TranslationPair[];
    pinnedVerses: TranslationPair[];
    lastQuery: string;
    onQueryChange: (query: string) => void;
    onSearch: (query: string, replaceText?: string, event?: React.FormEvent) => void;
    onPinToggle: (item: TranslationPair, isPinned: boolean) => void;
    onUriClick: (uri: string, word: string) => void;
    completeOnly: boolean;
    onCompleteOnlyChange: (checked: boolean) => void;
    searchScope: "both" | "source" | "target";
    onSearchScopeChange: (scope: "both" | "source" | "target") => void;
    projectFiles: ProjectFile[];
    selectedFiles: string[];
    onSelectedFilesChange: (files: string[]) => void;
    onPinAll: () => void;
    onReplaceAll?: () => void;
    replaceText?: string;
    onReplaceTextChange?: (text: string) => void;
    onReplaceCell?: (cellId: string) => void;
    replaceProgress?: { completed: number; total: number } | null;
    replaceErrors?: Array<{ cellId: string; error: string }>;
    onClearReplaceErrors?: () => void;
    vscode: any;
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
    searchScope,
    onSearchScopeChange,
    projectFiles,
    selectedFiles,
    onSelectedFilesChange,
    onPinAll,
    onReplaceAll,
    replaceText = "",
    onReplaceTextChange,
    onReplaceCell,
    replaceProgress,
    replaceErrors = [],
    onClearReplaceErrors,
    vscode,
}: SearchTabProps) {
    const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
    const [isReplaceExpanded, setIsReplaceExpanded] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const [showRecentSearches, setShowRecentSearches] = useState(false);
    const [fileSearchQuery, setFileSearchQuery] = useState<string>("");
    const [showFileSelector, setShowFileSelector] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const replaceTextareaRef = useRef<HTMLTextAreaElement>(null);
    const fileSelectorRef = useRef<HTMLDivElement>(null);

    // Focus the search input on component mount
    useEffect(() => {
        if (searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, []);

    // Load recent searches from localStorage on mount
    useEffect(() => {
        const savedSearches = localStorage.getItem("recentBibleSearches");
        if (savedSearches) {
            setRecentSearches(JSON.parse(savedSearches).slice(0, 5));
        }
    }, []);

    const handleSearch = (event?: React.FormEvent) => {
        if (event) event.preventDefault();
        if (!lastQuery.trim()) return;

        setIsLoading(true);
        onSearch(lastQuery, replaceText, event);

        // Save to recent searches
        const newRecentSearches = [
            lastQuery,
            ...recentSearches.filter((s) => s !== lastQuery),
        ].slice(0, 5);

        setRecentSearches(newRecentSearches);
        localStorage.setItem("recentBibleSearches", JSON.stringify(newRecentSearches));
        setShowRecentSearches(false);

        // Shorter loading time for better UX
        setTimeout(() => setIsLoading(false), 600);
    };

    const handleReplaceTextChange = (value: string) => {
        if (onReplaceTextChange) {
            onReplaceTextChange(value);
        }
        if (value && !isReplaceExpanded) {
            setIsReplaceExpanded(true);
        }
    };


    const handleReplaceAll = () => {
        if (!onReplaceAll || !replaceText.trim() || !lastQuery.trim() || verses.length === 0) return;
        
        if (verses.length >= 5) {
            const confirmed = window.confirm(`Replace all ${verses.length} matches?`);
            if (!confirmed) return;
        }
        
        onReplaceAll();
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
            const recentSearchElements = document.querySelectorAll(".recent-search-item");
            if (recentSearchElements.length > 0) {
                (recentSearchElements[0] as HTMLElement).focus();
            }
        }
    };

    const handleRecentSearchClick = (search: string) => {
        setShowRecentSearches(false);
        onQueryChange(search);
        // Search immediately with the selected term
        onSearch(search, replaceText);
        // Focus after React updates
        requestAnimationFrame(() => {
            if (searchInputRef.current) {
                searchInputRef.current.focus();
            }
        });
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
            !target.closest(".recent-searches-dropdown") &&
            !target.closest(".file-selector-container")
        ) {
            setShowRecentSearches(false);
            setShowFileSelector(false);
        }
    };

    const handleFileToggle = (fileUri: string) => {
        if (selectedFiles.includes(fileUri)) {
            onSelectedFilesChange(selectedFiles.filter(uri => uri !== fileUri));
        } else {
            onSelectedFilesChange([...selectedFiles, fileUri]);
        }
    };

    const handleSelectAllFiles = () => {
        onSelectedFilesChange(projectFiles.map(f => f.uri));
    };

    const handleDeselectAllFiles = () => {
        onSelectedFilesChange([]);
    };

    const filteredFiles = projectFiles.filter(file => 
        file.name.toLowerCase().includes(fileSearchQuery.toLowerCase())
    );

    const allSelected = projectFiles.length > 0 && selectedFiles.length === projectFiles.length;
    const noneSelected = selectedFiles.length === 0;

    return (
        <div className="flex flex-col h-full p-4 gap-4" onClick={handleClickOutside}>
            <Card className="p-4">
                <CardContent className="p-0">
                    <form onSubmit={handleSearch} className="flex flex-col gap-4">
                        <div className="search-input-container relative">
                            <Input
                                ref={searchInputRef}
                                type="text"
                                className="pr-12"
                                placeholder="Search Bible text..."
                                value={lastQuery}
                                onChange={(e) => onQueryChange(e.target.value)}
                                onFocus={handleSearchFocus}
                                onKeyDown={handleKeyDown}
                                aria-label="Search Bible text"
                            />

                            {isLoading ? (
                                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                    <LoadingSpinner size="sm" />
                                </div>
                            ) : (
                                <Button
                                    type="submit"
                                    size="sm"
                                    className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0"
                                    disabled={!lastQuery.trim()}
                                    aria-label="Search"
                                >
                                    <span className="codicon codicon-search"></span>
                                </Button>
                            )}

                            {showRecentSearches && recentSearches.length > 0 && (
                                <Card className="recent-searches-dropdown absolute top-full left-0 right-0 mt-1 z-10">
                                    <CardContent className="p-0">
                                        <div className="flex justify-between items-center p-3 border-b">
                                            <span className="text-sm font-medium text-muted-foreground">
                                                Recent Searches
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setRecentSearches([]);
                                                    localStorage.removeItem("recentBibleSearches");
                                                    setShowRecentSearches(false);
                                                }}
                                                aria-label="Clear all recent searches"
                                            >
                                                Clear All
                                            </Button>
                                        </div>
                                        <div>
                                            {recentSearches.map((search, index) => (
                                                <Button
                                                    key={`recent-${index}`}
                                                    variant="ghost"
                                                    className="w-full justify-start gap-2 h-auto p-3 recent-search-item"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        handleRecentSearchClick(search);
                                                    }}
                                                >
                                                    <span className="codicon codicon-history text-muted-foreground"></span>
                                                    <span>{search}</span>
                                                </Button>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setIsReplaceExpanded(!isReplaceExpanded)}
                                aria-label="Toggle replace"
                                aria-expanded={isReplaceExpanded}
                                className="parallel-action-button flex-1 min-w-0"
                            >
                                <span className="codicon codicon-replace flex-shrink-0"></span>
                                <span className="parallel-button-text ml-2">Replace</span>
                                <span
                                    className={`codicon codicon-chevron-${
                                        isReplaceExpanded ? "up" : "down"
                                    } ml-2 flex-shrink-0`}
                                ></span>
                            </Button>

                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                                aria-label="Toggle search settings"
                                aria-expanded={isSettingsExpanded}
                                className="parallel-action-button flex-1 min-w-0"
                            >
                                <span className="codicon codicon-settings-gear flex-shrink-0"></span>
                                <span className="parallel-button-text ml-2">Settings</span>
                                <span
                                    className={`codicon codicon-chevron-${
                                        isSettingsExpanded ? "up" : "down"
                                    } ml-2 flex-shrink-0`}
                                ></span>
                            </Button>

                            {verses.length > 0 && (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={onPinAll}
                                    aria-label="Pin all results"
                                    className="parallel-action-button flex-1 min-w-0"
                                >
                                    <span className="codicon codicon-pin flex-shrink-0"></span>
                                    <span className="parallel-button-text ml-2">Pin All</span>
                                </Button>
                            )}
                        </div>

                        {isReplaceExpanded && (
                            <div className="border-t pt-4 space-y-3">
                                <div>
                                    <label htmlFor="replace-text" className="text-sm font-medium mb-2 block">
                                        Replace with
                                    </label>
                                    <Textarea
                                        ref={replaceTextareaRef}
                                        id="replace-text"
                                        placeholder="Enter replacement text..."
                                        value={replaceText}
                                        onChange={(e) => handleReplaceTextChange(e.target.value)}
                                        className="min-h-[60px] resize-none"
                                        aria-label="Replace text"
                                    />
                                </div>
                                {replaceText.trim() && lastQuery.trim() && verses.length > 0 && (
                                    <div className="space-y-2">
                                        {replaceProgress && (
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                    <span>Replacing...</span>
                                                    <span>{replaceProgress.completed} of {replaceProgress.total}</span>
                                                </div>
                                                <div className="w-full bg-muted rounded-full h-2">
                                                    <div 
                                                        className="bg-primary h-2 rounded-full transition-all duration-300"
                                                        style={{ width: `${(replaceProgress.completed / replaceProgress.total) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {(() => {
                                            const replaceableCount = replaceText.trim() && lastQuery.trim()
                                                ? verses.filter(v => canReplaceInHtml(v.targetCell.content || "", lastQuery)).length
                                                : verses.length;
                                            const skippedCount = verses.length - replaceableCount;
                                            
                                            return (
                                                <Button
                                                    type="button"
                                                    variant="default"
                                                    size="sm"
                                                    onClick={handleReplaceAll}
                                                    className="w-full"
                                                    disabled={!!replaceProgress || replaceableCount === 0}
                                                    aria-label="Replace all matches"
                                                    title={skippedCount > 0 ? `${skippedCount} match(es) interrupted by HTML - will be skipped` : undefined}
                                                >
                                                    <span className="codicon codicon-replace mr-2"></span>
                                                    Replace All ({replaceableCount}{skippedCount > 0 ? `/${verses.length}` : ''})
                                                </Button>
                                            );
                                        })()}
                                        {replaceErrors.length > 0 && (
                                            <div className="text-xs text-destructive space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <span>{replaceErrors.length} error(s) occurred</span>
                                                    {onClearReplaceErrors && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={onClearReplaceErrors}
                                                            className="h-4 px-2 text-xs"
                                                        >
                                                            Dismiss
                                                        </Button>
                                                    )}
                                                </div>
                                                {replaceErrors.slice(0, 3).map((err, idx) => (
                                                    <div key={idx} className="text-muted-foreground">
                                                        {err.cellId}: {err.error}
                                                    </div>
                                                ))}
                                                {replaceErrors.length > 3 && (
                                                    <div className="text-muted-foreground">
                                                        ...and {replaceErrors.length - 3} more
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {isSettingsExpanded && (
                            <div className="border-t pt-4 space-y-4">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id="complete-only"
                                        checked={completeOnly}
                                        onChange={(e) => onCompleteOnlyChange(e.target.checked)}
                                        className="h-4 w-4 rounded border border-input text-primary"
                                    />
                                    <label
                                        htmlFor="complete-only"
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                    >
                                        Show only completed translations
                                    </label>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="search-scope" className="text-sm font-medium block">
                                        Search scope
                                    </label>
                                    <select
                                        id="search-scope"
                                        value={searchScope}
                                        onChange={(e) => onSearchScopeChange(e.target.value as "both" | "source" | "target")}
                                        className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                                    >
                                        <option value="both">Both source and target</option>
                                        <option value="source">Source text only</option>
                                        <option value="target">Target text only</option>
                                    </select>
                                    {replaceText && replaceText.trim() && searchScope !== "target" && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Note: Replace only works on target text. Set scope to "Target text only" to replace matches.
                                        </p>
                                    )}
                                </div>
                                {projectFiles.length > 0 && (
                                    <div className="space-y-2 file-selector-container relative">
                                        <label className="text-sm font-medium block">
                                            Files to search
                                        </label>
                                        <div className="relative">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="w-full justify-between"
                                                onClick={() => setShowFileSelector(!showFileSelector)}
                                            >
                                                <span>
                                                    {allSelected ? "All files" : noneSelected ? "No files selected" : `${selectedFiles.length} of ${projectFiles.length} files`}
                                                </span>
                                                <span className={`codicon codicon-chevron-${showFileSelector ? "up" : "down"}`}></span>
                                            </Button>
                                            {showFileSelector && (
                                                <Card className="absolute top-full left-0 right-0 mt-1 z-20 max-h-64 overflow-hidden flex flex-col">
                                                    <CardContent className="p-0 flex flex-col">
                                                        <div className="p-2 border-b flex gap-2">
                                                            <Input
                                                                type="text"
                                                                placeholder="Search files..."
                                                                value={fileSearchQuery}
                                                                onChange={(e) => setFileSearchQuery(e.target.value)}
                                                                className="flex-1"
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={handleSelectAllFiles}
                                                                className="text-xs"
                                                            >
                                                                All
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={handleDeselectAllFiles}
                                                                className="text-xs"
                                                            >
                                                                None
                                                            </Button>
                                                        </div>
                                                        <div className="overflow-y-auto max-h-48">
                                                            {filteredFiles.length === 0 ? (
                                                                <div className="p-4 text-sm text-muted-foreground text-center">
                                                                    No files found
                                                                </div>
                                                            ) : (
                                                                filteredFiles.map((file) => {
                                                                    const isSelected = selectedFiles.includes(file.uri);
                                                                    return (
                                                                        <div
                                                                            key={file.uri}
                                                                            className="flex items-center space-x-2 p-2 hover:bg-muted cursor-pointer"
                                                                            onClick={() => handleFileToggle(file.uri)}
                                                                        >
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isSelected}
                                                                                onChange={() => handleFileToggle(file.uri)}
                                                                                className="h-4 w-4 rounded border border-input"
                                                                            />
                                                                            <span className="text-sm flex-1">{file.name}</span>
                                                                            <Badge variant="outline" className="text-xs">
                                                                                {file.type === "source" ? "Source" : "Target"}
                                                                            </Badge>
                                                                        </div>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </form>
                </CardContent>
            </Card>

            {verses.length > 0 && (
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Search Results</span>
                        <Badge variant="secondary">{verses.length}</Badge>
                    </div>
                    {pinnedVerses.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Pinned:</span>
                            <Badge variant="outline">{pinnedVerses.length}</Badge>
                        </div>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-4">
                {verses.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-8">
                        <div className="text-4xl text-muted-foreground mb-4">
                            <span className="codicon codicon-search"></span>
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No search results</h3>
                        <p className="text-muted-foreground">
                            Enter a search term to find Bible verses across your project files.
                        </p>
                    </div>
                ) : (
                    verses.map((item, index) => {
                        const isPinned = pinnedVerses.some((verse) => verse.cellId === item.cellId);
                        return (
                            <VerseItem
                                key={`${item.cellId}-${index}`}
                                item={item}
                                isPinned={isPinned}
                                onPinToggle={onPinToggle}
                                onUriClick={onUriClick}
                                searchQuery={lastQuery}
                                replaceText={replaceText}
                                onReplace={onReplaceCell || ((cellId) => {
                                    vscode.postMessage({
                                        command: "replaceCell",
                                        cellId: cellId,
                                        query: lastQuery,
                                        replaceText: replaceText,
                                    });
                                })}
                            />
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default SearchTab;
