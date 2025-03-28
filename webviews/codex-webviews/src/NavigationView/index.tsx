import React, { useState, useEffect } from "react";
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
        const icon = isGroup
            ? isExpanded
                ? "chevron-down"
                : "chevron-right"
            : item.type === "dictionary"
            ? "book"
            : "notebook";

        if (isGroup) {
            return (
                <div key={item.uri.toString()}>
                    <div
                        style={styles.groupItem}
                        onClick={() => toggleGroup(item.label)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                toggleGroup(item.label);
                                e.preventDefault();
                            }
                        }}
                    >
                        <div style={styles.itemHeader}>
                            <i className={`codicon codicon-${icon}`} style={styles.icon} />
                            <span style={styles.label}>{item.label}</span>
                            {item.progress === 100 && (
                                <i className="codicon codicon-check" style={styles.checkIcon} />
                            )}
                        </div>
                    </div>
                    {isExpanded && item.children && (
                        <div style={styles.childrenContainer}>
                            {item.children.map((child) => renderItem(child))}
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div key={item.uri.toString()}>
                <div
                    style={styles.item}
                    onClick={() => openFile(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            openFile(item);
                            e.preventDefault();
                        }
                    }}
                >
                    <div style={styles.itemContent}>
                        <div style={styles.itemHeader}>
                            <i className={`codicon codicon-${icon}`} style={styles.icon} />
                            <span style={styles.label}>{item.label}</span>
                            {item.progress === 100 && (
                                <i className="codicon codicon-check" style={styles.checkIcon} />
                            )}
                        </div>
                        {renderProgressSection(item.progress)}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div style={styles.container}>
            <div style={styles.searchContainer}>
                <div style={styles.searchWrapper}>
                    <i className="codicon codicon-search" style={styles.searchIcon} />
                    <VSCodeTextField
                        placeholder="Search files..."
                        value={state.searchQuery}
                        onChange={(e: any) =>
                            setState((prev) => ({ ...prev, searchQuery: e.target.value }))
                        }
                        style={{ width: "100%", paddingLeft: "28px" }}
                    />
                </div>
                <VSCodeButton
                    appearance="icon"
                    onClick={() => vscode.postMessage({ command: "refresh" })}
                    title="Refresh"
                    style={styles.refreshButton}
                >
                    <i className="codicon codicon-refresh" style={{ fontSize: "14px" }} />
                </VSCodeButton>
            </div>

            <div style={styles.itemsContainer}>
                {state.codexItems.map((item) => renderItem(item))}
                {state.dictionaryItems.length > 0 && (
                    <>
                        <VSCodeDivider style={{ margin: "8px 0" }} />
                        {state.dictionaryItems.map((item) => renderItem(item))}
                    </>
                )}
            </div>
        </div>
    );
}

export default NavigationView;

// Mount the component
const root = document.getElementById("root");
if (root) {
    const reactRoot = createRoot(root);
    reactRoot.render(<NavigationView />);
}
