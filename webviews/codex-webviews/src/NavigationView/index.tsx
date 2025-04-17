import React, { useState, useEffect, FormEventHandler } from "react";
import { createRoot } from "react-dom/client";
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodeBadge,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { WebviewHeader } from "../components/WebviewHeader";

// Declare the VS Code API globally like in ProjectManagerView
declare const vscode: {
    postMessage: (message: any) => void;
};

interface CodexItem {
    uri: { toString: () => string };
    label: string;
    type: "corpus" | "codexDocument" | "dictionary";
    children?: CodexItem[];
    corpusMarker?: string;
    progress?: number;
}

interface State {
    codexItems: CodexItem[];
    dictionaryItems: CodexItem[];
    expandedGroups: Set<string>;
    searchQuery: string;
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
};

// Helper function to sort items alphanumerically
const sortAlphanumerically = (a: CodexItem, b: CodexItem) => {
    // Extract any numbers from the labels
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

// Helper function to clean up label display
const cleanLabelForDisplay = (label: string) => {
    return label
        .replace(/[-_]/g, " ") // Replace hyphens and underscores with spaces
        .replace(/LOCALLY\d*$/, "") // Remove 'LOCALLY' and any numbers after it
        .trim(); // Remove any extra spaces
};

function NavigationView() {
    const [state, setState] = useState<State>({
        codexItems: [],
        dictionaryItems: [],
        expandedGroups: new Set(),
        searchQuery: "",
    });

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "updateItems":
                    setState((prevState) => ({
                        ...prevState,
                        codexItems: message.codexItems || [],
                        dictionaryItems: message.dictionaryItems || [],
                    }));
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

    const handleSearch: FormEventHandler<HTMLElement> & ((e: Event) => unknown) = (e) => {
        const target = e.target as HTMLInputElement;
        setState((prev) => ({ ...prev, searchQuery: target.value }));
    };

    const handleRefresh = () => {
        vscode.postMessage({ command: "refresh" });
    };

    const openFile = (item: CodexItem) => {
        // Get the file system path from the URI
        const uri = item.uri.toString();
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
                        .filter((child) => child.label.toLowerCase().includes(searchLower))
                        .sort(sortAlphanumerically);

                    if (filteredChildren.length > 0) {
                        return {
                            ...item,
                            children: filteredChildren,
                        };
                    }
                    return null;
                }

                return item.label.toLowerCase().includes(searchLower) ? item : null;
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
        const displayLabel = cleanLabelForDisplay(item.label);

        return (
            <div key={item.label}>
                <div
                    style={isGroup ? styles.groupItem : styles.item}
                    onClick={() => (isGroup ? toggleGroup(item.label) : openFile(item))}
                >
                    <div style={styles.itemHeader}>
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
                    </div>
                    {renderProgressSection(item.progress)}
                </div>
                {isGroup && isExpanded && item.children && (
                    <div style={styles.childrenContainer}>
                        {item.children.sort(sortAlphanumerically).map(renderItem)}
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
            <div style={styles.searchContainer}>
                <div style={styles.searchWrapper}>
                    <i className="codicon codicon-search" style={styles.searchIcon} />
                    <VSCodeTextField
                        placeholder="Search files..."
                        value={state.searchQuery}
                        onInput={handleSearch}
                        style={{ width: "100%" }}
                    />
                </div>
                <VSCodeButton
                    appearance="icon"
                    onClick={handleRefresh}
                    style={styles.refreshButton}
                >
                    <i className="codicon codicon-refresh" />
                </VSCodeButton>
            </div>
            <div style={styles.itemsContainer}>
                {hasResults ? (
                    <>
                        {filteredCodexItems.map(renderItem)}
                        {filteredDictionaryItems.map(renderItem)}
                    </>
                ) : (
                    <div style={styles.noResults}>No matching files found</div>
                )}
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<NavigationView />);
