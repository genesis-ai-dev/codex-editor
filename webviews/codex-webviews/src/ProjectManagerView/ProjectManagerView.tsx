import { useEffect, useState } from "react";
import {
    VSCodeButton,
    VSCodeDataGrid,
    VSCodeDataGridCell,
    VSCodeDataGridRow,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
} from "@vscode/webview-ui-toolkit/react";
import { ProjectOverview } from "../../../../types";
import { ProjectList } from "./ProjectList";
import "./App.css";

declare const vscode: {
    postMessage: (message: any) => void;
};

interface ProjectState {
    projects: Array<{
        name: string;
        path: string;
        lastOpened?: Date;
        lastModified: Date;
        version: string;
        hasVersionMismatch?: boolean;
        isOutdated?: boolean;
    }> | null;
    watchedFolders: [];
    projectOverview: ProjectOverview | null;
    isScanning: boolean;
}

const getLanguageDisplay = (languageObj: any): string => {
    if (!languageObj) return "Missing";
    if (typeof languageObj === "string") return languageObj;
    if (languageObj.name && typeof languageObj.name === "object") {
        const name = languageObj.name.en || Object.values(languageObj.name)[0];
        return languageObj.tag ? `${name} (${languageObj.tag})` : name;
    }
    return "Unknown";
};

function ProjectManagerView() {
    const [state, setState] = useState<ProjectState>({
        projects: null,
        projectOverview: null,
        isScanning: true,
        watchedFolders: [],
    });

    const [initialized, setInitialized] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    const handleAction = (command: string, data?: any) => {
        vscode.postMessage({ command, data });
    };

    useEffect(() => {
        const handler = (message: MessageEvent) => {
            if (message.data.type === "stateUpdate") {
                setState(message.data.state);
                setInitialized(true);
            }
        };

        window.addEventListener("message", handler);

        // Initial state request with retry logic
        const requestInitialState = () => {
            vscode.postMessage({ command: "webviewReady" });
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
                width: "100%",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <VSCodePanels style={{ width: "100%" }}>
                <VSCodePanelTab id="current-project">Current Project</VSCodePanelTab>
                <VSCodePanelTab id="all-projects">All Projects</VSCodePanelTab>

                <VSCodePanelView
                    id="current-project-view"
                    style={{
                        width: "100%",
                        padding: "1rem",
                    }}
                >
                    {state.projectOverview ? (
                        <div style={{ width: "100%" }}>
                            <VSCodeDataGrid
                                style={{ width: "100%" }}
                                grid-template-columns="minmax(120px, 1fr) 2fr auto"
                            >
                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Project Name
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="2">
                                        {state.projectOverview?.projectName ?? "Missing"}
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        <VSCodeButton onClick={() => handleAction("renameProject")}>
                                            <i className="codicon codicon-pencil"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        User Name
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell
                                        grid-column="2"
                                        style={{
                                            color: state.projectOverview?.userName
                                                ? "inherit"
                                                : "var(--vscode-errorForeground)",
                                        }}
                                    >
                                        {state.projectOverview?.userName ?? "Missing"}
                                        {!state.projectOverview?.userName && (
                                            <i
                                                className="codicon codicon-warning"
                                                style={{ marginLeft: "8px" }}
                                            ></i>
                                        )}
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        <VSCodeButton
                                            onClick={() => handleAction("changeUserName")}
                                        >
                                            <i className="codicon codicon-account"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Source Language
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell
                                        grid-column="2"
                                        style={{
                                            color: state.projectOverview?.sourceLanguage
                                                ? "inherit"
                                                : "var(--vscode-errorForeground)",
                                        }}
                                    >
                                        {getLanguageDisplay(state.projectOverview?.sourceLanguage)}
                                        {!state.projectOverview?.sourceLanguage && (
                                            <i
                                                className="codicon codicon-warning"
                                                style={{ marginLeft: "8px" }}
                                            ></i>
                                        )}
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        <VSCodeButton
                                            onClick={() => handleAction("changeSourceLanguage")}
                                        >
                                            <i className="codicon codicon-source-control"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Target Language
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell
                                        grid-column="2"
                                        style={{
                                            color: state.projectOverview?.targetLanguage
                                                ? "inherit"
                                                : "var(--vscode-errorForeground)",
                                        }}
                                    >
                                        {getLanguageDisplay(state.projectOverview?.targetLanguage)}
                                        {!state.projectOverview?.targetLanguage && (
                                            <i
                                                className="codicon codicon-warning"
                                                style={{ marginLeft: "8px" }}
                                            ></i>
                                        )}
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        <VSCodeButton
                                            onClick={() => handleAction("changeTargetLanguage")}
                                        >
                                            <i className="codicon codicon-globe"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Abbreviation
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell
                                        grid-column="2"
                                        style={{
                                            color: state.projectOverview?.abbreviation
                                                ? "inherit"
                                                : "var(--vscode-errorForeground)",
                                        }}
                                    >
                                        {state.projectOverview?.abbreviation?.toString() ??
                                            "Missing"}
                                        {!state.projectOverview?.abbreviation && (
                                            <i
                                                className="codicon codicon-warning"
                                                style={{ marginLeft: "8px" }}
                                            ></i>
                                        )}
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        <VSCodeButton
                                            onClick={() => handleAction("editAbbreviation")}
                                        >
                                            <i className="codicon codicon-pencil"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Category
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell
                                        grid-column="2"
                                        style={{
                                            color: state.projectOverview?.category
                                                ? "inherit"
                                                : "var(--vscode-errorForeground)",
                                        }}
                                    >
                                        {String(state.projectOverview?.category) ?? "Missing"}
                                        {!state.projectOverview?.category && (
                                            <i
                                                className="codicon codicon-warning"
                                                style={{ marginLeft: "8px" }}
                                            ></i>
                                        )}
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        <VSCodeButton
                                            onClick={() => handleAction("selectCategory")}
                                        >
                                            <i className="codicon codicon-pencil"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Source Texts
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell
                                        grid-column="2"
                                        style={{
                                            color:
                                                state.projectOverview?.sourceTexts &&
                                                state.projectOverview?.sourceTexts.length > 0
                                                    ? "inherit"
                                                    : "var(--vscode-errorForeground)",
                                        }}
                                    >
                                        {/* {projectOverview.sourceTexts &&
                                        projectOverview.sourceTexts.length > 0 ? (
                                            <ul>
                                                {projectOverview.sourceTexts.map((bible) => {
                                                    const fileName = bible.path.split("/").pop() || "";
                                                    const isPrimary = bible.path === primarySourceText;
                                                    return (
                                                        <li
                                                            key={bible.path}
                                                            style={{
                                                                marginBottom: "4px",
                                                                listStyleType: "none",
                                                                padding: "4px",
                                                                backgroundColor:
                                                                    "var(--vscode-editor-background)",
                                                                border: "1px solid var(--vscode-widget-border)",
                                                                borderRadius: "3px",
                                                            }}
                                                        >
                                                            {isPrimary && (
                                                                <i
                                                                    className="codicon codicon-star-full"
                                                                    style={{
                                                                        marginRight: "4px",
                                                                        color: "var(--vscode-inputValidation-infoForeground)",
                                                                    }}
                                                                    title="Primary source Bible"
                                                                ></i>
                                                            )}
                                                            {!isPrimary && (
                                                                <VSCodeButton
                                                                    appearance="icon"
                                                                    onClick={() =>
                                                                        handleSelectprimarySourceText(
                                                                            bible.path
                                                                        )
                                                                    }
                                                                    title="Set as primary source Bible"
                                                                    style={{
                                                                        float: "right",
                                                                        color: "var(--vscode-inputValidation-infoForeground)",
                                                                    }}
                                                                >
                                                                    <i className="codicon codicon-star-empty"></i>
                                                                </VSCodeButton>
                                                            )}
                                                            <a
                                                                href="#"
                                                                onClick={() => handleAction("openBible", bible)}
                                                                style={{
                                                                    textDecoration: "none",
                                                                    color: "var(--vscode-textLink-foreground)",
                                                                }}
                                                            >
                                                                {fileName}
                                                            </a>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        ) : (
                                            <>
                                                Missing
                                                <i
                                                    className="codicon codicon-warning"
                                                    style={{ marginLeft: "8px" }}
                                                ></i>
                                            </>
                                        )} */}
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell
                                        grid-column="3"
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "8px",
                                        }}
                                    >
                                        {/* <VSCodeButton onClick={() => handleAction("downloadSourceText")}>
                                            <i className="codicon codicon-cloud-download"></i>
                                        </VSCodeButton> */}
                                        <VSCodeButton
                                            onClick={() => handleAction("openSourceUpload")}
                                        >
                                            <i className="codicon codicon-preview"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Copilot Settings
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        <VSCodeButton
                                            onClick={() => handleAction("openAISettings")}
                                        >
                                            <i className="codicon codicon-settings"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Export Project
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        <VSCodeButton
                                            onClick={() => handleAction("exportProjectAsPlaintext")}
                                        >
                                            <i className="codicon codicon-export"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>

                                <VSCodeDataGridRow>
                                    <VSCodeDataGridCell grid-column="1">
                                        Publish Project
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell grid-column="3">
                                        {/* <VSCodeButton onClick={() => handleAction("publishProject")}> */}
                                        <VSCodeButton
                                            onClick={() =>
                                                alert("Publish Project not implemented yet.")
                                            }
                                        >
                                            <i className="codicon codicon-cloud-upload"></i>
                                        </VSCodeButton>
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>
                            </VSCodeDataGrid>
                        </div>
                    ) : (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: "2rem",
                                width: "100%",
                                padding: "2rem",
                            }}
                        >
                            <VSCodeButton onClick={() => handleAction("initializeProject")}>
                                <i className="codicon codicon-plus"></i>
                                <div style={{ marginInline: "0.25rem" }}>Initialize Project</div>
                            </VSCodeButton>
                        </div>
                    )}
                </VSCodePanelView>

                <VSCodePanelView id="all-projects-view" style={{ width: "100%" }}>
                    <ProjectList
                        projects={state.projects}
                        watchedFolders={state.watchedFolders || []}
                        onCreateNew={() => handleAction("createNewWorkspaceAndProject")}
                        onOpenProject={(path) => handleAction("openProject", { path })}
                        onAddWatchFolder={() => handleAction("addWatchFolder")}
                        onRemoveWatchFolder={(path) => handleAction("removeWatchFolder", { path })}
                        onRefreshProjects={() => handleAction("refreshProjects")}
                        showBackButton={false}
                    />
                </VSCodePanelView>
            </VSCodePanels>
        </div>
    );
}

export default ProjectManagerView;
