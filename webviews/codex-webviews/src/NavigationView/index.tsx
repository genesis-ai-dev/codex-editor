import React, { useState, useEffect, useMemo, FormEventHandler } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { WebviewHeader } from "../components/WebviewHeader";
import bibleData from "../assets/bible-books-lookup.json";
import { Progress } from "../components/ui/progress";
import "../tailwind.css";
import { CodexItem } from "types";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";

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

    // Modal styles
    modalOverlay: {
        position: "fixed" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
    },
    modalContent: {
        backgroundColor: "var(--vscode-editor-background)",
        border: "1px solid var(--vscode-editorWidget-border)",
        borderRadius: "8px",
        padding: "20px",
        minWidth: "300px",
        maxWidth: "350px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
    },
    modalTitle: {
        fontSize: "16px",
        fontWeight: "600",
        color: "var(--vscode-foreground)",
        marginBottom: "16px",
    },
    modalDescription: {
        fontSize: "14px",
        color: "var(--vscode-descriptionForeground)",
        marginBottom: "20px",
        lineHeight: "1.5",
    },
    modalInput: {},
    modalButtons: {},
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

    // Extract any numbers from the labels for alphanumeric sorting
    const aMatch = a.label.match(/\d+/);
    const bMatch = b.label.match(/\d+/);

    if (aMatch && bMatch) {
        const aNum = parseInt(aMatch[0]);
        const bNum = parseInt(bMatch[0]);
        if (aNum !== bNum) {
            return aNum - bNum;
        }
    }

    return a.label.localeCompare(b.label);
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
    });

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
        vscode.postMessage({
            command: "editBookName",
            content: { bookAbbr: item.label },
        });
    };

    const handleEditCorpusMarker = (item: CodexItem) => {
        setState((prev) => ({
            ...prev,
            renameModal: {
                isOpen: true,
                item: item,
                newName: "",
            },
        }));
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

    const handleRenameModalInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setState((prev) => ({
            ...prev,
            renameModal: {
                ...prev.renameModal,
                newName: e.target.value,
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

    const handleRenameModalKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handleRenameModalConfirm();
        } else if (e.key === "Escape") {
            handleRenameModalClose();
        }
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
                            const displayName = formatLabel(
                                child.label,
                                state.bibleBookMap || new Map()
                            );
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

                const displayName = formatLabel(item.label, state.bibleBookMap || new Map());
                return displayName.toLowerCase().includes(searchLower) ? item : null;
            })
            .filter((item): item is CodexItem => item !== null);
    };

    const renderProgressSection = (progress?: {
        percentTranslationsCompleted: number;
        percentFullyValidatedTranslations: number;
    }) => {
        if (typeof progress !== "object") return null;
        console.log({ progress });
        return (
            <div className="flex flex-col gap-1 pl-7">
                <Progress
                    value={progress.percentTranslationsCompleted}
                    secondaryValue={progress.percentFullyValidatedTranslations}
                    showPercentage
                />
            </div>
        );
    };

    const renderItem = (item: CodexItem) => {
        const isGroup = item.type === "corpus";
        const isExpanded = state.expandedGroups.has(item.label);
        const icon = isGroup ? "library" : item.type === "dictionary" ? "book" : "file";
        const displayLabel = formatLabel(item.label || "", state.bibleBookMap || new Map());
        const itemId = `${item.label || "unknown"}-${item.uri || ""}`;

        const isProjectDict = item.isProjectDictionary;

        // Debug logging (can be removed later)
        if (!displayLabel || displayLabel.trim() === "") {
            console.warn("Empty display label for item:", item);
        }

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

        return (
            <div key={item.label + item.uri}>
                <div
                    className={`group relative cursor-pointer select-none p-0 rounded-md transition-colors hover:bg-accent ${
                        isGroup
                            ? "bg-card border border-border"
                            : "bg-transparent border border-transparent"
                    }`}
                    onClick={handleItemClick}
                >
                    <div className="p-3 flex flex-col gap-1.5">
                        <div className="flex items-center gap-3 w-full min-h-6">
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
                        </div>
                        {renderProgressSection(item.progress)}
                    </div>

                    {/* Menu button positioned absolutely */}
                    {(!isGroup || item.type === "corpus") && (
                        <>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="menu-button absolute top-2 right-2 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="More options"
                                    >
                                        <i className="codicon codicon-kebab-vertical" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-36 p-1" align="end" side="right">
                                    {item.type === "codexDocument" && (
                                        <div
                                            className="px-2 py-1.5 cursor-pointer text-sm flex items-center gap-2 rounded-sm hover:bg-accent hover:text-accent-foreground"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleEditBookName(item);
                                            }}
                                        >
                                            <i className="codicon codicon-edit" />
                                            Edit Book Name
                                        </div>
                                    )}
                                    {item.type === "corpus" && (
                                        <div
                                            className="px-2 py-1.5 cursor-pointer text-sm flex items-center gap-2 rounded-sm hover:bg-accent hover:text-accent-foreground"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleEditCorpusMarker(item);
                                            }}
                                        >
                                            <i className="codicon codicon-edit" />
                                            Rename Group
                                        </div>
                                    )}
                                    {!isGroup && (
                                        <div
                                            className="px-2 py-1.5 cursor-pointer text-sm flex items-center gap-2 rounded-sm hover:bg-accent hover:text-accent-foreground"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(item);
                                            }}
                                        >
                                            <i className="codicon codicon-trash" />
                                            Delete
                                        </div>
                                    )}
                                </PopoverContent>
                            </Popover>
                        </>
                    )}
                </div>
                {isGroup && isExpanded && item.children && (
                    <div className="ml-4 mt-1.5 flex flex-col">
                        {item.children.sort(sortItems).map(renderItem)}
                    </div>
                )}
            </div>
        );
    };

    const filteredCodexItems = filterItems(state.codexItems);
    const filteredDictionaryItems = filterItems(state.dictionaryItems);
    const hasResults = filteredCodexItems.length > 0 || filteredDictionaryItems.length > 0;

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
            </div>

            <div className="flex-1 overflow-auto flex flex-col gap-2">
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
                {/* Add Files Button */}
                <Button
                    variant="default"
                    onClick={handleAddFiles}
                    title="Add files to translate"
                    className="w-full py-4 px-5 text-sm font-semibold shadow-sm hover:-translate-y-[1px] hover:shadow-md active:translate-y-0 active:shadow-sm transition-all flex items-center justify-center gap-2.5"
                >
                    <i className="codicon codicon-add text-base" />
                    <i className="codicon codicon-file-text text-base" />
                    Add Files
                </Button>

                {/* Export Files Button */}
                <Button
                    variant="secondary"
                    onClick={handleOpenExport}
                    title="Export files"
                    className="w-full py-3 px-5 text-sm font-semibold shadow-sm hover:-translate-y-[1px] hover:shadow-md active:translate-y-0 active:shadow-sm transition-all flex items-center justify-center gap-2.5"
                >
                    <i className="codicon codicon-cloud-upload" />
                    Export Files
                </Button>

                {/* Project Dictionary */}
                {projectDictionary && renderItem(projectDictionary)}
            </div>

            {/* Rename Modal */}
            {state.renameModal.isOpen && (
                <div style={styles.modalOverlay} onClick={handleRenameModalClose}>
                    <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalTitle}>Rename Corpus</div>
                        <div style={styles.modalDescription}>
                            Enter new name for "{renameModalOriginalLabel}
                            ":
                        </div>
                        <input
                            type="text"
                            className="w-full p-2 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded-md mb-5 outline-none"
                            value={state.renameModal.newName}
                            onChange={handleRenameModalInputChange}
                            onKeyDown={handleRenameModalKeyPress}
                            placeholder="Enter new corpus name"
                            autoFocus
                        />
                        <div className="flex gap-3 justify-end">
                            <Button variant="secondary" onClick={handleRenameModalClose}>
                                Cancel
                            </Button>
                            <Button
                                variant="default"
                                onClick={handleRenameModalConfirm}
                                disabled={disableRenameButton}
                            >
                                Rename
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<NavigationView />);
