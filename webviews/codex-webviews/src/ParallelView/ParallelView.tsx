import React, { useState, useEffect, useRef } from "react";
import SearchTab from "./SearchTab";
import { TranslationPair } from "../../../../types";
import { WebviewHeader } from "../components/WebviewHeader";
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

    // Re-search when replace text is first added (only if we already have search results)
    const prevReplaceTextRef = useRef<string>("");
    useEffect(() => {
        const hadReplaceText = prevReplaceTextRef.current.trim();
        const hasReplaceText = replaceText.trim();
        
        // When replace text is entered, automatically scope to target text
        if (!hadReplaceText && hasReplaceText && searchScope !== "target") {
            setSearchScope("target");
        }
        
        // Only re-search when transitioning from no replace text to having replace text
        if (!hadReplaceText && hasReplaceText && lastQuery.trim() && verses.length > 0) {
            searchBoth(lastQuery, replaceText);
        }
        
        prevReplaceTextRef.current = replaceText;
    }, [replaceText, searchScope]);

    // Re-search when query changes (if we already have results)
    const prevQueryRef = useRef<string>("");
    useEffect(() => {
        const queryChanged = prevQueryRef.current !== lastQuery;
        const hasQuery = lastQuery.trim().length > 0;
        const hasResults = verses.length > 0;
        
        // Auto-search if query changed and we either have results or had a previous query
        if (queryChanged && hasQuery && (hasResults || prevQueryRef.current.trim().length > 0)) {
            const timeoutId = setTimeout(() => {
                searchBoth(lastQuery, replaceText);
            }, 300); // Debounce by 300ms
            
            return () => clearTimeout(timeoutId);
        }
        
        prevQueryRef.current = lastQuery;
    }, [lastQuery, verses.length, replaceText, searchScope]);

    // Re-search when completeOnly setting changes (if we already have search results)
    const prevCompleteOnlyRef = useRef<boolean>(false);
    useEffect(() => {
        const settingChanged = prevCompleteOnlyRef.current !== completeOnly;
        const hasQuery = lastQuery.trim().length > 0;
        const hasResults = verses.length > 0;
        
        // Auto-search if setting changed and we have an active search
        if (settingChanged && hasQuery && hasResults) {
            searchBoth(lastQuery, replaceText);
        }
        
        prevCompleteOnlyRef.current = completeOnly;
    }, [completeOnly, lastQuery, verses.length, replaceText, searchScope]);

    // Re-search when searchScope setting changes (if we already have search results)
    const prevSearchScopeRef = useRef<"both" | "source" | "target">("both");
    useEffect(() => {
        const settingChanged = prevSearchScopeRef.current !== searchScope;
        const hasQuery = lastQuery.trim().length > 0;
        const hasResults = verses.length > 0;
        
        // Auto-search if setting changed and we have an active search
        if (settingChanged && hasQuery && hasResults) {
            searchBoth(lastQuery, replaceText);
        }
        
        prevSearchScopeRef.current = searchScope;
    }, [searchScope, lastQuery, verses.length, replaceText]);

    // Re-search when selectedFiles changes (if we already have search results)
    const prevSelectedFilesRef = useRef<string[]>([]);
    useEffect(() => {
        const filesChanged = JSON.stringify(prevSelectedFilesRef.current) !== JSON.stringify(selectedFiles);
        const hasQuery = lastQuery.trim().length > 0;
        const hasResults = verses.length > 0;
        
        // Auto-search if files changed and we have an active search
        if (filesChanged && hasQuery && hasResults) {
            searchBoth(lastQuery, replaceText);
        }
        
        prevSelectedFilesRef.current = selectedFiles;
    }, [selectedFiles, lastQuery, verses.length, replaceText]);

    // Request project files on mount
    useEffect(() => {
        vscode.postMessage({
            command: "getProjectFiles",
        });
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
                        setSelectedFiles(prev => prev.length === 0 ? files.map(f => f.uri) : prev);
                    }
                    break;
                }
                case "searchResults": {
                    let results = message.data as TranslationPair[];
                    results = dedupeByCellId(results);
                    // In replace mode, filter to only cells that actually contain the query in target text
                    if (replaceText && lastQuery.trim()) {
                        const stripHtml = (html: string): string => {
                            const doc = new DOMParser().parseFromString(html, "text/html");
                            return (doc.body.textContent || "").toLowerCase();
                        };
                        const queryLower = lastQuery.toLowerCase();
                        results = results.filter(pair => {
                            if (!pair.targetCell.content) return false;
                            const cleanTarget = stripHtml(pair.targetCell.content);
                            return cleanTarget.includes(queryLower);
                        });
                    }
                    // Remove duplicates - don't include pinned verses that are already in results
                    const pinnedNotInResults = pinnedVerses.filter(
                        pinned => !results.some(r => r.cellId === pinned.cellId)
                    );
                    setVerses(dedupeByCellId([...pinnedNotInResults, ...results]));
                    break;
                }
                case "cellReplaced": {
                    const { cellId, translationPair } = message.data;
                    setVerses((prev) =>
                        prev.map((v) => (v.cellId === cellId ? translationPair : v))
                    );
                    setPinnedVerses((prev) =>
                        prev.map((v) => (v.cellId === cellId ? translationPair : v))
                    );
                    break;
                }
                case "cellsReplaced": {
                    const updatedPairs = message.data as TranslationPair[];
                    const updatedMap = new Map(updatedPairs.map(p => [p.cellId, p]));
                    setVerses((prev) =>
                        prev.map((v) => updatedMap.get(v.cellId) || v)
                    );
                    setPinnedVerses((prev) =>
                        prev.map((v) => updatedMap.get(v.cellId) || v)
                    );
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
    }, [pinnedVerses]);

    const handleUriClick = (uri: string, word: string) => {
        console.log("handleUriClick", uri, word);
        vscode.postMessage({
            command: "openFileAtLocation",
            uri,
            word: word,
        } as OpenFileMessage);
};

    const searchBoth = (query: string, replaceText?: string, event?: React.FormEvent) => {
        if (event) {
            event.preventDefault();
        }
        setLastQuery(query);
        vscode.postMessage({
            command: "search",
            query: query,
            replaceText: replaceText || "",
            completeOnly: completeOnly,
            searchScope: searchScope,
            selectedFiles: selectedFiles.length === projectFiles.length ? [] : selectedFiles, // Empty = all files
        });
    };

    const handleReplaceAll = () => {
        if (!replaceText.trim() || !lastQuery.trim() || verses.length === 0) return;
        
        const stripHtml = (text: string): string => {
            let strippedText = text.replace(/<[^>]*>/g, "");
            strippedText = strippedText.replace(/&nbsp; ?/g, " ");
            strippedText = strippedText.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#34;/g, "");
            strippedText = strippedText.replace(/&#\d+;/g, "");
            strippedText = strippedText.replace(/&[a-zA-Z]+;/g, "");
            return strippedText;
        };
        
        const escapeRegex = (str: string): string => {
            return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        };
        
        const replacements = verses.map(v => {
            const cleanTarget = stripHtml(v.targetCell.content || "");
            const newContent = cleanTarget.replace(new RegExp(escapeRegex(lastQuery), "gi"), replaceText);
            return { cellId: v.cellId, newContent };
        });
        
        vscode.postMessage({
            command: "replaceAll",
            replacements: replacements,
            selectedFiles: selectedFiles.length === projectFiles.length ? [] : selectedFiles, // Empty = all files
        });
    };

    const handleReplaceCell = (cellId: string, currentContent: string) => {
        if (!replaceText.trim() || !lastQuery.trim()) return;
        
        // Compute the replacement using same logic as diff display
        const stripHtml = (text: string): string => {
            let strippedText = text.replace(/<[^>]*>/g, "");
            strippedText = strippedText.replace(/&nbsp; ?/g, " ");
            strippedText = strippedText.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#34;/g, "");
            strippedText = strippedText.replace(/&#\d+;/g, "");
            strippedText = strippedText.replace(/&[a-zA-Z]+;/g, "");
            return strippedText;
        };
        
        const escapeRegex = (str: string): string => {
            return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        };
        
        const cleanTarget = stripHtml(currentContent);
        const newContent = cleanTarget.replace(new RegExp(escapeRegex(lastQuery), "gi"), replaceText);
        
        vscode.postMessage({
            command: "replaceCell",
            cellId: cellId,
            newContent: newContent,
            selectedFiles: selectedFiles.length === projectFiles.length ? [] : selectedFiles, // Empty = all files
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
                vscode={vscode}
            />
        </div>
    );
}

export default ParallelView;
