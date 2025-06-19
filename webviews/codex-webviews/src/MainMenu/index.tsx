import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { Separator } from "../components/ui/separator";
import { Alert, AlertDescription } from "../components/ui/alert";
import { SyncSettings } from "../components/SyncSettings";
import { cn } from "../lib/utils";
import "../tailwind.css";

// Declare the acquireVsCodeApi function and acquire the VS Code API
declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

interface MenuButton {
    id: string;
    label: string;
    icon: string;
    viewId?: string;
    command?: string;
    description?: string;
}

interface MenuSection {
    title: string;
    buttons: MenuButton[];
}

interface ProjectManagerState {
    projectOverview: any | null;
    webviewReady: boolean;
    watchedFolders: string[];
    projects: any[] | null;
    isScanning: boolean;
    canInitializeProject: boolean;
    workspaceIsOpen: boolean;
    repoHasRemote: boolean;
    isInitializing: boolean;
}

interface State {
    activeViewId: string | null;
    projectState: ProjectManagerState;
    autoSyncEnabled: boolean;
    syncDelayMinutes: number;
    progressData: any;
}

function MainMenu() {
    const [state, setState] = useState<State>({
        activeViewId: null,
        projectState: {
            projectOverview: null,
            webviewReady: false,
            watchedFolders: [],
            projects: null,
            isScanning: false,
            canInitializeProject: false,
            workspaceIsOpen: false,
            repoHasRemote: false,
            isInitializing: false,
        },
        autoSyncEnabled: true,
        syncDelayMinutes: 5,
        progressData: null,
    });

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case "setActiveView":
                    setState((prevState) => ({
                        ...prevState,
                        activeViewId: message.viewId,
                    }));
                    break;
                case "stateUpdate":
                    setState((prevState) => ({
                        ...prevState,
                        projectState: message.data,
                    }));
                    break;
                case "syncSettingsUpdate":
                    setState((prevState) => ({
                        ...prevState,
                        autoSyncEnabled: message.data.autoSyncEnabled ?? prevState.autoSyncEnabled,
                        syncDelayMinutes:
                            message.data.syncDelayMinutes ?? prevState.syncDelayMinutes,
                    }));
                    break;
                case "progressData":
                    setState((prevState) => ({
                        ...prevState,
                        progressData: message.data,
                    }));
                    break;
            }
        };

        window.addEventListener("message", handleMessage);

        // Use the globally available vscode object
        try {
            vscode.postMessage({ command: "webviewReady" });
            // Request sync settings
            vscode.postMessage({ command: "getSyncSettings" });
            // Request progress data
            vscode.postMessage({ command: "getProjectProgress" });
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

    const executeCommand = (commandName: string) => {
        try {
            vscode.postMessage({
                command: "executeCommand",
                commandName: commandName,
            });
        } catch (error) {
            console.error("Could not execute command:", commandName, error);
        }
    };

    const handleProjectAction = (command: string, data?: any) => {
        try {
            vscode.postMessage({
                command,
                data,
            });
        } catch (error) {
            console.error("Could not execute project action:", command, error);
        }
    };

    const handleToggleAutoSync = (enabled: boolean) => {
        setState((prevState) => ({
            ...prevState,
            autoSyncEnabled: enabled,
        }));
        handleProjectAction("updateSyncSettings", {
            autoSyncEnabled: enabled,
            syncDelayMinutes: state.syncDelayMinutes,
        });
    };

    const handleChangeSyncDelay = (minutes: number) => {
        setState((prevState) => ({
            ...prevState,
            syncDelayMinutes: minutes,
        }));
        handleProjectAction("updateSyncSettings", {
            autoSyncEnabled: state.autoSyncEnabled,
            syncDelayMinutes: minutes,
        });
    };

    const handleTriggerSync = () => {
        handleProjectAction("triggerSync");
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

    const { projectState } = state;

    // Show scanning indicator
    if (projectState.isScanning) {
        return (
            <div className="container mx-auto p-6 h-screen flex items-center justify-center">
                <div className="flex items-center gap-3">
                    <i className="codicon codicon-loading codicon-modifier-spin text-lg" />
                    <span>Scanning projects...</span>
                </div>
            </div>
        );
    }
    console.log("projectState", projectState);
    return (
        <div className="container mx-auto p-6 h-screen overflow-auto flex flex-col gap-6 max-w-4xl">
            {/* Project Overview Section */}
            {projectState.workspaceIsOpen && (
                <div className="space-y-4">
                    {projectState.isInitializing ? (
                        <Card>
                            <CardContent className="flex items-center justify-center p-8">
                                <div className="flex items-center gap-3">
                                    <i className="codicon codicon-loading codicon-modifier-spin text-lg" />
                                    <span>Initializing Project...</span>
                                </div>
                            </CardContent>
                        </Card>
                    ) : projectState.projectOverview ? (
                        <div className="space-y-4">
                            {/* Project Details */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <i className="codicon codicon-folder-opened" />
                                        {projectState.projectOverview.projectName ||
                                            "Unnamed Project"}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                                Source Language
                                            </label>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm">
                                                    {getLanguageDisplay(
                                                        projectState.projectOverview.sourceLanguage
                                                    )}
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() =>
                                                        handleProjectAction(
                                                            "changeSourceLanguage",
                                                            projectState.projectOverview
                                                                .sourceLanguage
                                                        )
                                                    }
                                                >
                                                    <i className="codicon codicon-edit h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                                Target Language
                                            </label>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm">
                                                    {getLanguageDisplay(
                                                        projectState.projectOverview.targetLanguage
                                                    )}
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() =>
                                                        handleProjectAction(
                                                            "changeTargetLanguage",
                                                            projectState.projectOverview
                                                                .targetLanguage
                                                        )
                                                    }
                                                >
                                                    <i className="codicon codicon-edit h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                                Required Validations
                                            </label>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm">
                                                    {String(
                                                        projectState.projectOverview
                                                            .validationCount || 1
                                                    )}
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() =>
                                                        handleProjectAction("setValidationCount")
                                                    }
                                                >
                                                    <i className="codicon codicon-edit h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                                Project Documents
                                            </label>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm">
                                                    {projectState.projectOverview.sourceTexts
                                                        ?.length || 0}{" "}
                                                    texts
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() =>
                                                        handleProjectAction("openSourceUpload")
                                                    }
                                                >
                                                    <i className="codicon codicon-add h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    <Separator />

                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <label className="text-sm font-medium">
                                                Spellcheck
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                {projectState.projectOverview.spellcheckIsEnabled
                                                    ? "Spellcheck is enabled"
                                                    : "Spellcheck is disabled"}
                                            </p>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleProjectAction("toggleSpellcheck")}
                                        >
                                            <i
                                                className={`codicon codicon-${
                                                    projectState.projectOverview.spellcheckIsEnabled
                                                        ? "check"
                                                        : "x"
                                                } mr-2 h-4 w-4`}
                                            />
                                            {projectState.projectOverview.spellcheckIsEnabled
                                                ? "Enabled"
                                                : "Disabled"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Sync Settings - only show if project has remote */}
                            {projectState.repoHasRemote && (
                                <SyncSettings
                                    autoSyncEnabled={state.autoSyncEnabled}
                                    syncDelayMinutes={state.syncDelayMinutes}
                                    onToggleAutoSync={handleToggleAutoSync}
                                    onChangeSyncDelay={handleChangeSyncDelay}
                                    onTriggerSync={handleTriggerSync}
                                />
                            )}

                            {/* Publish Card - only show if project doesn't have remote */}
                            {!projectState.repoHasRemote && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <i className="codicon codicon-cloud-upload" />
                                            Publish Project
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-3">
                                            <p className="text-sm text-muted-foreground">
                                                Publish your project to the cloud to enable syncing
                                                across devices and collaboration.
                                            </p>
                                            <Button
                                                onClick={() =>
                                                    handleProjectAction("publishProject")
                                                }
                                                className="w-full"
                                            >
                                                <i className="codicon codicon-cloud-upload mr-2 h-4 w-4" />
                                                Publish to Cloud
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Project Actions */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-sm">Project Tools</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleProjectAction("openEditAnalysis")}
                                            className="justify-start"
                                        >
                                            <i className="codicon codicon-graph mr-2 h-4 w-4" />
                                            AI Metrics
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => executeCommand("openCellLabelImporter")}
                                            className="justify-start"
                                        >
                                            <i className="codicon codicon-symbol-array mr-2 h-4 w-4" />
                                            Import Labels
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                handleProjectAction("openBookNameEditor")
                                            }
                                            className="justify-start"
                                        >
                                            <i className="codicon codicon-book mr-2 h-4 w-4" />
                                            Book Names
                                        </Button>

                                        {/* Manual sync button - only show if project has remote and auto-sync is disabled */}
                                        {/* {projectState.repoHasRemote && !state.autoSyncEnabled && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleProjectAction("syncProject")}
                                                className="justify-start"
                                            >
                                                <i className="codicon codicon-sync mr-2 h-4 w-4" />
                                                Sync Project
                                            </Button>
                                        )} */}
                                        {!projectState.repoHasRemote && (
                                            <Button
                                                onClick={() =>
                                                    handleProjectAction("publishProject")
                                                }
                                            >
                                                <i className="codicon codicon-cloud-upload mr-2 h-4 w-4" />
                                                Publish Project
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleProjectAction("openAISettings")}
                                            className="justify-start"
                                        >
                                            <i className="codicon codicon-settings mr-2 h-4 w-4" />
                                            Copilot Settings
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleProjectAction("openExportView")}
                                            className="justify-start"
                                        >
                                            <i className="codicon codicon-export mr-2 h-4 w-4" />
                                            Export Project
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => executeCommand("closeProject")}
                                            className="justify-start"
                                        >
                                            <i className="codicon codicon-close mr-2 h-4 w-4" />
                                            Close Project
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    ) : projectState.canInitializeProject ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center p-8 text-center space-y-4">
                                <i className="codicon codicon-folder-opened text-4xl text-muted-foreground" />
                                <div className="space-y-2">
                                    <h3 className="text-lg font-semibold">Initialize Project</h3>
                                    <p className="text-sm text-muted-foreground">
                                        This workspace doesn't have a project yet. Initialize it to
                                        get started.
                                    </p>
                                </div>
                                <Button onClick={() => handleProjectAction("initializeProject")}>
                                    <i className="codicon codicon-add mr-2 h-4 w-4" />
                                    Initialize Project
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <Alert>
                            <i className="codicon codicon-info h-4 w-4" />
                            <AlertDescription>
                                No project found in current workspace
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
            )}

            <div className="mt-auto pt-6 text-center border-t border-border">
                <Badge variant="secondary" className="text-xs opacity-70">
                    Codex Translation Editor v0.3.12
                </Badge>
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<MainMenu />);
