import React, { useState, useEffect, useMemo, FormEventHandler } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { WebviewHeader } from "../components/WebviewHeader";
import bibleData from "../assets/bible-books-lookup.json";

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

interface CodexItem {
    uri: string;
    label: string;
    type: "corpus" | "codexDocument" | "dictionary";
    children?: CodexItem[];
    corpusMarker?: string;
    progress?: number;
    sortOrder?: string;
}

interface State {
    codexItems: CodexItem[];
    dictionaryItems: CodexItem[];
    expandedGroups: Set<string>;
    searchQuery: string;
    bibleBookMap: Map<string, BibleBookInfo> | undefined;
    openMenu: string | null;
}

// Styles object to keep things organized
const styles = {
    container: {
        padding: "8px",
        height: "100vh",
        overflow: "auto",
        display: "flex",
        flexDirection: "column" as const,
    },
    searchContainer: {
        position: "relative" as const,
        marginBottom: "8px",
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
        left: "8px",
        top: "50%",
        transform: "translateY(-50%)",
        color: "var(--vscode-input-placeholderForeground)",
        fontSize: "14px",
    },
    refreshButton: {
        padding: "4px",
        height: "28px",
        width: "28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    itemsContainer: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "1px",
    },
    item: {
        cursor: "pointer",
        userSelect: "none" as const,
        padding: "6px 8px",
        borderRadius: "3px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "4px",
        transition: "background-color 0.1s ease",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    groupItem: {
        backgroundColor: "var(--vscode-sideBar-background)",
        padding: "6px 8px",
        cursor: "pointer",
        userSelect: "none" as const,
        borderRadius: "3px",
        transition: "background-color 0.1s ease",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    itemContent: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "4px",
        width: "100%",
    },
    itemHeader: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        width: "100%",
        minHeight: "22px",
        position: "relative" as const,
    },
    label: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        fontSize: "13px",
        color: "var(--vscode-foreground)",
        fontFeatureSettings: "'kern' 1, 'liga' 1",
    },
    icon: {
        fontSize: "14px",
        color: "var(--vscode-foreground)",
        opacity: 0.8,
        width: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    checkIcon: {
        fontSize: "14px",
        color: "var(--vscode-terminal-ansiGreen)",
        opacity: 0.8,
    },
    progressSection: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "4px",
        width: "100%",
        paddingLeft: "22px",
    },
    progressLabel: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: "11px",
        color: "var(--vscode-descriptionForeground)",
    },
    progressBar: {
        width: "100%",
        height: "2px",
        backgroundColor: "var(--vscode-progressBar-background)",
        borderRadius: "1px",
        overflow: "hidden",
    },
    progressFill: (progress: number) => ({
        width: `${progress}%`,
        height: "100%",
        backgroundColor: "var(--vscode-progressBar-foreground)",
        transition: "width 0.3s ease",
    }),
    childrenContainer: {
        marginLeft: "16px",
        display: "flex",
        flexDirection: "column" as const,
        gap: "1px",
    },
    noResults: {
        padding: "16px",
        textAlign: "center" as const,
        color: "var(--vscode-descriptionForeground)",
    },
    menuButton: {
        padding: "2px",
        background: "transparent",
        border: "none",
        borderRadius: "3px",
        cursor: "pointer",
        transition: "opacity 0.2s ease, background-color 0.1s ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "12px",
        color: "var(--vscode-foreground)",
        minWidth: "16px",
        height: "16px",
        maxWidth: "fit-content",
    },
    popover: {
        position: "absolute" as const,
        top: "100%",
        right: "0px",
        backgroundColor: "var(--vscode-menu-background)",
        border: "1px solid var(--vscode-menu-border)",
        borderRadius: "3px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.32)",
        zIndex: 1000,
        minWidth: "120px",
        padding: "4px 0",
    },
    popoverItem: {
        padding: "6px 12px",
        cursor: "pointer",
        fontSize: "13px",
        color: "var(--vscode-menu-foreground)",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        "&:hover": {
            backgroundColor: "var(--vscode-menu-selectionBackground)",
            color: "var(--vscode-menu-selectionForeground)",
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
        const uri = item.uri;
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

    const renderProgressSection = (progress?: number) => {
        if (typeof progress !== "number") return null;
        return (
            <div style={styles.progressSection}>
                <div style={styles.progressLabel}>
                    <span>Translation Progress</span>
                    <span>{Math.round(progress)}%</span>
                </div>
                <div style={styles.progressBar}>
                    <div
                        style={{
                            width: `${progress}%`,
                            height: "100%",
                            backgroundColor:
                                progress === 100
                                    ? "var(--vscode-terminal-ansiGreen)"
                                    : "var(--vscode-progressBar-foreground)",
                            transition: "width 0.3s ease",
                        }}
                    />
                </div>
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

        // Debug logging (can be removed later)
        if (!displayLabel || displayLabel.trim() === "") {
            console.warn("Empty display label for item:", item);
        }

        return (
            <div key={item.label + item.uri}>
                <div
                    style={{
                        ...(isGroup ? styles.groupItem : styles.item),
                        position: "relative",
                    }}
                    // onMouseEnter={(e) => {
                    //     if (!isGroup) {
                    //         const menuButton = e.currentTarget.querySelector(
                    //             ".menu-button"
                    //         ) as HTMLElement;
                    //         if (menuButton) {
                    //             menuButton.style.opacity = "1";
                    //         }
                    //     }
                    // }}
                    // onMouseLeave={(e) => {
                    //     if (!isGroup && !isMenuOpen) {
                    //         const menuButton = e.currentTarget.querySelector(
                    //             ".menu-button"
                    //         ) as HTMLElement;
                    //         if (menuButton) {
                    //             menuButton.style.opacity = "0";
                    //         }
                    //     }
                    // }}
                >
                    <div
                        style={styles.itemHeader}
                        onClick={() => (isGroup ? toggleGroup(item.label) : openFile(item))}
                    >
                        {isGroup && (
                            <i
                                className={`codicon codicon-${
                                    isExpanded ? "chevron-down" : "chevron-right"
                                }`}
                                style={styles.icon}
                            />
                        )}
                        <i className={`codicon codicon-${icon}`} style={styles.icon} />
                        <span style={styles.label}>{displayLabel}</span>
                        {item.progress === 100 && (
                            <i className="codicon codicon-check" style={styles.checkIcon} />
                        )}
                        {!isGroup && (
                            <button
                                className="menu-button"
                                style={{
                                    ...styles.menuButton,
                                }}
                                onClick={(e) => toggleMenu(itemId, e)}
                                title="More options"
                            >
                                <i className="codicon codicon-kebab-vertical" />
                            </button>
                        )}
                        {!isGroup && isMenuOpen && (
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
                    </div>
                    {renderProgressSection(item.progress)}
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

    return (
        <div style={styles.container}>
            <WebviewHeader title="Files & Navigation" vscode={vscode} />
            <div style={styles.searchContainer}>
                <div style={styles.searchWrapper}>
                    <i className="codicon codicon-search" style={styles.searchIcon} />
                    <Input
                        placeholder="Search files..."
                        value={state.searchQuery}
                        onChange={handleSearch}
                        style={{ width: "100%", paddingLeft: "28px" }}
                    />
                </div>
                <Button variant="outline" onClick={handleRefresh} style={styles.refreshButton}>
                    <i className="codicon codicon-refresh" />
                </Button>
            </div>
            <div style={styles.itemsContainer}>
                {hasResults ? (
                    <>
                        {filteredCodexItems.map(renderItem)}
                        {filteredDictionaryItems.map(renderItem)}
                    </>
                ) : state.codexItems.length === 0 && state.dictionaryItems.length === 0 ? (
                    <div style={styles.noResults}>Loading files...</div>
                ) : (
                    <div style={styles.noResults}>No matching files found</div>
                )}
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<NavigationView />);
