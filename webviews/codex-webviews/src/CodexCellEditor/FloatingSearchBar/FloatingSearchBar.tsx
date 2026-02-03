import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ChevronUp, ChevronDown, X, Replace, ChevronRight, Files } from "lucide-react";
import { QuillCellContent } from "../../../../../types";
import "./floatingSearchBar.css";

// Strip HTML tags for plain text search
const stripHtml = (html: string): string => {
    if (!html) return "";
    if (typeof document !== "undefined") {
        try {
            const doc = new DOMParser().parseFromString(html, "text/html");
            return doc.body.textContent || "";
        } catch {
            // Fall through to regex
        }
    }
    return html.replace(/<[^>]*>/g, "");
};

// Escape regex special characters
const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Highlight class name for search matches
const HIGHLIGHT_CLASS = "floating-search-highlight";
const HIGHLIGHT_CURRENT_CLASS = "floating-search-highlight-current";

/**
 * Apply search highlights to the DOM by wrapping matched text in <mark> elements
 * When replaceText is provided, shows inline diff preview (old struck through, new highlighted)
 */
const applyDomHighlights = (
    query: string,
    matchCase: boolean,
    currentMatchCellId: string | null,
    currentMatchInCellIndex: number,
    replaceText?: string,
    isReplaceExpanded?: boolean
) => {
    // First, remove any existing highlights
    removeDomHighlights();

    if (!query.trim()) return;

    const showDiff = isReplaceExpanded && replaceText !== undefined;

    // Find all cell content elements - look for .cell-content inside elements with data-cell-id
    const cellContainers = document.querySelectorAll("[data-cell-id]");

    const searchFlags = matchCase ? "g" : "gi";
    const regex = new RegExp(`(${escapeRegex(query)})`, searchFlags);

    cellContainers.forEach((container) => {
        const cellId = container.getAttribute("data-cell-id");
        if (!cellId) return;

        // Find the cell-content element within this container
        const contentElement = container.querySelector(".cell-content");
        if (!contentElement) return;

        let matchCountInCell = 0;

        // Walk text nodes and highlight matches
        const walker = document.createTreeWalker(contentElement, NodeFilter.SHOW_TEXT, null);
        const textNodes: Text[] = [];
        let node: Text | null;

        while ((node = walker.nextNode() as Text)) {
            textNodes.push(node);
        }

        textNodes.forEach((textNode) => {
            const text = textNode.textContent || "";
            if (!regex.test(text)) return;

            // Reset regex lastIndex
            regex.lastIndex = 0;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;

            while ((match = regex.exec(text)) !== null) {
                // Add text before the match
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                const isCurrent = cellId === currentMatchCellId && matchCountInCell === currentMatchInCellIndex;

                if (showDiff) {
                    // Show inline diff: old text struck through, new text highlighted
                    const diffContainer = document.createElement("span");
                    diffContainer.className = `${HIGHLIGHT_CLASS} floating-search-diff${isCurrent ? ` ${HIGHLIGHT_CURRENT_CLASS}` : ""}`;

                    // Old text (struck through)
                    const oldSpan = document.createElement("span");
                    oldSpan.className = "diff-removed";
                    oldSpan.textContent = match[1];
                    diffContainer.appendChild(oldSpan);

                    // New text (highlighted green)
                    if (replaceText) {
                        const newSpan = document.createElement("span");
                        newSpan.className = "diff-added";
                        newSpan.textContent = replaceText;
                        diffContainer.appendChild(newSpan);
                    }

                    fragment.appendChild(diffContainer);
                } else {
                    // Regular highlight (no diff)
                    const mark = document.createElement("mark");
                    mark.className = HIGHLIGHT_CLASS;
                    mark.textContent = match[1];

                    if (isCurrent) {
                        mark.classList.add(HIGHLIGHT_CURRENT_CLASS);
                    }

                    fragment.appendChild(mark);
                }

                lastIndex = regex.lastIndex;
                matchCountInCell++;
            }

            // Add remaining text
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            // Replace the text node with the fragment
            textNode.parentNode?.replaceChild(fragment, textNode);
        });
    });
};

/**
 * Remove all search highlights from the DOM
 */
const removeDomHighlights = () => {
    const highlights = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    highlights.forEach((element) => {
        const parent = element.parentNode;
        if (parent) {
            // For diff elements, only restore the original text (from diff-removed span)
            // Regular highlights just use textContent directly
            let originalText: string;
            const diffRemoved = element.querySelector(".diff-removed");
            if (diffRemoved) {
                // This is a diff element - only restore the original (removed) text
                originalText = diffRemoved.textContent || "";
            } else {
                // Regular highlight - use full text content
                originalText = element.textContent || "";
            }
            parent.replaceChild(document.createTextNode(originalText), element);
            parent.normalize(); // Merge adjacent text nodes
        }
    });
};

export interface SearchMatch {
    cellId: string;
    cellIndex: number;
    matchIndex: number; // Which match within the cell (0-indexed)
    startOffset: number;
    endOffset: number;
}

interface FloatingSearchBarProps {
    isOpen: boolean;
    onClose: () => void;
    translationUnits: QuillCellContent[];
    onNavigateToCell: (cellId: string) => void;
    onReplaceInCell: (cellId: string, oldContent: string, newContent: string) => void;
    currentMilestoneIndex: number;
    totalMilestones: number;
    onNavigateToMilestone: (milestoneIndex: number, subsectionIndex: number) => void;
    // For cross-page search
    onRequestMatchCounts: (query: string, matchCase: boolean) => void;
    milestoneMatchCounts: { [milestoneIdx: number]: number };
    totalDocumentMatches: number;
    vscode: { postMessage: (message: unknown) => void };
    // Source files are read-only, so hide replace option
    isSourceText?: boolean;
}

export const FloatingSearchBar: React.FC<FloatingSearchBarProps> = ({
    isOpen,
    onClose,
    translationUnits,
    onNavigateToCell,
    onReplaceInCell,
    currentMilestoneIndex,
    totalMilestones,
    onNavigateToMilestone,
    onRequestMatchCounts,
    milestoneMatchCounts,
    totalDocumentMatches,
    vscode,
    isSourceText = false,
}) => {
    const [query, setQuery] = useState("");
    const [replaceText, setReplaceText] = useState("");
    const [isReplaceExpanded, setIsReplaceExpanded] = useState(false);
    const [matchCase, setMatchCase] = useState(false);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [pageMatches, setPageMatches] = useState<SearchMatch[]>([]);
    const [globalMatchIndex, setGlobalMatchIndex] = useState(0);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const replaceInputRef = useRef<HTMLInputElement>(null);

    // Find matches on the current page
    const findMatchesOnPage = useCallback(
        (searchQuery: string, cells: QuillCellContent[]): SearchMatch[] => {
            if (!searchQuery.trim()) return [];

            const matches: SearchMatch[] = [];
            const normalizedQuery = matchCase ? searchQuery : searchQuery.toLowerCase();

            cells.forEach((cell, cellIndex) => {
                const plainText = stripHtml(cell.cellContent);
                const searchText = matchCase ? plainText : plainText.toLowerCase();
                let startIndex = 0;
                let matchIdx = 0;

                while ((startIndex = searchText.indexOf(normalizedQuery, startIndex)) !== -1) {
                    const cellId = cell.cellMarkers?.[0] || `cell-${cellIndex}`;
                    matches.push({
                        cellId,
                        cellIndex,
                        matchIndex: matchIdx,
                        startOffset: startIndex,
                        endOffset: startIndex + searchQuery.length,
                    });
                    startIndex += searchQuery.length;
                    matchIdx++;
                }
            });

            return matches;
        },
        [matchCase]
    );

    // Update page matches when query or cells change
    useEffect(() => {
        const matches = findMatchesOnPage(query, translationUnits);
        setPageMatches(matches);
        setCurrentMatchIndex(0);

        // Request total match counts from extension
        if (query.trim()) {
            onRequestMatchCounts(query, matchCase);
        }
    }, [query, matchCase, translationUnits, findMatchesOnPage, onRequestMatchCounts]);

    // Calculate global match index based on milestones before current
    const calculateGlobalIndex = useCallback(
        (localIndex: number): number => {
            let globalIdx = 0;
            // Count matches in milestones before current
            for (let i = 0; i < currentMilestoneIndex; i++) {
                globalIdx += milestoneMatchCounts[i] || 0;
            }
            // Add local index
            return globalIdx + localIndex + 1; // 1-indexed for display
        },
        [currentMilestoneIndex, milestoneMatchCounts]
    );

    // Update global index when local index or milestone changes
    useEffect(() => {
        if (pageMatches.length > 0) {
            setGlobalMatchIndex(calculateGlobalIndex(currentMatchIndex));
        } else {
            setGlobalMatchIndex(0);
        }
    }, [currentMatchIndex, pageMatches, calculateGlobalIndex]);

    // Auto-focus search input when opened
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            searchInputRef.current.focus();
            searchInputRef.current.select();
        }
    }, [isOpen]);

    // Navigate to current match
    useEffect(() => {
        if (pageMatches.length > 0 && currentMatchIndex < pageMatches.length) {
            const match = pageMatches[currentMatchIndex];
            onNavigateToCell(match.cellId);
        }
    }, [currentMatchIndex, pageMatches, onNavigateToCell]);

    // Apply DOM highlighting when search state changes
    useEffect(() => {
        if (!isOpen) {
            removeDomHighlights();
            return;
        }

        // Small delay to allow DOM to update after navigation
        const timeoutId = setTimeout(() => {
            const currentMatch = pageMatches[currentMatchIndex];
            applyDomHighlights(
                query,
                matchCase,
                currentMatch?.cellId || null,
                currentMatch?.matchIndex ?? 0, // Pass the match index within the cell
                replaceText,
                isReplaceExpanded
            );
        }, 50);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [isOpen, query, matchCase, pageMatches, currentMatchIndex, replaceText, isReplaceExpanded]);

    // Clean up highlights when component unmounts or closes
    useEffect(() => {
        return () => {
            removeDomHighlights();
        };
    }, []);

    // Find next milestone with matches
    const findNextMilestoneWithMatches = useCallback(
        (direction: "next" | "prev"): number | null => {
            const milestoneIndices = Object.keys(milestoneMatchCounts)
                .map(Number)
                .sort((a, b) => a - b);

            if (direction === "next") {
                for (const idx of milestoneIndices) {
                    if (idx > currentMilestoneIndex && milestoneMatchCounts[idx] > 0) {
                        return idx;
                    }
                }
            } else {
                for (let i = milestoneIndices.length - 1; i >= 0; i--) {
                    const idx = milestoneIndices[i];
                    if (idx < currentMilestoneIndex && milestoneMatchCounts[idx] > 0) {
                        return idx;
                    }
                }
            }
            return null;
        },
        [currentMilestoneIndex, milestoneMatchCounts]
    );

    // Navigate to next/previous match
    const navigateMatch = useCallback(
        (direction: "next" | "prev") => {
            if (pageMatches.length === 0) {
                // No matches on current page, try to find next milestone with matches
                const nextMilestone = findNextMilestoneWithMatches(direction);
                if (nextMilestone !== null) {
                    onNavigateToMilestone(nextMilestone, 0);
                }
                return;
            }

            if (direction === "next") {
                if (currentMatchIndex < pageMatches.length - 1) {
                    setCurrentMatchIndex(currentMatchIndex + 1);
                } else {
                    // End of page, go to next milestone with matches
                    const nextMilestone = findNextMilestoneWithMatches("next");
                    if (nextMilestone !== null) {
                        onNavigateToMilestone(nextMilestone, 0);
                        setCurrentMatchIndex(0);
                    } else {
                        // Wrap to beginning
                        const firstMilestoneWithMatches = Object.keys(milestoneMatchCounts)
                            .map(Number)
                            .sort((a, b) => a - b)
                            .find((idx) => milestoneMatchCounts[idx] > 0);
                        if (
                            firstMilestoneWithMatches !== undefined &&
                            firstMilestoneWithMatches !== currentMilestoneIndex
                        ) {
                            onNavigateToMilestone(firstMilestoneWithMatches, 0);
                        }
                        setCurrentMatchIndex(0);
                    }
                }
            } else {
                if (currentMatchIndex > 0) {
                    setCurrentMatchIndex(currentMatchIndex - 1);
                } else {
                    // Beginning of page, go to previous milestone with matches
                    const prevMilestone = findNextMilestoneWithMatches("prev");
                    if (prevMilestone !== null) {
                        onNavigateToMilestone(prevMilestone, 0);
                        // Will need to set to last match after page loads
                    } else {
                        // Wrap to end
                        const lastMilestoneWithMatches = Object.keys(milestoneMatchCounts)
                            .map(Number)
                            .sort((a, b) => b - a)
                            .find((idx) => milestoneMatchCounts[idx] > 0);
                        if (
                            lastMilestoneWithMatches !== undefined &&
                            lastMilestoneWithMatches !== currentMilestoneIndex
                        ) {
                            onNavigateToMilestone(lastMilestoneWithMatches, 0);
                        }
                    }
                }
            }
        },
        [
            pageMatches,
            currentMatchIndex,
            findNextMilestoneWithMatches,
            onNavigateToMilestone,
            milestoneMatchCounts,
            currentMilestoneIndex,
        ]
    );

    // Replace current match
    const replaceCurrentMatch = useCallback(() => {
        if (!replaceText || pageMatches.length === 0) return;

        const match = pageMatches[currentMatchIndex];
        const cell = translationUnits[match.cellIndex];
        if (!cell) return;

        // Perform the replacement in plain text
        const plainText = stripHtml(cell.cellContent);
        const searchQuery = matchCase ? query : query.toLowerCase();
        const searchText = matchCase ? plainText : plainText.toLowerCase();

        // Find the specific match occurrence
        let count = 0;
        let startIdx = 0;
        while (count <= match.matchIndex) {
            startIdx = searchText.indexOf(searchQuery, startIdx);
            if (startIdx === -1) break;
            if (count === match.matchIndex) break;
            startIdx += searchQuery.length;
            count++;
        }

        if (startIdx !== -1) {
            // Build new content with replacement
            const newContent =
                plainText.substring(0, startIdx) +
                replaceText +
                plainText.substring(startIdx + query.length);

            onReplaceInCell(match.cellId, cell.cellContent, newContent);
        }
    }, [
        replaceText,
        pageMatches,
        currentMatchIndex,
        translationUnits,
        query,
        matchCase,
        onReplaceInCell,
    ]);

    // Replace all matches on current page and continue to next pages
    const replaceAll = useCallback(() => {
        if (!replaceText || pageMatches.length === 0) return;

        // Replace all matches on current page (in reverse order to preserve indices)
        const matchesByCell = new Map<number, SearchMatch[]>();
        for (const match of pageMatches) {
            const existing = matchesByCell.get(match.cellIndex) || [];
            existing.push(match);
            matchesByCell.set(match.cellIndex, existing);
        }

        for (const [cellIndex, matches] of matchesByCell) {
            const cell = translationUnits[cellIndex];
            if (!cell) continue;

            let plainText = stripHtml(cell.cellContent);
            const searchRegex = new RegExp(escapeRegex(query), matchCase ? "g" : "gi");
            const newContent = plainText.replace(searchRegex, replaceText);

            if (newContent !== plainText) {
                onReplaceInCell(matches[0].cellId, cell.cellContent, newContent);
            }
        }

        // After replacing on current page, check if there are more pages with matches
        const nextMilestone = findNextMilestoneWithMatches("next");
        if (nextMilestone !== null) {
            // Navigate to next milestone - the search will continue there
            onNavigateToMilestone(nextMilestone, 0);
        }
    }, [
        replaceText,
        pageMatches,
        translationUnits,
        query,
        matchCase,
        onReplaceInCell,
        findNextMilestoneWithMatches,
        onNavigateToMilestone,
    ]);

    // Handle keyboard shortcuts
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
                return;
            }

            if (e.key === "Enter") {
                if (e.shiftKey) {
                    navigateMatch("prev");
                } else {
                    navigateMatch("next");
                }
                e.preventDefault();
                return;
            }

            if (e.key === "F3") {
                if (e.shiftKey) {
                    navigateMatch("prev");
                } else {
                    navigateMatch("next");
                }
                e.preventDefault();
                return;
            }
        },
        [onClose, navigateMatch]
    );

    // Match count display
    const matchCountDisplay = useMemo(() => {
        if (!query.trim()) return "";
        if (totalDocumentMatches === 0) return "No matches";

        const pageMatchCount = pageMatches.length;
        if (pageMatchCount === 0 && totalDocumentMatches > 0) {
            return `0 on page (${totalDocumentMatches} total)`;
        }

        return `${globalMatchIndex} of ${pageMatchCount} of ${totalDocumentMatches}`;
    }, [query, pageMatches.length, globalMatchIndex, totalDocumentMatches]);

    if (!isOpen) return null;

    return (
        <div className="floating-search-bar" onKeyDown={handleKeyDown}>
            {/* Search row */}
            <div className="floating-search-bar-header">
                <div className="floating-search-bar-input-wrapper">
                    <Input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Find..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="floating-search-bar-input"
                    />
                </div>

                <span className="floating-search-bar-match-count">{matchCountDisplay}</span>

                <div className="floating-search-bar-navigation">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigateMatch("prev")}
                        disabled={totalDocumentMatches === 0}
                        title="Previous match (Shift+Enter)"
                    >
                        <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigateMatch("next")}
                        disabled={totalDocumentMatches === 0}
                        title="Next match (Enter)"
                    >
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        // Open Parallel Passages with current search query and replace text
                        vscode.postMessage({
                            command: "expandSearchToAllFiles",
                            content: {
                                query,
                                replaceText: isReplaceExpanded ? replaceText : undefined,
                            },
                        });
                        onClose();
                    }}
                    disabled={!query.trim()}
                    title="Search all files (Parallel Passages)"
                >
                    <Files className="h-4 w-4" />
                </Button>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                    className="floating-search-bar-close"
                    title="Close (Escape)"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Options row */}
            <div className="floating-search-bar-options">
                <label className="floating-search-bar-checkbox">
                    <input
                        type="checkbox"
                        checked={matchCase}
                        onChange={(e) => setMatchCase(e.target.checked)}
                    />
                    Match case
                </label>

                {/* Hide replace option for source files (read-only) */}
                {!isSourceText && (
                    <button
                        className="floating-search-bar-replace-toggle"
                        onClick={() => setIsReplaceExpanded(!isReplaceExpanded)}
                    >
                        <ChevronRight
                            className={`h-4 w-4 transition-transform ${
                                isReplaceExpanded ? "rotate-90" : ""
                            }`}
                        />
                        Replace
                    </button>
                )}
            </div>

            {/* Replace section - only for target files */}
            {!isSourceText && isReplaceExpanded && (
                <div className="floating-search-bar-replace">
                    <div className="floating-search-bar-replace-content">
                        <Input
                            ref={replaceInputRef}
                            type="text"
                            placeholder="Replace with..."
                            value={replaceText}
                            onChange={(e) => setReplaceText(e.target.value)}
                            className="floating-search-bar-replace-input"
                        />
                        <div className="floating-search-bar-replace-actions">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={replaceCurrentMatch}
                                disabled={!replaceText || pageMatches.length === 0}
                            >
                                <Replace className="h-4 w-4 mr-1" />
                                Replace
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={replaceAll}
                                disabled={!replaceText || totalDocumentMatches === 0}
                            >
                                Replace All
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FloatingSearchBar;
