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

function ParallelView() {
    const [verses, setVerses] = useState<TranslationPair[]>([]);
    const [pinnedVerses, setPinnedVerses] = useState<TranslationPair[]>([]);
    const [lastQuery, setLastQuery] = useState<string>("");
    const [replaceText, setReplaceText] = useState<string>("");
    const [completeOnly, setCompleteOnly] = useState<boolean>(false);

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
        
        // Only re-search when transitioning from no replace text to having replace text
        if (!hadReplaceText && hasReplaceText && lastQuery.trim() && verses.length > 0) {
            searchBoth(lastQuery, replaceText);
        }
        
        prevReplaceTextRef.current = replaceText;
    }, [replaceText]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
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
