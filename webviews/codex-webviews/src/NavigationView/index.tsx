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
    searchQuery: string;
    bibleBookMap: Map<string, BibleBookInfo> | undefined;
    openMenu: string | null;
    hasReceivedInitialData: boolean;
}

// Redesigned styles following Jobs/DHH principles: clean, purposeful, delightful
const styles = {
    container: {
        padding: "12px",
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column" as const,
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    scrollableContent: {
        flex: 1,
        overflow: "auto",
        display: "flex",
        flexDirection: "column" as const,
        gap: "2px",
    },
    bottomSection: {
        marginTop: "auto",
        paddingTop: "16px",
        borderTop: "2px solid var(--vscode-sideBarSectionHeader-border)",
        display: "flex",
        flexDirection: "column" as const,
        gap: "12px",
        backgroundColor: "var(--vscode-sideBar-background)",
        position: "relative" as const,
    },
    searchContainer: {
        marginBottom: "16px",
        display: "flex",
        gap: "8px",
        alignItems: "center",
    },
    searchWrapper: {
        position: "relative" as const,
        flex: 1,
    },
    searchIcon: {
        position: "absolute" as const,
        left: "12px",
        top: "50%",
        transform: "translateY(-50%)",
        color: "var(--vscode-input-placeholderForeground)",
        fontSize: "16px",
        zIndex: 1,
    },
    refreshButton: {
        padding: "8px",
        height: "36px",
        width: "36px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "6px",
    },
    itemsContainer: {
        display: "flex",
        flexDirection: "column" as const,
    },
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
    groupItemContainer: {
        cursor: "pointer",
        userSelect: "none" as const,
        padding: "0",
        borderRadius: "6px",
        transition: "all 0.15s ease",
        position: "relative" as const,
        backgroundColor: "var(--vscode-sideBar-background)",
        border: "1px solid var(--vscode-sideBar-border)",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
            borderColor: "var(--vscode-focusBorder)",
        },
    },
    // Content inside the clickable container
    itemContent: {
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "8px",
    },
    itemHeader: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        width: "100%",
        minHeight: "24px",
    },
    label: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        fontSize: "14px",
        fontWeight: "500",
        color: "var(--vscode-foreground)",
        lineHeight: "1.4",
    },
    icon: {
        fontSize: "16px",
        color: "var(--vscode-symbolIcon-fileForeground)",
        width: "16px",
        height: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    chevronIcon: {
        fontSize: "16px",
        color: "var(--vscode-foreground)",
        width: "16px",
        height: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        opacity: 0.7,
        transition: "transform 0.2s ease, opacity 0.2s ease",
    },
    completedIcon: {
        fontSize: "16px",
        color: "var(--vscode-terminal-ansiGreen)",
        width: "16px",
        height: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    progressSection: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "6px",
        paddingLeft: "28px",
    },
    progressLabel: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
        fontWeight: "500",
    },
    progressBar: {
        width: "100%",
        height: "4px",
        backgroundColor: "var(--vscode-progressBar-background)",
        borderRadius: "2px",
        overflow: "hidden",
    },
    childrenContainer: {
        marginLeft: "20px",
        marginTop: "4px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "2px",
    },
    noResults: {
        padding: "32px 16px",
        textAlign: "center" as const,
        color: "var(--vscode-descriptionForeground)",
        fontSize: "14px",
    },
    // Menu button positioned absolutely in top-right
    menuButton: {
        position: "absolute" as const,
        top: "8px",
        right: "8px",
        padding: "4px",
        background: "var(--vscode-button-secondaryBackground)",
        border: "1px solid var(--vscode-button-border)",
        borderRadius: "4px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "12px",
        color: "var(--vscode-button-secondaryForeground)",
        width: "24px",
        height: "24px",
        opacity: 0,
        transform: "scale(0.9)",
        "&:hover": {
            backgroundColor: "var(--vscode-button-secondaryHoverBackground)",
            transform: "scale(1)",
        },
    },
    popover: {
        position: "absolute" as const,
        top: "32px",
        right: "8px",
        backgroundColor: "var(--vscode-menu-background)",
        border: "1px solid var(--vscode-menu-border)",
        borderRadius: "6px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        zIndex: 1000,
        minWidth: "140px",
        padding: "4px",
        overflow: "hidden",
    },
    popoverItem: {
        padding: "8px 12px",
        cursor: "pointer",
        fontSize: "13px",
        color: "var(--vscode-menu-foreground)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderRadius: "4px",
        transition: "background-color 0.1s ease",
        "&:hover": {
            backgroundColor: "var(--vscode-menu-selectionBackground)",
            color: "var(--vscode-menu-selectionForeground)",
        },
    },
    dictionaryContainer: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "8px",
        padding: "16px",
        backgroundColor: "var(--vscode-sideBarSectionHeader-background)",
        borderRadius: "8px",
        border: "1px solid var(--vscode-sideBarSectionHeader-border)",
        transition: "all 0.2s ease",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.12)",
        },
    },
    dictionaryHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
    },
    dictionaryIconSection: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
    },
    dictionaryIcon: {
        fontSize: "18px",
        color: "var(--vscode-symbolIcon-keywordForeground)",
        width: "18px",
        height: "18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    dictionaryInfo: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "2px",
    },
    dictionaryTitle: {
        fontSize: "14px",
        fontWeight: "600",
        color: "var(--vscode-foreground)",
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
    dictionaryStats: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
    dictionaryToggle: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
    },
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
    addFilesButton: {
        padding: "16px 20px",
        borderRadius: "8px",
        border: "2px solid var(--vscode-button-background)",
        backgroundColor: "var(--vscode-button-background)",
        color: "var(--vscode-button-foreground)",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "600",
        transition: "all 0.2s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
        position: "relative" as const,
        "&:hover": {
            backgroundColor: "var(--vscode-button-hoverBackground)",
            transform: "translateY(-1px)",
            boxShadow: "0 4px 8px rgba(0, 0, 0, 0.15)",
        },
        "&:active": {
            transform: "translateY(0px)",
            boxShadow: "0 1px 2px rgba(0, 0, 0, 0.1)",
        },
    },
    addFilesIcon: {
        fontSize: "16px",
        fontWeight: "bold",
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
        searchQuery: "",
        bibleBookMap: undefined,
        openMenu: null,
        hasReceivedInitialData: false,
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
        setState((prev) => ({ ...prev, searchQuery: e.target.value }));
    };

    const handleRefresh = () => {
        vscode.postMessage({ command: "refresh" });
    };

    const toggleMenu = (itemId: string, event: React.MouseEvent) => {
        event.stopPropagation();
        setState((prev) => ({
            ...prev,
            openMenu: prev.openMenu === itemId ? null : itemId,
        }));
    };

    const closeMenu = () => {
        setState((prev) => ({ ...prev, openMenu: null }));
    };

    const handleDelete = (item: CodexItem) => {
        closeMenu();
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

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = () => {
            if (state.openMenu) {
                closeMenu();
            }
        };

        document.addEventListener("click", handleClickOutside);
        return () => document.removeEventListener("click", handleClickOutside);
    }, [state.openMenu]);

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
            <div style={styles.progressSection}>
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
        const isMenuOpen = state.openMenu === itemId;
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
                    <div style={styles.dictionaryContainer} onClick={handleItemClick}>
                        <div style={styles.dictionaryHeader}>
                            <div style={styles.dictionaryIconSection}>
                                <div style={styles.dictionaryInfo}>
                                    <div style={styles.dictionaryTitle}>
                                        <i
                                            className="codicon codicon-book"
                                            style={styles.dictionaryIcon}
                                        />
                                        Dictionary
                                    </div>
                                    <div style={styles.dictionaryStats}>
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
                            <div style={styles.dictionaryToggle}>
                                <button
                                    style={{
                                        ...styles.toggleButton,
                                        backgroundColor: item.isEnabled
                                            ? "var(--vscode-button-background)"
                                            : "var(--vscode-button-secondaryBackground)",
                                        color: item.isEnabled
                                            ? "var(--vscode-button-foreground)"
                                            : "var(--vscode-button-secondaryForeground)",
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleDictionary();
                                    }}
                                    title={`${item.isEnabled ? "Disable" : "Enable"} spellcheck`}
                                >
                                    <i
                                        className={`codicon codicon-${
                                            item.isEnabled ? "check" : "circle-slash"
                                        }`}
                                    />
                                    {item.isEnabled ? "ON" : "OFF"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div key={item.label + item.uri}>
                <div
                    style={{
                        ...(isGroup ? styles.groupItemContainer : styles.itemContainer),
                        position: "relative",
                    }}
                    onClick={handleItemClick}
                    onMouseEnter={(e) => {
                        if (!isGroup && !isProjectDict) {
                            const menuButton = e.currentTarget.querySelector(
                                ".menu-button"
                            ) as HTMLElement;
                            if (menuButton) {
                                menuButton.style.opacity = "1";
                                menuButton.style.transform = "scale(1)";
                            }
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (!isGroup && !isProjectDict && !isMenuOpen) {
                            const menuButton = e.currentTarget.querySelector(
                                ".menu-button"
                            ) as HTMLElement;
                            if (menuButton) {
                                menuButton.style.opacity = "0";
                                menuButton.style.transform = "scale(0.9)";
                            }
                        }
                    }}
                >
                    <div style={styles.itemContent}>
                        <div style={styles.itemHeader}>
                            {isGroup && (
                                <i
                                    className={`codicon codicon-${
                                        isExpanded ? "chevron-down" : "chevron-right"
                                    }`}
                                    style={{
                                        ...styles.chevronIcon,
                                        transform: isExpanded ? "rotate(0deg)" : "rotate(0deg)",
                                    }}
                                />
                            )}
                            <i className={`codicon codicon-${icon}`} style={styles.icon} />
                            <span style={styles.label}>{displayLabel}</span>
                        </div>
                        {renderProgressSection(item.progress)}
                    </div>

                    {/* Menu button positioned absolutely */}
                    {!isGroup && (
                        <>
                            <button
                                className="menu-button"
                                style={styles.menuButton}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleMenu(itemId, e);
                                }}
                                title="More options"
                            >
                                <i className="codicon codicon-kebab-vertical" />
                            </button>
                            {isMenuOpen && (
                                <div style={styles.popover}>
                                    <div
                                        style={styles.popoverItem}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(item);
                                        }}
                                    >
                                        <i className="codicon codicon-trash" />
                                        Delete
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
                {isGroup && isExpanded && item.children && (
                    <div style={styles.childrenContainer}>
                        {item.children.sort(sortItems).map(renderItem)}
                    </div>
                )}
            </div>
        );
    };

    const filteredCodexItems = filterItems(state.codexItems);
    const filteredDictionaryItems = filterItems(state.dictionaryItems);
    const hasResults = filteredCodexItems.length > 0 || filteredDictionaryItems.length > 0;

    // Separate project dictionary from other dictionaries
    const projectDictionary = filteredDictionaryItems.find((item) => item.isProjectDictionary);
    const otherDictionaries = filteredDictionaryItems.filter((item) => !item.isProjectDictionary);

    return (
        <div style={styles.container}>
            <div style={styles.searchContainer}>
                <div style={styles.searchWrapper}>
                    <i className="codicon codicon-search" style={styles.searchIcon} />
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
                <Button variant="outline" onClick={handleRefresh} style={styles.refreshButton}>
                    <i className="codicon codicon-refresh" />
                </Button>
            </div>

            <div style={styles.scrollableContent}>
                <div style={styles.itemsContainer}>
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
                            return <div style={styles.noResults}>Loading files...</div>;
                        }

                        return <div style={styles.noResults}>No files added yet</div>;
                    })()}
                </div>
            </div>

            <div style={styles.bottomSection}>
                {/* Add Files Button */}
                <button
                    style={styles.addFilesButton}
                    onClick={handleAddFiles}
                    title="Add files to translate"
                >
                    <i className="codicon codicon-add" style={styles.addFilesIcon} />
                    <i className="codicon codicon-file-text" />
                    Add Files
                </button>

                {/* Project Dictionary */}
                {projectDictionary && renderItem(projectDictionary)}
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<NavigationView />);
