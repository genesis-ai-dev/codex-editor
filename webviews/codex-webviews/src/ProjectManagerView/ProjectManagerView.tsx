import { useEffect, useState } from "react";
import {
    VSCodeButton,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
} from "@vscode/webview-ui-toolkit/react";
import {
    ProjectManagerMessageFromWebview,
    ProjectManagerMessageToWebview,
    ProjectManagerState,
} from "../../../../types";
import "./App.css";

declare const vscode: {
    postMessage: (message: any) => void;
};

const getLanguageDisplay = (languageObj: any): string => {
    if (!languageObj) return "Missing";
    if (typeof languageObj === "string") return languageObj;
    if (languageObj.name && typeof languageObj.name === "object") {
        const name = languageObj.name.en || Object.values(languageObj.name)[0];
        return languageObj.tag ? `${name} (${languageObj.tag})` : name;
    }
    return "Unknown";
};

// Add this helper component for consistent styling
interface ProjectFieldProps {
    label: string;
    value: React.ReactNode;
    icon?: string;
    onAction?: () => void;
    hasWarning?: boolean;
}

const ProjectField = ({ label, value, icon, onAction, hasWarning }: ProjectFieldProps) => (
    <div
        style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            padding: "0.75rem",
            backgroundColor: "var(--vscode-list-hoverBackground)",
            borderRadius: "4px",
        }}
    >
        <div
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
            }}
        >
            <span style={{ fontWeight: "bold" }}>{label}</span>
            {onAction && icon && (
                <VSCodeButton onClick={onAction}>
                    <i className={`codicon codicon-${icon}`}></i>
                </VSCodeButton>
            )}
        </div>
        <div
            style={{
                color: hasWarning ? "var(--vscode-errorForeground)" : "inherit",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
            }}
        >
            {value}
            {hasWarning && <i className="codicon codicon-warning"></i>}
        </div>
    </div>
);

function ProjectManagerView() {
    const [state, setState] = useState<ProjectManagerState>({
        projects: [],
        projectOverview: null,
        isScanning: true,
        watchedFolders: [],
        canInitializeProject: false,
        workspaceIsOpen: true,
        webviewReady: false,
        repoHasRemote: false,
    });

    const [initialized, setInitialized] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    const handleAction = (message: ProjectManagerMessageFromWebview) => {
        vscode.postMessage(message as ProjectManagerMessageFromWebview);

        // List of commands that modify the project state
        const stateChangingCommands = [
            "initializeProject",
            "renameProject",
            "changeSourceLanguage",
            "changeTargetLanguage",
            "editAbbreviation",
            "selectCategory",
            "openSourceUpload",
            "openAISettings",
            "exportProjectAsPlaintext",
        ];

        // If the command modifies state, request a refresh
        if (stateChangingCommands.includes(message.command)) {
            // Add a small delay to allow the command to complete
            setTimeout(() => {
                vscode.postMessage({ command: "refreshState" } as ProjectManagerMessageFromWebview);
            }, 100);
        }
    };

    useEffect(() => {
        vscode.postMessage({ command: "checkPublishStatus" } as ProjectManagerMessageFromWebview);
    }, []);

    useEffect(() => {
        const handler = (message: MessageEvent<ProjectManagerMessageToWebview>) => {
            if (message.data.command === "stateUpdate") {
                setState(message.data.data);
                setInitialized(true);
            }
        };

        window.addEventListener("message", handler);

        // Initial state request with retry logic
        const requestInitialState = () => {
            vscode.postMessage({ command: "webviewReady" } as ProjectManagerMessageFromWebview);
        };

        const retryWithBackoff = () => {
            if (!initialized && retryCount < 5) {
                // Max 5 retries
                const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 10000); // Max 10 seconds
                setTimeout(() => {
                    requestInitialState();
                    setRetryCount((prev) => prev + 1);
                }, backoffTime);
            }
        };

        // Initial request
        requestInitialState();

        // Setup retry timer
        const retryTimer = setTimeout(retryWithBackoff, 1000);

        return () => {
            window.removeEventListener("message", handler);
            clearTimeout(retryTimer);
        };
    }, [initialized, retryCount]);

    // Show loading state with retry information
    if (!initialized) {
        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100vh",
                    gap: "1rem",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                    }}
                >
                    <i className="codicon codicon-loading codicon-modifier-spin"></i>
                    <span>
                        Loading project manager
                        {retryCount > 0 ? ` (attempt ${retryCount + 1})` : ""}...
                    </span>
                </div>
                {retryCount >= 5 && (
                    <VSCodeButton
                        onClick={() => {
                            setRetryCount(0);
                            vscode.postMessage({ command: "webviewReady" });
                        }}
                    >
                        <i className="codicon codicon-refresh"></i>
                        Retry Loading
                    </VSCodeButton>
                )}
            </div>
        );
    }

    // Show scanning indicator only after initial load
    if (state.isScanning) {
        return (
            <div
                style={{
                    padding: "1rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                }}
            >
                <i className="codicon codicon-loading codicon-modifier-spin"></i>
                <span>Scanning projects...</span>
            </div>
        );
    }

    return (
        <div
            style={{
                height: "100vh",
                padding: "0.25rem",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <VSCodePanels>
                <VSCodePanelTab id="current-project">Current Project</VSCodePanelTab>

                <VSCodePanelView id="current-project-view">
                    {state.canInitializeProject ? (
                        // Initialize project button section
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                height: "100%",
                            }}
                        >
                            <VSCodeButton
                                onClick={() => handleAction({ command: "initializeProject" })}
                            >
                                <i className="codicon codicon-plus"></i>
                                <div style={{ marginInline: "0.25rem" }}>Initialize Project</div>
                            </VSCodeButton>
                        </div>
                    ) : state.projectOverview ? (
                        // Project details section
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "1rem",
                                margin: "0 auto",
                                width: "100%",
                            }}
                        >
                            {state.projectOverview.isAuthenticated && (
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "0.5rem",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-account"></i>
                                        <span>{state.projectOverview.userName}</span>
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-mail"></i>
                                        <span>{state.projectOverview.userEmail}</span>
                                    </div>

                                    {/* <VSCodeButton onClick={() => handleAction({ command: "logout" })}></VSCodeButton> */}
                                </div>
                            )}
                            <ProjectField
                                label="Project Name"
                                value={state.projectOverview.projectName ?? "Missing"}
                                icon="pencil"
                                onAction={() => handleAction({ command: "renameProject" })}
                                hasWarning={!state.projectOverview.projectName}
                            />
                            <ProjectField
                                label="Source Language"
                                value={getLanguageDisplay(state.projectOverview.sourceLanguage)}
                                icon="source-control"
                                onAction={() => handleAction({ command: "changeSourceLanguage" })}
                                hasWarning={!state.projectOverview.sourceLanguage}
                            />
                            <ProjectField
                                label="Target Language"
                                value={getLanguageDisplay(state.projectOverview.targetLanguage)}
                                icon="globe"
                                onAction={() => handleAction({ command: "changeTargetLanguage" })}
                                hasWarning={!state.projectOverview.targetLanguage}
                            />
                            <ProjectField
                                label="Abbreviation"
                                value={state.projectOverview.abbreviation?.toString() ?? "Missing"}
                                icon="pencil"
                                onAction={() => handleAction({ command: "editAbbreviation" })}
                                hasWarning={!state.projectOverview.abbreviation}
                            />
                            <ProjectField
                                label="Category"
                                value={String(state.projectOverview.category) ?? "Missing"}
                                icon="pencil"
                                onAction={() => handleAction({ command: "selectCategory" })}
                                hasWarning={!state.projectOverview.category}
                            />
                            <ProjectField
                                label="Source Texts"
                                value={
                                    state.projectOverview.sourceTexts &&
                                    state.projectOverview.sourceTexts.length > 0
                                        ? `${state.projectOverview.sourceTexts.length} texts`
                                        : "Missing"
                                }
                                icon="preview"
                                onAction={() => handleAction({ command: "openSourceUpload" })}
                                hasWarning={!state.projectOverview.sourceTexts?.length}
                            />
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "1rem",
                                    flexWrap: "wrap",
                                    marginTop: "1rem",
                                }}
                            >
                                <VSCodeButton
                                    onClick={() => handleAction({ command: "openAISettings" })}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-settings"></i> Copilot
                                        Settings
                                    </div>
                                </VSCodeButton>

                                <VSCodeButton
                                    onClick={() => handleAction({ command: "openEditAnalysis" })}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-graph"></i> AI Metrics
                                    </div>
                                </VSCodeButton>

                                <VSCodeButton
                                    onClick={() =>
                                        handleAction({ command: "exportProjectAsPlaintext" })
                                    }
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-export"></i> Export Project
                                    </div>
                                </VSCodeButton>
                                {!state.repoHasRemote && (
                                    <VSCodeButton
                                        onClick={() => handleAction({ command: "publishProject" })}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "0.5rem",
                                            }}
                                        >
                                            <i className="codicon codicon-cloud-upload"></i> Publish
                                            Project
                                        </div>
                                    </VSCodeButton>
                                )}
                                {state.repoHasRemote && (
                                    <VSCodeButton
                                        onClick={() => handleAction({ command: "syncProject" })}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "0.5rem",
                                            }}
                                        >
                                            <i className="codicon codicon-sync"></i> Sync Project
                                        </div>
                                    </VSCodeButton>
                                )}
                                <VSCodeButton
                                    onClick={() => handleAction({ command: "closeProject" })}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-close"></i> Close Project
                                    </div>
                                </VSCodeButton>
                            </div>
                        </div>
                    ) : (
                        // No project message
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                height: "100%",
                            }}
                        >
                            <span>No project found in current workspace</span>
                        </div>
                    )}
                </VSCodePanelView>
            </VSCodePanels>
        </div>
    );
}

export default ProjectManagerView;
