import { useEffect, useState, useCallback } from "react";
import {
    VSCodeButton,
    VSCodeDataGrid,
    VSCodeDataGridCell,
    VSCodeDataGridRow,
} from "@vscode/webview-ui-toolkit/react";
import { ProjectOverview } from "../../../../types";

const vscode = acquireVsCodeApi();

// Add this helper function at the top of the file, outside of the App component
const getLanguageDisplay = (languageObj: any): string => {
    if (!languageObj) return "Missing";
    if (typeof languageObj === "string") return languageObj;
    if (languageObj.name && typeof languageObj.name === "object") {
        const name = languageObj.name.en || Object.values(languageObj.name)[0];
        return languageObj.tag ? `${name} (${languageObj.tag})` : name;
    }
    return "Unknown";
};

function App() {
    const [projectOverview, setProjectOverview] = useState<ProjectOverview | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [noProjectFound, setNoProjectFound] = useState(false);
    const [initialLoadAttempted, setInitialLoadAttempted] = useState(false);
    const [primarySourceText, setprimarySourceText] = useState<string | null>(null);

    const handleMessage = useCallback((event: MessageEvent) => {
        console.log("Received message:", event.data);
        const message = event.data;
        switch (message.command) {
            case "sendProjectOverview":
            case "projectCreated": {
                console.log("Setting project overview:", message.data);
                setProjectOverview(message.data);
                setprimarySourceText(message.data.primarySourceText);
                setIsLoading(false);
                setError(null);
                setNoProjectFound(false);
                setInitialLoadAttempted(true);
                break;
            }
            case "noProjectFound": {
                setNoProjectFound(true);
                setIsLoading(false);
                setError(null);
                setInitialLoadAttempted(true);
                break;
            }
            case "refreshProjectOverview": {
                // Request a fresh project overview
                vscode.postMessage({ command: "requestProjectOverview" });
                break;
            }
            case "error": {
                console.error("Error received:", message.message);
                setError(message.message);
                setIsLoading(false);
                setInitialLoadAttempted(true);
                break;
            }
            default:
                console.log("Unhandled message command:", message.command);
                break;
        }
    }, []);

    useEffect(() => {
        window.addEventListener("message", handleMessage);

        // Signal that the webview is ready
        vscode.postMessage({ command: "webviewReady" });

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [handleMessage]);

    // Log state changes and request project overview
    useEffect(() => {
        console.log("Project Overview updated:", projectOverview);
        if (!projectOverview && !initialLoadAttempted) {
            setIsLoading(true);
            vscode.postMessage({ command: "requestProjectOverview" });
        }
    }, [projectOverview, initialLoadAttempted]);

    // Delay showing error message
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => {
                if (!projectOverview && !noProjectFound) {
                    setError("Failed to load project overview. Please try again.");
                }
            }, 2000); // 2 second delay

            return () => clearTimeout(timer);
        }
    }, [error, projectOverview, noProjectFound]);

    const handleAction = useCallback((command: string, data?: any) => {
        setIsLoading(true);
        setError(null);
        vscode.postMessage({ command, data });

        // Schedule a refresh after a short delay
        setTimeout(() => {
            vscode.postMessage({ command: "requestProjectOverview" });
        }, 1500); // Wait for 1.5 seconds before requesting an update
    }, []);

    const handleSelectprimarySourceText = useCallback(
        (biblePath: string) => {
            handleAction("selectprimarySourceText", biblePath);
        },
        [handleAction]
    );

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "start",
                alignItems: "center",
                height: "100vh",
            }}
        >
            {isLoading ? (
                <div>Loading project overview...</div>
            ) : error && !projectOverview && !noProjectFound ? (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "2rem",
                    }}
                >
                    <p style={{ color: "var(--vscode-errorForeground)" }}>{error}</p>
                    <VSCodeButton onClick={() => handleAction("requestProjectOverview")}>
                        Retry
                    </VSCodeButton>
                </div>
            ) : noProjectFound ? (
                <div>
                    <VSCodeButton
                        onClick={() => handleAction("createNewProject")}
                        style={{ marginTop: "2rem" }}
                    >
                        <i className="codicon codicon-plus"></i> Create New Project
                    </VSCodeButton>
                </div>
            ) : projectOverview ? (
                <VSCodeDataGrid grid-template-columns="1fr 1fr auto">
                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Project Name</VSCodeDataGridCell>
                        <VSCodeDataGridCell
                            grid-column="2"
                            style={{
                                color: projectOverview.projectName
                                    ? "inherit"
                                    : "var(--vscode-errorForeground)",
                            }}
                        >
                            {projectOverview.projectName ?? "Missing"}
                            {!projectOverview.projectName && (
                                <i
                                    className="codicon codicon-warning"
                                    style={{ marginLeft: "8px" }}
                                ></i>
                            )}
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            <VSCodeButton onClick={() => handleAction("renameProject")}>
                                <i className="codicon codicon-pencil"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">User Name</VSCodeDataGridCell>
                        <VSCodeDataGridCell
                            grid-column="2"
                            style={{
                                color: projectOverview.userName
                                    ? "inherit"
                                    : "var(--vscode-errorForeground)",
                            }}
                        >
                            {projectOverview.userName ?? "Missing"}
                            {!projectOverview.userName && (
                                <i
                                    className="codicon codicon-warning"
                                    style={{ marginLeft: "8px" }}
                                ></i>
                            )}
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            <VSCodeButton onClick={() => handleAction("changeUserName")}>
                                <i className="codicon codicon-account"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Source Language</VSCodeDataGridCell>
                        <VSCodeDataGridCell
                            grid-column="2"
                            style={{
                                color: projectOverview.sourceLanguage
                                    ? "inherit"
                                    : "var(--vscode-errorForeground)",
                            }}
                        >
                            {getLanguageDisplay(projectOverview.sourceLanguage)}
                            {!projectOverview.sourceLanguage && (
                                <i
                                    className="codicon codicon-warning"
                                    style={{ marginLeft: "8px" }}
                                ></i>
                            )}
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            <VSCodeButton onClick={() => handleAction("changeSourceLanguage")}>
                                <i className="codicon codicon-source-control"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Target Language</VSCodeDataGridCell>
                        <VSCodeDataGridCell
                            grid-column="2"
                            style={{
                                color: projectOverview.targetLanguage
                                    ? "inherit"
                                    : "var(--vscode-errorForeground)",
                            }}
                        >
                            {getLanguageDisplay(projectOverview.targetLanguage)}
                            {!projectOverview.targetLanguage && (
                                <i
                                    className="codicon codicon-warning"
                                    style={{ marginLeft: "8px" }}
                                ></i>
                            )}
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            <VSCodeButton onClick={() => handleAction("changeTargetLanguage")}>
                                <i className="codicon codicon-globe"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Abbreviation</VSCodeDataGridCell>
                        <VSCodeDataGridCell
                            grid-column="2"
                            style={{
                                color: projectOverview.abbreviation
                                    ? "inherit"
                                    : "var(--vscode-errorForeground)",
                            }}
                        >
                            {projectOverview.abbreviation?.toString() ?? "Missing"}
                            {!projectOverview.abbreviation && (
                                <i
                                    className="codicon codicon-warning"
                                    style={{ marginLeft: "8px" }}
                                ></i>
                            )}
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            <VSCodeButton onClick={() => handleAction("editAbbreviation")}>
                                <i className="codicon codicon-pencil"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Category</VSCodeDataGridCell>
                        <VSCodeDataGridCell
                            grid-column="2"
                            style={{
                                color: projectOverview.category
                                    ? "inherit"
                                    : "var(--vscode-errorForeground)",
                            }}
                        >
                            {String(projectOverview.category) ?? "Missing"}
                            {!projectOverview.category && (
                                <i
                                    className="codicon codicon-warning"
                                    style={{ marginLeft: "8px" }}
                                ></i>
                            )}
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            <VSCodeButton onClick={() => handleAction("selectCategory")}>
                                <i className="codicon codicon-pencil"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Source Texts</VSCodeDataGridCell>
                        <VSCodeDataGridCell
                            grid-column="2"
                            style={{
                                color:
                                    projectOverview.sourceTexts &&
                                    projectOverview.sourceTexts.length > 0
                                        ? "inherit"
                                        : "var(--vscode-errorForeground)",
                            }}
                        >
                            {projectOverview.sourceTexts &&
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
                            )}
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell
                            grid-column="3"
                            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
                        >
                            <VSCodeButton onClick={() => handleAction("downloadSourceText")}>
                                <i className="codicon codicon-cloud-download"></i>
                            </VSCodeButton>
                            <VSCodeButton onClick={() => handleAction("openSourceUpload")}>
                                <i className="codicon codicon-new-folder"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Copilot Settings</VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            <VSCodeButton onClick={() => handleAction("openAISettings")}>
                                <i className="codicon codicon-settings"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Export Project</VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            <VSCodeButton onClick={() => handleAction("exportProjectAsPlaintext")}>
                                <i className="codicon codicon-export"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>

                    <VSCodeDataGridRow>
                        <VSCodeDataGridCell grid-column="1">Publish Project</VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            {/* <VSCodeButton onClick={() => handleAction("publishProject")}> */}
                            <VSCodeButton
                                onClick={() => alert("Publish Project not implemented yet.")}
                            >
                                <i className="codicon codicon-cloud-upload"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>
                </VSCodeDataGrid>
            ) : (
                "No project overview available"
            )}
        </div>
    );
}
export default App;
