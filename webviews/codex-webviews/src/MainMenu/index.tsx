import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";

// Declare the global vscode object that's already acquired by something else
declare const vscode: any;

interface MenuButton {
    id: string;
    label: string;
    icon: string;
    viewId: string;
    description?: string;
}

interface MenuSection {
    title: string;
    buttons: MenuButton[];
}

interface State {
    menuConfig: MenuSection[];
    activeViewId: string | null;
}

// Refined styles with better whitespace and typography
const styles = {
    container: {
        padding: "28px 24px",
        height: "100vh",
        overflow: "auto",
        display: "flex",
        flexDirection: "column" as const,
        gap: "32px",
        maxWidth: "800px",
        margin: "0 auto",
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginBottom: "6px",
        borderBottom: "1px solid var(--vscode-tab-inactiveBackground)",
        paddingBottom: "16px",
    },
    headerTitle: {
        fontSize: "20px",
        fontWeight: 300,
        color: "var(--vscode-foreground)",
        letterSpacing: "0.2px",
        lineHeight: 1.4,
    },
    sectionTitle: {
        fontSize: "13px",
        fontWeight: 600,
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.8px",
        marginBottom: "12px",
    },
    sectionContainer: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "14px",
    },
    buttonsContainer: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: "10px",
    },
    button: {
        height: "auto",
        padding: "0",
        display: "flex",
        flexDirection: "row" as const,
        alignItems: "center",
        gap: "12px",
        textAlign: "left" as const,
        borderRadius: "4px",
        transition: "all 0.2s ease",
        position: "relative" as const,
        border: "none",
        background: "transparent",
        overflow: "hidden",
        cursor: "pointer",
        width: "100%",
    },
    buttonContent: {
        display: "flex",
        alignItems: "center",
        padding: "10px 12px",
        width: "100%",
        height: "100%",
        borderRadius: "4px",
        gap: "12px",
    },
    iconContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "6px",
        backgroundColor: "var(--vscode-button-background)",
    },
    buttonLabel: {
        fontWeight: 400,
        fontSize: "14px",
        flex: 1,
    },
    activeIndicator: {
        width: "3px",
        height: "100%",
        position: "absolute" as const,
        left: 0,
        top: 0,
        backgroundColor: "var(--vscode-terminal-ansiGreen)",
    },
    icon: {
        fontSize: "16px",
        color: "var(--vscode-button-foreground)",
    },
    divider: {
        margin: "8px 0",
        opacity: 0.4,
    },
    version: {
        fontSize: "11px",
        color: "var(--vscode-descriptionForeground)",
        marginTop: "auto",
        textAlign: "center" as const,
        opacity: 0.7,
        paddingTop: "24px",
    },
};

function MainMenu() {
    const [state, setState] = useState<State>({
        menuConfig: [],
        activeViewId: null,
    });

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case "updateMenu":
                    setState((prevState) => ({
                        ...prevState,
                        menuConfig: message.menuConfig,
                    }));
                    break;
                case "setActiveView":
                    setState((prevState) => ({
                        ...prevState,
                        activeViewId: message.viewId,
                    }));
                    break;
            }
        };

        window.addEventListener("message", handleMessage);

        // Use the globally available vscode object
        try {
            vscode.postMessage({ command: "webviewReady" });
        } catch (error) {
            console.error("Could not send webviewReady message:", error);
        }

        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const focusView = (viewId: string) => {
        setState((prevState) => ({
            ...prevState,
            activeViewId: viewId,
        }));

        try {
            vscode.postMessage({
                command: "focusView",
                viewId: viewId,
            });
        } catch (error) {
            console.error("Could not focus view:", viewId, error);
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <i
                    className="codicon codicon-book"
                    style={{ ...styles.icon, fontSize: "24px" }}
                ></i>
                <span style={styles.headerTitle}>Codex Translation Editor</span>
            </div>

            {state.menuConfig.map((section, index) => (
                <div key={section.title} style={styles.sectionContainer}>
                    <span style={styles.sectionTitle}>{section.title}</span>
                    <div style={styles.buttonsContainer}>
                        {section.buttons.map((button) => (
                            <button
                                key={button.id}
                                onClick={() => focusView(button.viewId)}
                                style={styles.button}
                                title={button.description || ""}
                            >
                                {state.activeViewId === button.viewId && (
                                    <div style={styles.activeIndicator}></div>
                                )}
                                <div
                                    style={{
                                        ...styles.buttonContent,
                                        backgroundColor:
                                            state.activeViewId === button.viewId
                                                ? "var(--vscode-list-activeSelectionBackground)"
                                                : "transparent",
                                    }}
                                >
                                    <div style={styles.iconContainer}>
                                        <i
                                            className={`codicon codicon-${button.icon}`}
                                            style={styles.icon}
                                        ></i>
                                    </div>
                                    <span
                                        style={{
                                            ...styles.buttonLabel,
                                            color:
                                                state.activeViewId === button.viewId
                                                    ? "var(--vscode-list-activeSelectionForeground)"
                                                    : "var(--vscode-foreground)",
                                        }}
                                    >
                                        {button.label}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                    {index < state.menuConfig.length - 1 && (
                        <VSCodeDivider style={styles.divider} />
                    )}
                </div>
            ))}

            <style>{`
                button:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
            `}</style>

            <div style={styles.version}>Codex Translation Editor v0.3.12</div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<MainMenu />);
