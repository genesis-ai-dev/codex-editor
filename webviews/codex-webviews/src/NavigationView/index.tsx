import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import bibleData from "../assets/bible-books-lookup.json";
import { Progress } from "../components/ui/progress";
import "../tailwind.css";
import { CodexItem } from "types";
import { Languages, Mic } from "lucide-react";
import { RenameModal } from "../components/RenameModal";

// Declare the acquireVsCodeApi function
declare function acquireVsCodeApi(): any;

// Acquire the VS Code API
const vscode = acquireVsCodeApi();

interface BibleBookInfo {
    name: string;
    abbr: string;
    ord: string;
    testament: string;
    osisId: string;
    [key: string]: any;
}

interface State {
    codexItems: CodexItem[];
    dictionaryItems: CodexItem[];
    expandedGroups: Set<string>;
    previousExpandedGroups: Set<string> | null;
    searchQuery: string;
    bibleBookMap: Map<string, BibleBookInfo> | undefined;
    hasReceivedInitialData: boolean;
    renameModal: {
        isOpen: boolean;
        item: CodexItem | null;
        newName: string;
    };
    bookNameModal: {
        isOpen: boolean;
        item: CodexItem | null;
        newName: string;
    };
}

// Redesigned styles following Jobs/DHH principles: clean, purposeful, delightful
const styles = {
    scrollableContent: {},
    bottomSection: {},
    refreshButton: {},
    itemsContainer: {},
    // Main clickable item container - the entire thing is now clickable
    itemContainer: {
        cursor: "pointer",
        userSelect: "none" as const,
        padding: "0",
        borderRadius: "6px",
        transition: "all 0.15s ease",
        position: "relative" as const,
        backgroundColor: "transparent",
        border: "1px solid transparent",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
            borderColor: "var(--vscode-focusBorder)",
        },
        "&:active": {
            transform: "scale(0.98)",
        },
    },

    childrenContainer: {
        marginLeft: "16px",
        marginTop: "6px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "4px",
    },
    noResults: {},

    toggleButton: {
        padding: "6px 10px",
        borderRadius: "6px",
        border: "1px solid var(--vscode-button-border)",
        backgroundColor: "var(--vscode-button-secondaryBackground)",
        color: "var(--vscode-button-secondaryForeground)",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: "600",
        transition: "all 0.15s ease",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        minWidth: "50px",
        justifyContent: "center",
        "&:hover": {
            backgroundColor: "var(--vscode-button-secondaryHoverBackground)",
            transform: "scale(1.05)",
        },
        "&:active": {
            transform: "scale(0.98)",
        },
    },
};

// Helper function to sort items based on Bible book order or alphanumerically
const sortItems = (a: CodexItem, b: CodexItem) => {
    // If both items have sortOrder (Bible books), sort by that
    if (a.sortOrder && b.sortOrder) {
        return a.sortOrder.localeCompare(b.sortOrder);
    }

    // For corpus items, prioritize OT and NT
    if (a.type === "corpus" && b.type === "corpus") {
        if (a.label === "Old Testament") return -1;
        if (b.label === "Old Testament") return 1;
        if (a.label === "New Testament") return -1;
        if (b.label === "New Testament") return 1;
    }

    // For non-Biblical books, sort by fileDisplayName if available, otherwise by label
    const aDisplayName = a.fileDisplayName || a.label;
    const bDisplayName = b.fileDisplayName || b.label;

    // Extract any numbers from the display names for alphanumeric sorting
    const aMatch = aDisplayName.match(/\d+/);
    const bMatch = bDisplayName.match(/\d+/);

    if (aMatch && bMatch) {
        const aNum = parseInt(aMatch[0]);
        const bNum = parseInt(bMatch[0]);
        if (aNum !== bNum) {
            return aNum - bNum;
        }
    }

    return aDisplayName.localeCompare(bDisplayName);
};

// Helper function to get proper Bible book name or format label nicely
const formatLabel = (label: string, bibleBookMap: Map<string, BibleBookInfo>): string => {
    // If label is empty or undefined, return a fallback
    if (!label || label.trim() === "") {
        return "Unknown File";
    }

    // Check if it's a Bible book abbreviation
    if (bibleBookMap && bibleBookMap.has(label)) {
        return bibleBookMap.get(label)!.name;
    }

    // Handle corpus labels
    if (label === "OT") return "Old Testament";
    if (label === "NT") return "New Testament";

    // Clean up other labels
    let cleanName = label.replace(/_Codex$/, "");
    cleanName = cleanName.replace(/_/g, " ");
    cleanName = cleanName.replace(/([A-Z])/g, " $1").trim();
    cleanName = cleanName.replace(/\s+/g, " ");

    // If the cleaned name is empty, return the original label
    if (!cleanName || cleanName.trim() === "") {
        return label;
    }

    return cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
};

function NavigationView() {
    const [state, setState] = useState<State>({
        codexItems: [],
        dictionaryItems: [],
        expandedGroups: new Set(),
        previousExpandedGroups: null,
        searchQuery: "",
        bibleBookMap: undefined,

        hasReceivedInitialData: false,
        renameModal: {
            isOpen: false,
            item: null,
            newName: "",
        },
        bookNameModal: {
            isOpen: false,
            item: null,
            newName: "",
        },
    });

    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

    // Initialize Bible book map on component mount
    useEffect(() => {
        const bookMap = new Map<string, BibleBookInfo>();
        (bibleData as any[]).forEach((book) => {
            bookMap.set(book.abbr, {
                name: book.name,
                abbr: book.abbr,
                ord: book.ord,
                testament: book.testament,
                osisId: book.osisId,
            });
        });

        setState((prev) => ({
            ...prev,
            bibleBookMap: bookMap,
        }));
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "updateItems":
                    setState((prevState) => {
                        // Process items to add sortOrder for Bible books
                        const processedCodexItems = (message.codexItems || []).map(
                            (item: CodexItem) => {
                                const fileName = item.label.replace(/ Codex$/, "");

                                // Check if it's a Bible book
                                if (prevState.bibleBookMap?.has(fileName)) {
                                    const bookInfo = prevState.bibleBookMap.get(fileName)!;
                                    return {
                                        ...item,
                                        label: fileName,
                                        sortOrder: bookInfo.ord,
                                    };
                                }

                                // Process children if it's a corpus
                                if (item.children) {
                                    const processedChildren = item.children.map(
                                        (child: CodexItem) => {
                                            const childFileName = child.label.replace(
                                                / Codex$/,
                                                ""
                                            );

                                            if (prevState.bibleBookMap?.has(childFileName)) {
                                                const bookInfo =
                                                    prevState.bibleBookMap.get(childFileName)!;
                                                return {
                                                    ...child,
                                                    label: childFileName,
                                                    sortOrder: bookInfo.ord,
                                                };
                                            }

                                            return child;
                                        }
                                    );

                                    return {
                                        ...item,
                                        children: processedChildren,
                                    };
                                }

                                return item;
                            }
                        );

                        return {
                            ...prevState,
                            codexItems: processedCodexItems,
                            dictionaryItems: message.dictionaryItems || [],
                            hasReceivedInitialData: true,
                        };
                    });
                    break;
                case "setBibleBookMap":
                    if (message.data) {
                        try {
                            const newMap = new Map<string, BibleBookInfo>(message.data);
                            setState((prevState) => ({
                                ...prevState,
                                bibleBookMap: newMap,
                            }));
                        } catch (error) {
                            console.error("Error processing bible book map data:", error);
                        }
                    }
                    break;
            }
        };

        window.addEventListener("message", handleMessage);

        // Request initial items when webview is ready
        vscode.postMessage({ command: "webviewReady" });

        return () => window.removeEventListener("message", handleMessage);
    }, []);

    // Auto-expand groups when search results fit without scrolling
    useEffect(() => {
        if (!state.searchQuery) return; // Only run when there's a search query

        const filteredCodexItems = filterItems(state.codexItems);
        const filteredDictionaryItems = filterItems(state.dictionaryItems);

        // Calculate total number of visible items if all groups were expanded
        let totalItems = 0;

        filteredCodexItems.forEach((item) => {
            totalItems += 1; // Group header
            if (item.type === "corpus" && item.children) {
                totalItems += item.children.length; // Child items
            }
        });

        filteredDictionaryItems.forEach((item) => {
            totalItems += 1;
            if (item.type === "corpus" && item.children) {
                totalItems += item.children.length;
            }
        });

        // Estimate if items will fit without scrolling
        // Assuming each item takes about 50px height and container has about 400px usable height
        const estimatedHeight = totalItems * 50;
        const availableHeight = 400; // Approximate available height for items

        if (estimatedHeight <= availableHeight) {
            // Auto-expand all groups that have search results
            setState((prev) => {
                const newExpandedGroups = new Set(prev.expandedGroups);

                // Expand codex groups with results
                filteredCodexItems.forEach((item) => {
                    if (item.type === "corpus" && item.children && item.children.length > 0) {
                        newExpandedGroups.add(item.label);
                    }
                });

                // Expand dictionary groups with results
                filteredDictionaryItems.forEach((item) => {
                    if (item.type === "corpus" && item.children && item.children.length > 0) {
                        newExpandedGroups.add(item.label);
                    }
                });

                return {
                    ...prev,
                    expandedGroups: newExpandedGroups,
                };
            });
        }
    }, [state.searchQuery, state.codexItems, state.dictionaryItems]);

    const toggleGroup = (label: string) => {
        setState((prevState) => {
            const newExpandedGroups = new Set(prevState.expandedGroups);
            if (newExpandedGroups.has(label)) {
                newExpandedGroups.delete(label);
            } else {
                newExpandedGroups.add(label);
            }
            return { ...prevState, expandedGroups: newExpandedGroups };
        });
    };

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newSearchQuery = e.target.value;
        const isSearchStarting = !state.searchQuery && newSearchQuery;
        const isSearchClearing = state.searchQuery && !newSearchQuery;

        setState((prev) => {
            let newExpandedGroups = prev.expandedGroups;
            let newPreviousExpandedGroups = prev.previousExpandedGroups;

            if (isSearchStarting) {
                // Save current expanded state before starting search
                newPreviousExpandedGroups = new Set(prev.expandedGroups);
            } else if (isSearchClearing) {
                // Restore previous expanded state when clearing search
                if (prev.previousExpandedGroups) {
                    newExpandedGroups = new Set(prev.previousExpandedGroups);
                }
                newPreviousExpandedGroups = null;
            }

            return {
                ...prev,
                searchQuery: newSearchQuery,
                expandedGroups: newExpandedGroups,
                previousExpandedGroups: newPreviousExpandedGroups,
            };
        });
    };

    const handleRefresh = () => {
        vscode.postMessage({ command: "refresh" });
    };

    const handleToggleSortOrder = () => {
        setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    };

    const handleDelete = (item: CodexItem) => {
        vscode.postMessage({
            command: "deleteFile",
            uri: item.uri,
            label: item.label,
            type: item.type,
        });
    };

    const handleToggleDictionary = () => {
        vscode.postMessage({
            command: "toggleDictionary",
        });
    };

    const handleAddFiles = () => {
        vscode.postMessage({
            command: "openSourceUpload",
        });
    };

    const handleOpenExport = () => {
        vscode.postMessage({
            command: "openExportView",
        });
    };

    const handleEditBookName = (item: CodexItem) => {
        // Use fileDisplayName from metadata if available, otherwise fall back to formatted label
        const currentDisplayName =
            item.fileDisplayName || formatLabel(item.label, state.bibleBookMap || new Map());
        setState((prev) => ({
            ...prev,
            bookNameModal: {
                isOpen: true,
                item: item,
                newName: currentDisplayName,
            },
        }));
    };

    const handleEditCorpusMarker = (item: CodexItem) => {
        const currentCorpusName =
            item.children?.[0]?.corpusMarker ||
            formatLabel(item.label, state.bibleBookMap || new Map());
        setState((prev) => ({
            ...prev,
            renameModal: {
                isOpen: true,
                item: item,
                newName: prev.renameModal.newName || currentCorpusName,
            },
        }));
    };

    const handleDeleteCorpusMarker = (item: CodexItem) => {
        const displayName =
            item.children?.[0]?.corpusMarker ||
            formatLabel(item.label, state.bibleBookMap || new Map());
        vscode.postMessage({
            command: "deleteCorpusMarker",
            content: {
                corpusLabel: item.label,
                displayName,
                children: item.children?.map((c) => ({
                    uri: c.uri,
                    label: c.label,
                    type: c.type,
                })) ?? [],
            },
        });
    };

    const handleRenameModalClose = () => {
        setState((prev) => ({
            ...prev,
            renameModal: {
                isOpen: false,
                item: null,
                newName: "",
            },
        }));
    };

    const handleRenameModalInputChange = (value: string) => {
        setState((prev) => ({
            ...prev,
            renameModal: {
                ...prev.renameModal,
                newName: value,
            },
        }));
    };

    const handleRenameModalConfirm = () => {
        const { item, newName } = state.renameModal;
        if (item && newName.trim() !== "" && newName.trim() !== item.label) {
            vscode.postMessage({
                command: "editCorpusMarker",
                content: {
                    corpusLabel: item.label,
                    newCorpusName: newName.trim(),
                },
            });
        }
        handleRenameModalClose();
    };

    const handleBookNameModalClose = () => {
        setState((prev) => ({
            ...prev,
            bookNameModal: {
                isOpen: false,
                item: null,
                newName: "",
            },
        }));
    };

    const handleBookNameModalInputChange = (value: string) => {
        setState((prev) => ({
            ...prev,
            bookNameModal: {
                ...prev.bookNameModal,
                newName: value,
            },
        }));
    };

    const handleBookNameModalConfirm = () => {
        const { item, newName } = state.bookNameModal;
        if (item && newName.trim() !== "") {
            // Use fileDisplayName from metadata if available, otherwise fall back to formatted label
            const currentDisplayName =
                item.fileDisplayName || formatLabel(item.label, state.bibleBookMap || new Map());
            if (newName.trim() !== currentDisplayName) {
                vscode.postMessage({
                    command: "editBookName",
                    content: {
                        bookAbbr: item.label,
                        newBookName: newName.trim(),
                    },
                });
            }
        }
        handleBookNameModalClose();
    };

    const openFile = (item: CodexItem) => {
        // Get the file system path from the URI
        const uri = item.uri as string;
        // Extract just the path part from the URI
        const fsPath = uri.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1");

        vscode.postMessage({
            command: "openFile",
            uri: fsPath,
            type: item.type,
        });
    };

    const filterItems = (items: CodexItem[]): CodexItem[] => {
        if (!state.searchQuery) return items;

        const searchLower = state.searchQuery.toLowerCase();

        return items
            .map((item) => {
                if (item.type === "corpus" && item.children) {
                    const filteredChildren = item.children
                        .filter((child) => {
                            const displayName =
                                child.fileDisplayName ||
                                formatLabel(child.label, state.bibleBookMap || new Map());
                            return displayName.toLowerCase().includes(searchLower);
                        })
                        .sort(sortItems);

                    if (filteredChildren.length > 0) {
                        return {
                            ...item,
                            children: filteredChildren,
                        };
                    }
                    return null;
                }

                const displayName =
                    item.fileDisplayName ||
                    formatLabel(item.label, state.bibleBookMap || new Map());
                return displayName.toLowerCase().includes(searchLower) ? item : null;
            })
            .filter((item): item is CodexItem => item !== null);
    };

    const getProgressValues = (progress?: {
        percentTranslationsCompleted?: number;
        percentTextValidatedTranslations?: number;
        percentFullyValidatedTranslations?: number;
        percentAudioTranslationsCompleted?: number;
        percentAudioValidatedTranslations?: number;
        textValidationLevels?: number[];
        audioValidationLevels?: number[];
        requiredTextValidations?: number;
        requiredAudioValidations?: number;
    }) => {
        if (typeof progress !== "object") {
            return {
                textCompletion: 0,
                textValidation: 0,
                audioCompletion: 0,
                audioValidation: 0,
                textValidationLevels: [] as number[],
                audioValidationLevels: [] as number[],
                requiredTextValidations: undefined as number | undefined,
                requiredAudioValidations: undefined as number | undefined,
            };
        }
        const textValidation = Math.max(
            0,
            Math.min(
                100,
                progress.percentTextValidatedTranslations ??
                    progress.percentFullyValidatedTranslations ??
                    0
            )
        );
        const audioValidation = Math.max(
            0,
            Math.min(100, progress.percentAudioValidatedTranslations ?? 0)
        );
        return {
            textCompletion: Math.max(0, Math.min(100, progress.percentTranslationsCompleted ?? 0)),
            textValidation,
            audioCompletion: Math.max(
                0,
                Math.min(100, progress.percentAudioTranslationsCompleted ?? 0)
            ),
            audioValidation,
            textValidationLevels: progress.textValidationLevels ?? [textValidation],
            audioValidationLevels: progress.audioValidationLevels ?? [audioValidation],
            requiredTextValidations: progress.requiredTextValidations,
            requiredAudioValidations: progress.requiredAudioValidations,
        };
    };

    const renderItem = (item: CodexItem) => {
        const isGroup = item.type === "corpus";
        const isExpanded = state.expandedGroups.has(item.label);
        const icon = isGroup ? "library" : item.type === "dictionary" ? "book" : "file";
        const displayLabel =
            item.fileDisplayName || formatLabel(item.label || "", state.bibleBookMap || new Map());
        const itemId = `${item.label || "unknown"}-${item.uri || ""}`;

        const isProjectDict = item.isProjectDictionary;

        // Handle click on the entire item container
        const handleItemClick = (e: React.MouseEvent) => {
            // Don't trigger if clicking on menu button
            if ((e.target as Element).closest(".menu-button")) {
                return;
            }

            if (isGroup) {
                toggleGroup(item.label);
            } else {
                openFile(item);
            }
        };

        // Special rendering for project dictionary
        if (isProjectDict) {
            return (
                <div key={item.label + item.uri}>
                    <div
                        className="flex flex-col gap-2 p-4 bg-vscode-sideBarSectionHeader-background rounded-lg border border-vscode-sideBarSectionHeader-border transition-all duration-200 hover:bg-accent shadow-sm hover:shadow-md cursor-pointer"
                        onClick={handleItemClick}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1.5 text-sm font-semibold text-vscode-foreground">
                                        <i className="codicon codicon-book text-lg text-vscode-symbolIcon-keywordForeground" />
                                        Dictionary
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <i className="codicon codicon-list-ordered" />
                                        <span>{item.wordCount || 0}</span>
                                        <span>•</span>
                                        <i
                                            className={`codicon codicon-${
                                                item.isEnabled ? "check" : "circle-slash"
                                            }`}
                                        />
                                        <span>{item.isEnabled ? "ON" : "OFF"}</span>
                                    </div>
                                </div>
                            </div>

                            <Button
                                variant={item.isEnabled ? "default" : "secondary"}
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleDictionary();
                                }}
                                title={`${item.isEnabled ? "Disable" : "Enable"} spellcheck`}
                                className="flex items-center gap-1.5 min-w-[60px]"
                            >
                                <i
                                    className={`codicon codicon-${
                                        item.isEnabled ? "check" : "circle-slash"
                                    }`}
                                />
                                {item.isEnabled ? "ON" : "OFF"}
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        const progressValues = getProgressValues(item.progress);
        const hasProgress = item.progress && typeof item.progress === "object";
        const hasAudio = progressValues.audioCompletion > 0 || progressValues.audioValidation > 0;

        return (
            <div key={item.label + item.uri}>
                <div
                    tabIndex={0}
                    className={`group relative cursor-pointer select-none p-0 rounded-md transition-colors hover:bg-accent ${
                        isGroup
                            ? "bg-card border border-border"
                            : "bg-transparent border border-transparent"
                    }`}
                    onClick={handleItemClick}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            handleItemClick(e as unknown as React.MouseEvent);
                        }
                    }}
                >
                    <div className="py-2 px-3 flex flex-col gap-3 w-full">
                        {/* Row 1: label + action buttons */}
                        <div className="flex items-center gap-2 min-h-[24px]">
                            {isGroup && (
                                <i
                                    className={`codicon ${
                                        isExpanded
                                            ? "codicon-chevron-down"
                                            : "codicon-chevron-right"
                                    } text-base text-vscode-foreground w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-70 transition-transform duration-200`}
                                />
                            )}
                            <i
                                className={`codicon codicon-${icon} text-base text-vscode-symbolIcon-fileForeground w-4 h-4 flex items-center justify-center flex-shrink-0`}
                            />
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1 text-sm font-medium text-vscode-foreground leading-normal">
                                {displayLabel}
                            </span>

                            {/* Direct action buttons - visible on hover */}
                            <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                {item.type === "codexDocument" && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="menu-button w-6 h-6"
                                        title="Edit Book Name"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleEditBookName(item);
                                        }}
                                    >
                                        <i className="codicon codicon-edit text-xs" />
                                    </Button>
                                )}
                                {item.type === "corpus" && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="menu-button w-6 h-6"
                                            title="Rename Group"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleEditCorpusMarker(item);
                                            }}
                                        >
                                            <i className="codicon codicon-edit text-xs" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="menu-button w-6 h-6"
                                            title="Delete Folder"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteCorpusMarker(item);
                                            }}
                                        >
                                            <i className="codicon codicon-trash text-xs" />
                                        </Button>
                                    </>
                                )}
                                {!isGroup && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="menu-button w-6 h-6"
                                        title="Delete"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(item);
                                        }}
                                    >
                                        <i className="codicon codicon-trash text-xs" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Row 2: progress bars below label */}
                        {hasProgress && (
                            <div
                                className="pl-7 flex flex-col gap-2"
                                onClick={isGroup ? undefined : (e) => e.stopPropagation()}
                            >
                                {/* Text progress */}
                                <div className="flex items-start gap-2">
                                    <Languages className="h-4 w-4 flex-shrink-0 opacity-60 -mt-0.5" />
                                    <Progress
                                        value={progressValues.textCompletion}
                                        validationValues={progressValues.textValidationLevels}
                                        requiredValidations={progressValues.requiredTextValidations}
                                        showPercentage
                                        showTooltips
                                    />
                                </div>
                                {/* Audio progress - only show if there's audio data */}
                                {hasAudio && (
                                    <div className="flex items-start gap-2">
                                        <Mic className="h-4 w-4 flex-shrink-0 opacity-60 -mt-0.5" />
                                        <Progress
                                            value={progressValues.audioCompletion}
                                            validationValues={progressValues.audioValidationLevels}
                                            requiredValidations={
                                                progressValues.requiredAudioValidations
                                            }
                                            showPercentage
                                            showTooltips
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                {isGroup && isExpanded && item.children && (
                    <div className="ml-4 mt-1 flex flex-col gap-0.5">
                        {item.children.sort(sortItems).map(renderItem)}
                    </div>
                )}
            </div>
        );
    };

    const filteredCodexItems = filterItems(state.codexItems);
    const filteredDictionaryItems = filterItems(state.dictionaryItems);
    const sortComparison = (a: CodexItem, b: CodexItem) => {
        const comparison = a.label.localeCompare(b.label);
        return sortOrder === "asc" ? comparison : -comparison;
    };
    filteredCodexItems.sort(sortComparison);
    filteredDictionaryItems.sort(sortComparison);

    const renameTestamentAbbreviations = (fileName: string, hasBibleBookMap: boolean): string => {
        if (hasBibleBookMap) {
            if (fileName === "NT") {
                return "New Testament";
            } else if (fileName === "OT") {
                return "Old Testament";
            }
        }

        return fileName;
    };

    const renameModalOriginalLabel = useMemo(() => {
        const originalLabel = state.renameModal.item?.label || "";
        const hasMap = !!state.bibleBookMap;

        return renameTestamentAbbreviations(originalLabel, hasMap);
    }, [state.renameModal.item?.label, state.bibleBookMap]);

    const disableRenameButton = useMemo(() => {
        return (
            !state.renameModal.newName.trim() ||
            state.renameModal.newName.trim() === renameModalOriginalLabel ||
            state.renameModal.newName.trim() === state.renameModal.item?.label
        );
    }, [state.renameModal.newName, renameModalOriginalLabel]);

    const bookNameModalOriginalLabel = useMemo(() => {
        if (!state.bookNameModal.item) return "";
        // Use fileDisplayName from metadata if available, otherwise fall back to formatted label
        return (
            state.bookNameModal.item.fileDisplayName ||
            formatLabel(state.bookNameModal.item.label, state.bibleBookMap || new Map())
        );
    }, [state.bookNameModal.item, state.bibleBookMap]);

    const disableBookNameButton = useMemo(() => {
        return !state.bookNameModal.newName.trim();
    }, [state.bookNameModal.newName]);

    // Separate project dictionary from other dictionaries
    const projectDictionary = filteredDictionaryItems.find((item) => item.isProjectDictionary);
    const otherDictionaries = filteredDictionaryItems.filter((item) => !item.isProjectDictionary);

    return (
        <div className="p-3 h-full overflow-hidden flex flex-col bg-vscode-sideBar-background">
            <div className="mb-4 flex gap-2 items-center">
                <div className="relative flex-1">
                    <i className="codicon codicon-search absolute left-3 top-1/2 -translate-y-1/2 text-vscode-sideBar-foreground" />
                    <Input
                        placeholder="Search files..."
                        value={state.searchQuery}
                        onChange={handleSearch}
                        style={{
                            width: "100%",
                            paddingLeft: "36px",
                            fontSize: "14px",
                            height: "36px",
                            borderRadius: "6px",
                        }}
                    />
                </div>
                <Button
                    variant="outline"
                    onClick={handleRefresh}
                    className="h-9 w-9 flex items-center justify-center rounded-md"
                >
                    <i className="codicon codicon-refresh" />
                </Button>
                <Button
                    variant="outline"
                    onClick={handleToggleSortOrder}
                    className="h-9 w-9 flex items-center justify-center rounded-md"
                    title={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`}
                >
                    <i className="codicon codicon-sort-precedence" />
                </Button>
            </div>

            <div className="flex-1 overflow-auto flex flex-col gap-1.5">
                {(() => {
                    if (filteredCodexItems.length > 0 || otherDictionaries.length > 0) {
                        return (
                            <>
                                {filteredCodexItems.map(renderItem)}
                                {otherDictionaries.map(renderItem)}
                            </>
                        );
                    }

                    if (!state.hasReceivedInitialData) {
                        return (
                            <div className="p-8 text-center text-sm text-muted-foreground">
                                Loading files...
                            </div>
                        );
                    }

                    return (
                        <div className="p-8 text-center text-sm text-muted-foreground">
                            No files added yet
                        </div>
                    );
                })()}
            </div>

            <div className="mt-auto pt-4 flex flex-col gap-3 bg-vscode-sideBar-background relative">
                {/* Action Buttons - Side by Side */}
                <div className="flex gap-2">
                    <Button
                        variant="default"
                        onClick={handleAddFiles}
                        title="Add files to translate"
                        className="flex-1 py-2.5 px-3 text-sm font-semibold shadow-sm hover:-translate-y-[1px] hover:shadow-md active:translate-y-0 active:shadow-sm transition-all flex items-center justify-center gap-2"
                    >
                        <i className="codicon codicon-add" />
                        Add Files
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleOpenExport}
                        title="Export files"
                        className="flex-1 py-2.5 px-3 text-sm font-semibold shadow-sm hover:-translate-y-[1px] hover:shadow-md active:translate-y-0 active:shadow-sm transition-all flex items-center justify-center gap-2"
                    >
                        <i className="codicon codicon-cloud-upload" />
                        Export
                    </Button>
                </div>

                {/* Project Dictionary */}
                {projectDictionary && renderItem(projectDictionary)}
            </div>

            {/* Corpus Marker Modal */}
            <RenameModal
                open={state.renameModal.isOpen}
                title="Rename Corpus"
                description="Enter new name for"
                originalLabel={renameModalOriginalLabel}
                value={state.renameModal.newName}
                placeholder="Enter new corpus name"
                confirmButtonLabel="Rename"
                disabled={disableRenameButton}
                onClose={handleRenameModalClose}
                onConfirm={handleRenameModalConfirm}
                onValueChange={handleRenameModalInputChange}
            />

            {/* Book Name Modal */}
            <RenameModal
                open={state.bookNameModal.isOpen}
                title="Edit Book Name"
                description="Enter new name for"
                originalLabel={bookNameModalOriginalLabel}
                value={state.bookNameModal.newName}
                placeholder="Enter new book name"
                confirmButtonLabel="Save"
                disabled={disableBookNameButton}
                onClose={handleBookNameModalClose}
                onConfirm={handleBookNameModalConfirm}
                onValueChange={handleBookNameModalInputChange}
            />
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<NavigationView />);
