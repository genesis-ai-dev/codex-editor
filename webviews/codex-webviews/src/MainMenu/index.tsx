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

// Styles object to keep things organized
const styles = {
    container: {
        padding: "16px",
        height: "100vh",
        overflow: "auto",
        display: "flex",
        flexDirection: "column" as const,
        gap: "20px",
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "8px",
    },
    headerTitle: {
        fontSize: "16px",
        fontWeight: 600,
        color: "var(--vscode-foreground)",
    },
    sectionTitle: {
        fontSize: "14px",
        fontWeight: 600,
        color: "var(--vscode-foreground)",
        marginBottom: "8px",
    },
    sectionContainer: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "12px",
    },
    buttonsContainer: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "8px",
    },
    button: {
        height: "auto",
        padding: "10px",
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "flex-start",
        gap: "6px",
        textAlign: "left" as const,
        borderRadius: "4px",
        transition: "all 0.2s ease",
        position: "relative" as const,
    },
    buttonTop: {
        display: "flex",
        gap: "8px",
        alignItems: "center",
        width: "100%",
    },
    buttonLabel: {
        fontWeight: 500,
        fontSize: "13px",
        flex: 1,
    },
    buttonDescription: {
        fontSize: "11px",
        lineHeight: 1.3,
        color: "var(--vscode-descriptionForeground)",
    },
    activeIndicator: {
        position: "absolute" as const,
        top: "10px",
        right: "10px",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: "var(--vscode-terminal-ansiGreen)",
    },
    icon: {
        fontSize: "18px",
        color: "var(--vscode-button-foreground)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    backButton: {
        display: "flex",
        gap: "6px",
        alignItems: "center",
        padding: "4px 8px",
        fontSize: "12px",
        backgroundColor: "transparent",
        border: "none",
        cursor: "pointer",
        color: "var(--vscode-foreground)",
        borderRadius: "4px",
        transition: "all 0.2s ease",
        "&:hover": {
            backgroundColor: "var(--vscode-button-secondaryHoverBackground)",
        },
    },
    version: {
        fontSize: "11px",
        color: "var(--vscode-descriptionForeground)",
        marginTop: "auto",
        textAlign: "center" as const,
        opacity: 0.7,
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

    // Function to return to main menu
    const returnToMainMenu = () => {
        try {
            vscode.postMessage({
                command: "focusView",
                viewId: "codex-editor.mainMenu",
            });
        } catch (error) {
            console.error("Could not return to main menu:", error);
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <i className="codicon codicon-menu" style={styles.icon}></i>
                <span style={styles.headerTitle}>Codex Translation Editor</span>
            </div>

            {state.menuConfig.map((section, index) => (
                <div key={section.title} style={styles.sectionContainer}>
                    <span style={styles.sectionTitle}>{section.title}</span>
                    <div style={styles.buttonsContainer}>
                        {section.buttons.map((button) => (
                            <VSCodeButton
                                key={button.id}
                                onClick={() => focusView(button.viewId)}
                                style={styles.button}
                            >
                                {state.activeViewId === button.viewId && (
                                    <div style={styles.activeIndicator}></div>
                                )}
                                <div style={styles.buttonTop}>
                                    <i
                                        className={`codicon codicon-${button.icon}`}
                                        style={styles.icon}
                                    ></i>
                                    <span style={styles.buttonLabel}>{button.label}</span>
                                </div>
                                {button.description && (
                                    <div style={styles.buttonDescription}>{button.description}</div>
                                )}
                            </VSCodeButton>
                        ))}
                    </div>
                    {index < state.menuConfig.length - 1 && <VSCodeDivider />}
                </div>
            ))}

            <div style={styles.version}>Codex Translation Editor v0.3.12</div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<MainMenu />);
