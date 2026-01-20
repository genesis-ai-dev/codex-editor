import React, { useState, useEffect, useRef } from "react";
import SearchTab from "./SearchTab";
import { TranslationPair } from "../../../../types";
import { WebviewHeader } from "../components/WebviewHeader";
import { stripHtml, escapeRegex, replaceTextPreservingHtml, canReplaceInHtml } from "./utils";
import "./ParallelView.css";

const vscode = acquireVsCodeApi();

export interface OpenFileMessage {
    command: "openFileAtLocation";
    uri: string;
    word: string;
}

interface ProjectFile {
    uri: string;
    name: string;
    type: "source" | "target";
}

function ParallelView() {
    const [verses, setVerses] = useState<TranslationPair[]>([]);
    const [pinnedVerses, setPinnedVerses] = useState<TranslationPair[]>([]);
    const [lastQuery, setLastQuery] = useState<string>("");
    const [replaceText, setReplaceText] = useState<string>("");
    const [completeOnly, setCompleteOnly] = useState<boolean>(false);
    const [searchScope, setSearchScope] = useState<"both" | "source" | "target">("both");
    const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]); // Array of file URIs
    const [replaceProgress, setReplaceProgress] = useState<{
        completed: number;
        total: number;
    } | null>(null);
    const [replaceErrors, setReplaceErrors] = useState<Array<{ cellId: string; error: string }>>(
        []
    );

    const dedupeByCellId = (items: TranslationPair[]) => {
        const seen = new Set<string>();
        return items.filter((item) => {
            if (seen.has(item.cellId)) {
                return false;
            }
            seen.add(item.cellId);
            return true;
        });
    };

    // Track previous values to detect changes
    const prevSearchParamsRef = useRef({
        query: "",
        replaceText: "",
        completeOnly: false,
        searchScope: "both" as "both" | "source" | "target",
        selectedFiles: [] as string[],
    });
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasSearchedRef = useRef(false);

    // Single consolidated effect for all search triggers
    useEffect(() => {
        const prev = prevSearchParamsRef.current;
        const hasQuery = lastQuery.trim().length > 0;

        // Determine what changed
        const queryChanged = prev.query !== lastQuery;
        const replaceTextAdded = !prev.replaceText.trim() && replaceText.trim();
        const completeOnlyChanged = prev.completeOnly !== completeOnly;
        const searchScopeChanged = prev.searchScope !== searchScope;
        const selectedFilesChanged =
            JSON.stringify(prev.selectedFiles) !== JSON.stringify(selectedFiles);

        // Update previous values
        prevSearchParamsRef.current = {
            query: lastQuery,
            replaceText,
            completeOnly,
            searchScope,
            selectedFiles,
        };

        // Only trigger search if we have a query and something relevant changed
        const shouldSearch =
            hasQuery &&
            (queryChanged ||
                replaceTextAdded ||
                completeOnlyChanged ||
                searchScopeChanged ||
                selectedFilesChanged) &&
            (hasSearchedRef.current || queryChanged);

        if (!shouldSearch) {
            return;
        }

        // Clear any pending search
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        // Debounce: 300ms for query changes, immediate for settings changes
        const debounceMs = queryChanged ? 300 : 0;

        searchTimeoutRef.current = setTimeout(() => {
            hasSearchedRef.current = true;
            vscode.postMessage({
                command: "search",
                query: lastQuery,
                replaceText: replaceText || "",
                completeOnly: completeOnly,
                searchScope: searchScope,
                selectedFiles:
                    selectedFiles.length === projectFiles.length ? [] : selectedFiles,
            });
        }, debounceMs);

        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [lastQuery, replaceText, completeOnly, searchScope, selectedFiles, projectFiles.length]);

    // Request project files on mount and clear replace text
    useEffect(() => {
        vscode.postMessage({
            command: "getProjectFiles",
        });
        // Clear replace text on webview load
        setReplaceText("");
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "projectFiles": {
                    const files = message.data as ProjectFile[];
                    setProjectFiles(files);
                    // Default: select all files (only if we haven't initialized yet)
                    if (files.length > 0) {
                        setSelectedFiles((prev) =>
                            prev.length === 0 ? files.map((f) => f.uri) : prev
                        );
                    }
                    break;
                }
                case "searchResults": {
                    let results = message.data as TranslationPair[];
                    results = dedupeByCellId(results);
                    // Backend already filters for replace mode, so no need to filter again here
                    // Remove duplicates - don't include pinned verses that are already in results
                    const pinnedNotInResults = pinnedVerses.filter(
                        (pinned) => !results.some((r) => r.cellId === pinned.cellId)
                    );
                    setVerses(dedupeByCellId([...pinnedNotInResults, ...results]));
                    break;
                }
                case "cellReplaced": {
                    const { cellId, translationPair, success, error, shouldReSearch } =
                        message.data;
                    if (success && translationPair) {
                        // Update the cell with new content (it will no longer match the search query)
                        setVerses((prev) =>
                            prev.map((v) => (v.cellId === cellId ? translationPair : v))
                        );
                        setPinnedVerses((prev) =>
                            prev.map((v) => (v.cellId === cellId ? translationPair : v))
                        );
                        // Re-search after index update to refresh results
                        if (shouldReSearch && lastQuery.trim()) {
                            setTimeout(() => {
                                searchBoth(lastQuery, replaceText);
                            }, 500);
                        }
                    }
                    break;
                }
                case "replaceAllProgress": {
                    const { completed, total } = message.data;
                    setReplaceProgress({ completed, total });
                    break;
                }
                case "replaceAllComplete": {
                    const { successCount, totalCount, updatedPairs, errors } = message.data;
                    setReplaceProgress(null);
                    setReplaceErrors(errors || []);

                    if (updatedPairs && updatedPairs.length > 0) {
                        // Update replaced cells with new content (they will no longer match the search query)
                        const updatedMap = new Map<string, TranslationPair>(
                            updatedPairs.map((p: TranslationPair) => [p.cellId, p])
                        );
                        setVerses((prev) => prev.map((v) => updatedMap.get(v.cellId) ?? v));
                        setPinnedVerses((prev) => prev.map((v) => updatedMap.get(v.cellId) ?? v));
                    }

                    // Re-search after index update to refresh results (replaced items won't appear anymore)
                    if (lastQuery.trim() && successCount > 0) {
                        setTimeout(() => {
                            searchBoth(lastQuery, replaceText);
                        }, 500);
                    }
                    break;
                }
                case "cellsReplaced": {
                    const updatedPairs = message.data as TranslationPair[];
                    const updatedMap = new Map<string, TranslationPair>(
                        updatedPairs.map((p) => [p.cellId, p])
                    );
                    setVerses((prev) => prev.map((v) => updatedMap.get(v.cellId) ?? v));
                    setPinnedVerses((prev) => prev.map((v) => updatedMap.get(v.cellId) ?? v));
                    break;
                }
                case "pinCell": {
                    // Check if the cell is already pinned
                    const isAlreadyPinned = pinnedVerses.some(
                        (verse) => verse.cellId === message.data.cellId
                    );

                    if (isAlreadyPinned) {
                        // Remove the verse if it's already pinned
                        setPinnedVerses((prev) =>
                            prev.filter((verse) => verse.cellId !== message.data.cellId)
                        );
                        // Also update verses to remove the unpinned cell
                        setVerses((prev) =>
                            prev.filter((verse) => verse.cellId !== message.data.cellId)
                        );
                    } else {
                        // Add the new verse if it's not already pinned
                        setPinnedVerses((prev) => [...prev, message.data]);
                        setVerses((prev) => {
                            const exists = prev.some(
                                (verse) => verse.cellId === message.data.cellId
                            );
                            if (!exists) {
                                return [...prev, message.data];
                            }
                            return prev;
                        });
                    }
                    break;
                }
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [pinnedVerses, lastQuery, replaceText]);

    const handleUriClick = (uri: string, word: string) => {
        console.log("handleUriClick", uri, word);
        vscode.postMessage({
            command: "openFileAtLocation",
            uri,
            word: word,
        } as OpenFileMessage);
    };

    // Trigger an explicit search (e.g., from form submit or re-search after replace)
    const searchBoth = (query: string, replaceTextOverride?: string, event?: React.FormEvent) => {
        if (event) {
            event.preventDefault();
        }
        // Mark that we've searched, so settings changes will trigger re-search
        hasSearchedRef.current = true;
        setLastQuery(query);
        // Send search immediately (bypasses debounce for explicit searches)
        vscode.postMessage({
            command: "search",
            query: query,
            replaceText: replaceTextOverride ?? replaceText ?? "",
            completeOnly: completeOnly,
            searchScope: searchScope,
            selectedFiles: selectedFiles.length === projectFiles.length ? [] : selectedFiles,
        });
    };

    const computeReplacement = (content: string, query: string, replacement: string): string => {
        // Use replaceTextPreservingHtml to keep HTML structure intact
        return replaceTextPreservingHtml(content, query, replacement);
    };

    const handleReplaceAll = (retainValidations: boolean) => {
        if (!replaceText.trim() || !lastQuery.trim() || verses.length === 0) return;

        // Only include replacements that can actually be replaced (not interrupted by HTML)
        const replacements = verses
            .filter((v) => canReplaceInHtml(v.targetCell.content || "", lastQuery))
            .map((v) => ({
                cellId: v.cellId,
                newContent: computeReplacement(v.targetCell.content || "", lastQuery, replaceText),
            }));

        const skippedCount = verses.length - replacements.length;

        if (replacements.length === 0) {
            vscode.postMessage({
                command: "showErrorMessage",
                message: "No replaceable matches found. Some matches are interrupted by HTML tags.",
            });
            return;
        }

        // Proceed with replacement - if some are skipped, we'll show an info message after completion
        vscode.postMessage({
            command: "replaceAll",
            replacements: replacements,
            selectedFiles: selectedFiles.length === projectFiles.length ? [] : selectedFiles, // Empty = all files
            skippedCount: skippedCount, // Pass skipped count for optional info message
            retainValidations: retainValidations,
        });
    };

    const handleReplaceCell = (
        cellId: string,
        currentContent: string,
        retainValidations: boolean
    ) => {
        if (!replaceText.trim() || !lastQuery.trim()) return;

        const newContent = computeReplacement(currentContent, lastQuery, replaceText);

        vscode.postMessage({
            command: "replaceCell",
            cellId: cellId,
            newContent: newContent,
            selectedFiles: selectedFiles.length === projectFiles.length ? [] : selectedFiles, // Empty = all files
            retainValidations: retainValidations,
        });
    };

    const handlePinToggle = (item: TranslationPair, isPinned: boolean) => {
        if (isPinned) {
            setPinnedVerses((prev) => dedupeByCellId([...prev, item]));
        } else {
            setPinnedVerses((prev) => prev.filter((v) => v.cellId !== item.cellId));
        }
    };

    const handlePinAll = () => {
        const unpinnedVerses = verses.filter(
            (verse) => !pinnedVerses.some((pinned) => pinned.cellId === verse.cellId)
        );
        setPinnedVerses((prev) => dedupeByCellId([...prev, ...unpinnedVerses]));
    };

    return (
        <div className="parallel-view">
            <WebviewHeader title="Parallel View" vscode={vscode} />
            <SearchTab
                verses={verses}
                pinnedVerses={pinnedVerses}
                lastQuery={lastQuery}
                onQueryChange={setLastQuery}
                onSearch={searchBoth}
                onPinToggle={handlePinToggle}
                onUriClick={handleUriClick}
                completeOnly={completeOnly}
                onCompleteOnlyChange={setCompleteOnly}
                searchScope={searchScope}
                onSearchScopeChange={setSearchScope}
                projectFiles={projectFiles}
                selectedFiles={selectedFiles}
                onSelectedFilesChange={setSelectedFiles}
                onPinAll={handlePinAll}
                onReplaceAll={handleReplaceAll}
                replaceText={replaceText}
                onReplaceTextChange={setReplaceText}
                onReplaceCell={handleReplaceCell}
                replaceProgress={replaceProgress}
                replaceErrors={replaceErrors}
                onClearReplaceErrors={() => setReplaceErrors([])}
                vscode={vscode}
            />
        </div>
    );
}

export default ParallelView;
