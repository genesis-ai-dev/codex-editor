import React, { useState, useEffect, useRef, useMemo } from "react";
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
    onReplaceAll?: (retainValidations: boolean) => void;
    replaceText?: string;
    onReplaceTextChange?: (text: string) => void;
    onReplaceCell?: (cellId: string, currentContent: string, retainValidations: boolean) => void;
    replaceProgress?: { completed: number; total: number } | null;
    replaceErrors?: Array<{ cellId: string; error: string }>;
    onClearReplaceErrors?: () => void;
    vscode: any;
    forceReplaceExpanded?: boolean;
    showPinnedOnly?: boolean;
    onTogglePinnedFilter?: () => void;
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
    forceReplaceExpanded,
    showPinnedOnly = false,
    onTogglePinnedFilter,
}: SearchTabProps) {
    const [isReplaceExpanded, setIsReplaceExpanded] = useState(false);

    // Expand replace section when forceReplaceExpanded becomes true
    useEffect(() => {
        if (forceReplaceExpanded) {
            setIsReplaceExpanded(true);
        }
    }, [forceReplaceExpanded]);
    const [isLoading, setIsLoading] = useState(false);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const [showRecentSearches, setShowRecentSearches] = useState(false);
    const [fileSearchQuery, setFileSearchQuery] = useState<string>("");
    const [showFileSelector, setShowFileSelector] = useState(false);
    const [retainValidations, setRetainValidations] = useState<boolean>(() => {
        const saved = localStorage.getItem("retainMyValidations");
        return saved === "true";
    });
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

    // Persist retainValidations to localStorage when it changes
    useEffect(() => {
        localStorage.setItem("retainMyValidations", String(retainValidations));
    }, [retainValidations]);

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

    // Clear replace text when section is collapsed
    useEffect(() => {
        if (!isReplaceExpanded && onReplaceTextChange) {
            onReplaceTextChange("");
        }
    }, [isReplaceExpanded, onReplaceTextChange]);

    // Auto-switch to "target" scope when user enters replacement text
    // This provides better UX than disabling the replace button
    useEffect(() => {
        if (replaceText.trim() && searchScope !== "target") {
            onSearchScopeChange("target");
        }
    }, [replaceText, searchScope, onSearchScopeChange]);

    const handleReplaceAll = () => {
        if (!onReplaceAll || !replaceText.trim() || !lastQuery.trim() || verses.length === 0)
            return;
        onReplaceAll(retainValidations);
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
            onSelectedFilesChange(selectedFiles.filter((uri) => uri !== fileUri));
        } else {
            onSelectedFilesChange([...selectedFiles, fileUri]);
        }
    };

    const handleSelectAllFiles = () => {
        onSelectedFilesChange(projectFiles.map((f) => f.uri));
    };

    const handleDeselectAllFiles = () => {
        onSelectedFilesChange([]);
    };

    const filteredFiles = projectFiles.filter((file) =>
        file.name.toLowerCase().includes(fileSearchQuery.toLowerCase())
    );

    const allSelected = projectFiles.length > 0 && selectedFiles.length === projectFiles.length;
    const noneSelected = selectedFiles.length === 0;

    const sortedVerses = useMemo(() => {
        const filtered = showPinnedOnly
            ? verses.filter((v) => pinnedVerses.some((p) => p.cellId === v.cellId))
            : verses;
        return [...filtered].sort((a, b) => {
            const aPin = pinnedVerses.some((v) => v.cellId === a.cellId) ? 1 : 0;
            const bPin = pinnedVerses.some((v) => v.cellId === b.cellId) ? 1 : 0;
            return bPin - aPin;
        });
    }, [verses, pinnedVerses, showPinnedOnly]);

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

                        {/* Options row - all search options in one organized row */}
                        <div className="flex items-center gap-2 border-t pt-3 flex-wrap">
                            {/* Search scope toggle */}
                            <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                                <button
                                    type="button"
                                    onClick={() => onSearchScopeChange("both")}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                        searchScope === "both"
                                            ? "bg-background shadow-sm font-medium"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    Both
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onSearchScopeChange("source")}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                        searchScope === "source"
                                            ? "bg-background shadow-sm font-medium"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    Source
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onSearchScopeChange("target")}
                                    className={`px-2 py-1 text-xs rounded transition-colors ${
                                        searchScope === "target"
                                            ? "bg-background shadow-sm font-medium"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    Target
                                </button>
                            </div>

                            {/* Divider */}
                            <div className="h-4 w-px bg-border" />

                            {/* Complete only checkbox */}
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer hover:text-foreground text-muted-foreground">
                                <input
                                    type="checkbox"
                                    checked={completeOnly}
                                    onChange={(e) => onCompleteOnlyChange(e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border border-input"
                                />
                                Complete only
                            </label>

                            {/* File selector */}
                            {projectFiles.length > 0 && (
                                <>
                                    <div className="h-4 w-px bg-border" />
                                    <div className="file-selector-container relative">
                                        <button
                                            type="button"
                                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                            onClick={() => setShowFileSelector(!showFileSelector)}
                                        >
                                            <span className="codicon codicon-files"></span>
                                            {allSelected
                                                ? "All files"
                                                : noneSelected
                                                ? "No files"
                                                : `${selectedFiles.length}/${projectFiles.length}`}
                                            <span
                                                className={`codicon codicon-chevron-${
                                                    showFileSelector ? "up" : "down"
                                                } text-[10px]`}
                                            ></span>
                                        </button>
                                    {showFileSelector && (
                                        <Card className="absolute top-full left-0 mt-1 z-20 max-h-64 overflow-hidden flex flex-col min-w-[200px]">
                                            <CardContent className="p-0 flex flex-col">
                                                <div className="p-2 border-b flex gap-2">
                                                    <Input
                                                        type="text"
                                                        placeholder="Search files..."
                                                        value={fileSearchQuery}
                                                        onChange={(e) =>
                                                            setFileSearchQuery(e.target.value)
                                                        }
                                                        className="flex-1 h-7 text-xs"
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={handleSelectAllFiles}
                                                        className="text-xs h-7 px-2"
                                                    >
                                                        All
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={handleDeselectAllFiles}
                                                        className="text-xs h-7 px-2"
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
                                                            const isSelected =
                                                                selectedFiles.includes(file.uri);
                                                            return (
                                                                <div
                                                                    key={file.uri}
                                                                    className="flex items-center space-x-2 p-2 hover:bg-muted cursor-pointer"
                                                                    onClick={() =>
                                                                        handleFileToggle(file.uri)
                                                                    }
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isSelected}
                                                                        onChange={() =>
                                                                            handleFileToggle(file.uri)
                                                                        }
                                                                        className="h-4 w-4 rounded border border-input"
                                                                    />
                                                                    <span className="text-sm flex-1">
                                                                        {file.name}
                                                                    </span>
                                                                    <Badge
                                                                        variant="outline"
                                                                        className="text-xs"
                                                                    >
                                                                        {file.type === "source"
                                                                            ? "Source"
                                                                            : "Target"}
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
                                </>
                            )}

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* Action buttons */}
                            <div className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    variant={isReplaceExpanded ? "secondary" : "ghost"}
                                    size="sm"
                                    onClick={() => setIsReplaceExpanded(!isReplaceExpanded)}
                                    className="h-7 px-2 text-xs"
                                    aria-label="Toggle replace"
                                    aria-expanded={isReplaceExpanded}
                                >
                                    <span className="codicon codicon-replace"></span>
                                    <span className="ml-1">Replace</span>
                                </Button>

                                {verses.length > 0 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={onPinAll}
                                        className="h-7 px-2 text-xs"
                                        aria-label="Pin all results"
                                    >
                                        <span className="codicon codicon-pin"></span>
                                        <span className="ml-1">Pin All</span>
                                    </Button>
                                )}
                            </div>
                        </div>

                        {isReplaceExpanded && (
                            <div className="border-t pt-4 space-y-3">
                                <div>
                                    <label
                                        htmlFor="replace-text"
                                        className="text-sm font-medium mb-2 block"
                                    >
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
                                                    <span>
                                                        {replaceProgress.completed} of{" "}
                                                        {replaceProgress.total}
                                                    </span>
                                                </div>
                                                <div className="w-full bg-muted rounded-full h-2">
                                                    <div
                                                        className="bg-primary h-2 rounded-full transition-all duration-300"
                                                        style={{
                                                            width: `${
                                                                (replaceProgress.completed /
                                                                    replaceProgress.total) *
                                                                100
                                                            }%`,
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {(() => {
                                            const replaceableCount =
                                                replaceText.trim() && lastQuery.trim()
                                                    ? verses.filter((v) =>
                                                          canReplaceInHtml(
                                                              v.targetCell.content || "",
                                                              lastQuery
                                                          )
                                                      ).length
                                                    : verses.length;
                                            const skippedCount = verses.length - replaceableCount;

                                            return (
                                                <div className="flex items-center gap-3">
                                                    <div className="flex items-center space-x-2 flex-1">
                                                        <input
                                                            type="checkbox"
                                                            id="retain-validations-replace-all"
                                                            checked={retainValidations}
                                                            onChange={(e) =>
                                                                setRetainValidations(
                                                                    e.target.checked
                                                                )
                                                            }
                                                            className="h-4 w-4 rounded border border-input text-primary"
                                                        />
                                                        <label
                                                            htmlFor="retain-validations-replace-all"
                                                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                                        >
                                                            Retain my validations
                                                        </label>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="default"
                                                        size="sm"
                                                        onClick={handleReplaceAll}
                                                        className="flex-shrink-0"
                                                        disabled={
                                                            !!replaceProgress ||
                                                            replaceableCount === 0
                                                        }
                                                        aria-label="Replace all matches"
                                                        title={
                                                            skippedCount > 0
                                                                ? `${skippedCount} match(es) interrupted by HTML - will be skipped`
                                                                : undefined
                                                        }
                                                    >
                                                        <span className="codicon codicon-replace mr-2"></span>
                                                        Replace All ({replaceableCount}
                                                        {skippedCount > 0
                                                            ? `/${verses.length}`
                                                            : ""}
                                                        )
                                                    </Button>
                                                </div>
                                            );
                                        })()}
                                        {replaceErrors.length > 0 && (
                                            <div className="text-xs text-destructive space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <span>
                                                        {replaceErrors.length} error(s) occurred
                                                    </span>
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
                                                    <div
                                                        key={idx}
                                                        className="text-muted-foreground"
                                                    >
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

                    </form>
                </CardContent>
            </Card>

            {verses.length > 0 && (
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                            {showPinnedOnly ? "Pinned Results" : "Search Results"}
                        </span>
                        <Badge variant="secondary">{sortedVerses.length}</Badge>
                    </div>
                    {pinnedVerses.length > 0 && (
                        <button
                            type="button"
                            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={onTogglePinnedFilter}
                            aria-label={showPinnedOnly ? "Show all results" : "Show pinned only"}
                            title={showPinnedOnly ? "Show all results" : "Show pinned only"}
                        >
                            <span className="text-sm text-muted-foreground">Pinned:</span>
                            <Badge variant={showPinnedOnly ? "default" : "outline"}>
                                {pinnedVerses.length}
                            </Badge>
                        </button>
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
                    sortedVerses.map((item, index) => {
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
                                retainValidations={retainValidations}
                                onReplace={
                                    onReplaceCell ||
                                    ((cellId, currentContent, retainValidations) => {
                                        vscode.postMessage({
                                            command: "replaceCell",
                                            cellId: cellId,
                                            query: lastQuery,
                                            replaceText: replaceText,
                                            retainValidations: retainValidations,
                                        });
                                    })
                                }
                            />
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default SearchTab;
