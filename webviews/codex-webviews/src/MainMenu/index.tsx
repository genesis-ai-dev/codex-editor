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
        padding: "16px 8px",
        height: "100vh",
        overflow: "auto",
        display: "flex",
        flexDirection: "column" as const,
        gap: "16px",
        maxWidth: "800px",
        margin: "0 auto",
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "4px",
        borderBottom: "1px solid var(--vscode-tab-inactiveBackground)",
        paddingBottom: "12px",
        flexWrap: "wrap" as const,
    },
    headerTitle: {
        fontSize: "16px",
        fontWeight: 300,
        color: "var(--vscode-foreground)",
        letterSpacing: "0.2px",
        lineHeight: 1.4,
        whiteSpace: "nowrap" as const,
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    sectionTitle: {
        fontSize: "12px",
        fontWeight: 600,
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.8px",
        marginBottom: "8px",
    },
    sectionContainer: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "10px",
    },
    buttonsContainer: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: "6px",
    },
    button: {
        height: "auto",
        padding: "0",
        display: "flex",
        flexDirection: "row" as const,
        alignItems: "center",
        textAlign: "left" as const,
        borderRadius: "4px",
        transition: "all 0.2s ease",
        position: "relative" as const,
        border: "none",
        background: "transparent",
        overflow: "hidden",
        cursor: "pointer",
        width: "100%",
        minWidth: "0",
    },
    buttonContent: {
        display: "flex",
        alignItems: "center",
        padding: "8px 6px",
        width: "100%",
        height: "100%",
        borderRadius: "4px",
        gap: "6px",
    },
    iconContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "24px",
        height: "24px",
        borderRadius: "4px",
        backgroundColor: "var(--vscode-button-background)",
        flexShrink: 0,
    },
    buttonLabel: {
        fontWeight: 400,
        fontSize: "13px",
        flex: 1,
        whiteSpace: "nowrap" as const,
        overflow: "hidden",
        textOverflow: "ellipsis",
        minWidth: "0",
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
        fontSize: "14px",
        color: "var(--vscode-button-foreground)",
    },
    divider: {
        margin: "4px 0",
        opacity: 0.4,
    },
    version: {
        fontSize: "10px",
        color: "var(--vscode-descriptionForeground)",
        marginTop: "auto",
        textAlign: "center" as const,
        opacity: 0.7,
        paddingTop: "16px",
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
        <div className="container" style={styles.container}>
            {/* <div style={styles.header}>
                <i
                    className="codicon codicon-book icon"
                    style={{ ...styles.icon, fontSize: "18px" }}
                ></i>
                <span className="header-title" style={styles.headerTitle}>
                    Codex Translation Editor
                </span>
            </div> */}

            {state.menuConfig.map((section, index) => (
                <div key={section.title} style={styles.sectionContainer}>
                    <span className="section-title" style={styles.sectionTitle}>
                        {section.title}
                    </span>
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
                                    className="button-content"
                                    style={{
                                        ...styles.buttonContent,
                                        backgroundColor:
                                            state.activeViewId === button.viewId
                                                ? "var(--vscode-list-activeSelectionBackground)"
                                                : "transparent",
                                    }}
                                >
                                    <div className="icon-container" style={styles.iconContainer}>
                                        <i
                                            className={`codicon codicon-${button.icon} icon`}
                                            style={styles.icon}
                                        ></i>
                                    </div>
                                    <span
                                        className="button-label"
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
                /* Add responsive media queries */
                @media (max-width: 200px) {
                    .header-title {
                        display: none;
                    }
                    .container {
                        padding: 12px 4px;
                    }
                }
                @media (max-width: 140px) {
                    .button-label {
                        display: none;
                    }
                    .button-content {
                        padding: 8px 0;
                        justify-content: center;
                    }
                    .icon-container {
                        margin: 0 auto;
                    }
                    .section-title {
                        text-align: center;
                        font-size: 10px;
                    }
                    .container {
                        padding: 8px 2px;
                        gap: 12px;
                    }
                }
                @media (max-width: 100px) {
                    .version {
                        display: none;
                    }
                    .section-title {
                        font-size: 9px;
                        letter-spacing: 0.5px;
                    }
                    .icon-container {
                        min-width: 20px;
                        height: 20px;
                    }
                    .icon {
                        font-size: 12px;
                    }
                    .container {
                        padding: 6px 1px;
                        gap: 8px;
                    }
                }
            `}</style>

            <div className="version" style={styles.version}>
                Codex Translation Editor v0.3.12
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<MainMenu />);
