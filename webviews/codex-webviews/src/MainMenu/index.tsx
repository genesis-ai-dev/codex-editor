import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useNetworkState } from "@uidotdev/usehooks";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Alert, AlertDescription } from "../components/ui/alert";
import { SyncSettings } from "../components/SyncSettings";
import {
    TextDisplaySettingsModal,
    type TextDisplaySettings,
} from "../components/TextDisplaySettingsModal";
import { RenameModal } from "../components/RenameModal";
import "../tailwind.css";

const SHOULD_SHOW_RELEASE_NOTES_LINK = true;
const RELEASE_NOTES_URL = "https://docs.codexeditor.app/docs/releases/latest/";

// Declare the acquireVsCodeApi function and acquire the VS Code API
declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

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
    isSyncInProgress: boolean;
    syncStage: string;
    isPublishingInProgress: boolean;
    publishingStage: string;
    updateState:
        | "ready"
        | "downloaded"
        | "available for download"
        | "downloading"
        | "updating"
        | "checking for updates"
        | "idle"
        | "disabled"
        | null;
    updateVersion: string | null;
    isCheckingForUpdates: boolean;
    appVersion: string | null;
}

interface State {
    activeViewId: string | null;
    projectState: ProjectManagerState;
    autoSyncEnabled: boolean;
    syncDelayMinutes: number;
    isFrontierExtensionEnabled: boolean;
    isAuthenticated: boolean;
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
            updateState: null,
            updateVersion: null,
            isCheckingForUpdates: false,
            appVersion: null,
            isSyncInProgress: false,
            syncStage: "",
            isPublishingInProgress: false,
            publishingStage: "",
        },
        autoSyncEnabled: true,
        syncDelayMinutes: 5,
        isFrontierExtensionEnabled: true,
        isAuthenticated: false,
        progressData: null,
    });

    const network = useNetworkState();
    const isOnline = network?.online ?? true;

    const [isTextDisplaySettingsOpen, setIsTextDisplaySettingsOpen] = useState(false);
    const [isRenameProjectModalOpen, setIsRenameProjectModalOpen] = useState(false);
    const [projectNameValue, setProjectNameValue] = useState("");
    // Speech-to-text settings moved to Copilot Settings panel

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
                        isFrontierExtensionEnabled:
                            message.data.isFrontierExtensionEnabled ??
                            prevState.isFrontierExtensionEnabled,
                        isAuthenticated: message.data.isAuthenticated ?? prevState.isAuthenticated,
                    }));
                    break;
                case "progressData":
                    setState((prevState) => ({
                        ...prevState,
                        progressData: message.data,
                    }));
                    break;
                case "updateStateChanged":
                    setState((prevState) => ({
                        ...prevState,
                        projectState: {
                            ...prevState.projectState,
                            updateState: message.data.updateState,
                            updateVersion: message.data.updateVersion,
                            isCheckingForUpdates: message.data.isCheckingForUpdates,
                        },
                    }));
                    break;
                case "syncStatusUpdate":
                    setState((prevState) => ({
                        ...prevState,
                        projectState: {
                            ...prevState.projectState,
                            isSyncInProgress:
                                message.data.isSyncInProgress ??
                                prevState.projectState.isSyncInProgress,
                            syncStage: message.data.syncStage ?? prevState.projectState.syncStage,
                        },
                    }));
                    break;
                case "publishStatusUpdate":
                    setState((prevState) => ({
                        ...prevState,
                        projectState: {
                            ...prevState.projectState,
                            isPublishingInProgress:
                                message.data.isPublishingInProgress ??
                                prevState.projectState.isPublishingInProgress,
                            publishingStage:
                                message.data.publishingStage ??
                                prevState.projectState.publishingStage,
                        },
                    }));
                    break;
                // Speech-to-text settings moved to Copilot Settings panel
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
            // Speech-to-text settings moved to Copilot Settings panel
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

    const handleLogin = () => {
        handleProjectAction("openLoginFlow");
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

    // Speech-to-text settings controls moved to Copilot Settings panel

    const handleApplyTextDisplaySettings = (settings: TextDisplaySettings) => {
        try {
            vscode.postMessage({
                command: "applyTextDisplaySettings",
                data: settings,
            });
        } catch (error) {
            console.error("Could not apply text display settings:", error);
        }
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

    // Log only when key properties change (not on every render)
    useEffect(() => {
        const keyProps = {
            isScanning: projectState.isScanning,
            isSyncInProgress: projectState.isSyncInProgress,
            syncStage: projectState.syncStage,
            isInitializing: projectState.isInitializing,
            updateState: projectState.updateState,
        };
        console.log("[ProjectState] Key changes:", keyProps);
    }, [
        projectState.isScanning,
        projectState.isSyncInProgress,
        projectState.syncStage,
        projectState.isInitializing,
        projectState.updateState,
    ]);

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

    const getUpdateMessage = () => {
        switch (projectState.updateState) {
            case "ready":
                return {
                    title: "Update ready to install",
                    primaryAction: "Restart Now",
                    primaryCommand: "installUpdate",
                    icon: "codicon-debug-restart",
                    variant: "default" as const,
                    isPrimary: true,
                };
            case "downloaded":
                return {
                    title: "Update downloaded",
                    primaryAction: "Install Now",
                    primaryCommand: "installUpdate",
                    icon: "codicon-package",
                    variant: "default" as const,
                    isPrimary: true,
                };
            case "available for download":
                return {
                    title: "Update available",
                    primaryAction: "Download Now",
                    primaryCommand: "downloadUpdate",
                    icon: "codicon-arrow-circle-down",
                    variant: "outline" as const,
                    isPrimary: false,
                };
            default:
                return null;
        }
    };

    const updateInfo = getUpdateMessage();
    const showUpdateNotification =
        updateInfo && !["idle", "disabled", null].includes(projectState.updateState);

    return (
        <div className="container mx-auto p-6 h-screen overflow-auto flex flex-col gap-6 max-w-4xl">
            {/* Update Notification */}
            {showUpdateNotification && (
                <Card
                    className="card border-2 shadow-lg hover:shadow-xl transition-all duration-200"
                    style={{
                        borderColor: "var(--ring)",
                        backgroundColor: "var(--card)",
                    }}
                >
                    <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0">
                                <i
                                    className={`${updateInfo.icon} text-xl`}
                                    style={{ color: "var(--ring)" }}
                                />
                            </div>
                            <div className="flex-1 space-y-1">
                                <div className="flex flex-row flex-wrap items-center justify-between gap-2">
                                    <h3
                                        className="font-semibold text-sm"
                                        style={{ color: "var(--foreground)" }}
                                    >
                                        {updateInfo.title}
                                    </h3>
                                    <div className="flex items-center gap-2 ml-4">
                                        {SHOULD_SHOW_RELEASE_NOTES_LINK && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => {
                                                    // Open external URL in default browser
                                                    vscode.postMessage({
                                                        command: "openExternal",
                                                        url: RELEASE_NOTES_URL,
                                                    });
                                                }}
                                                disabled={projectState.isCheckingForUpdates}
                                                className="text-xs px-2 py-1 h-7"
                                            >
                                                Release Notes
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant={updateInfo.variant}
                                            onClick={() =>
                                                handleProjectAction(updateInfo.primaryCommand)
                                            }
                                            disabled={
                                                projectState.isCheckingForUpdates ||
                                                projectState.updateState === "downloading" ||
                                                projectState.updateState === "updating"
                                            }
                                            className={`text-xs px-3 py-1 h-7 ${
                                                updateInfo?.isPrimary
                                                    ? "button-primary"
                                                    : "button-outline"
                                            }`}
                                        >
                                            {projectState.isCheckingForUpdates ? (
                                                <>
                                                    <i className="codicon codicon-loading codicon-modifier-spin mr-1 text-xs" />
                                                    Checking...
                                                </>
                                            ) : projectState.updateState === "downloading" ? (
                                                <>
                                                    <i className="codicon codicon-loading codicon-modifier-spin mr-1 text-xs" />
                                                    Downloading...
                                                </>
                                            ) : projectState.updateState === "updating" ? (
                                                <>
                                                    <i className="codicon codicon-loading codicon-modifier-spin mr-1 text-xs" />
                                                    Installing...
                                                </>
                                            ) : (
                                                <>
                                                    <i
                                                        className={`${updateInfo.icon} mr-1 text-xs`}
                                                    />
                                                    {updateInfo.primaryAction}
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                {projectState.updateVersion && (
                                    <p
                                        className="text-xs"
                                        style={{ color: "var(--muted-foreground)" }}
                                    >
                                        Version {projectState.updateVersion}
                                    </p>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Project Overview Section */}
            {projectState.workspaceIsOpen && (
                <div className="space-y-4">
                    {projectState.isInitializing ? (
                        <Card
                            className="card border-2 shadow-lg hover:shadow-xl transition-all duration-200"
                            style={{
                                borderColor: "var(--ring)",
                                backgroundColor: "var(--card)",
                            }}
                        >
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
                            <Card
                                className="card border-2 shadow-lg hover:shadow-xl transition-all duration-200"
                                style={{
                                    borderColor: "var(--ring)",
                                    backgroundColor: "var(--card)",
                                }}
                            >
                                <CardHeader className="pb-4 rounded-t-lg">
                                    <CardTitle
                                        className="text-lg font-semibold flex items-center justify-between gap-2"
                                        style={{ color: "var(--foreground)" }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <i
                                                className="codicon codicon-folder-opened text-xl"
                                                style={{ color: "var(--ring)" }}
                                            />
                                            {projectState.projectOverview.projectName ||
                                                "Unnamed Project"}
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                                const currentName =
                                                    projectState.projectOverview.projectName ||
                                                    "Unnamed Project";
                                                setProjectNameValue(currentName);
                                                setIsRenameProjectModalOpen(true);
                                            }}
                                            className="w-9"
                                        >
                                            <i className="codicon codicon-edit" />
                                        </Button>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4 pt-6">
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
                                                    className="w-9"
                                                >
                                                    <i className="codicon codicon-edit" />
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
                                                    className="w-9"
                                                >
                                                    <i className="codicon codicon-edit" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                                Required Validations
                                            </label>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm">
                                                    Text:{" "}
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
                                                    className="w-9"
                                                >
                                                    <i className="codicon codicon-edit" />
                                                </Button>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm">
                                                    Audio:{" "}
                                                    {String(
                                                        projectState.projectOverview
                                                            .validationCountAudio || 1
                                                    )}
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() =>
                                                        handleProjectAction(
                                                            "setValidationCountAudio"
                                                        )
                                                    }
                                                    className="w-9"
                                                >
                                                    <i className="codicon codicon-edit" />
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
                                                    className="w-9"
                                                >
                                                    <i className="codicon codicon-add" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* <Separator /> // TODO: Put this back in when we reinsert spell check*/}

                                    <div
                                        className="flex items-center justify-between p-3 rounded-lg border"
                                        style={{
                                            backgroundColor: "var(--muted)",
                                            borderColor: "var(--border)",
                                            display: "none", // TODO: we are removing spell check for now until someone needs it
                                        }}
                                    >
                                        <div className="space-y-1">
                                            <label
                                                className="text-sm font-semibold flex items-center gap-2"
                                                style={{ color: "var(--foreground)" }}
                                            >
                                                <i
                                                    className="codicon codicon-book"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                />
                                                Spellcheck
                                            </label>
                                            <p
                                                className="text-xs"
                                                style={{ color: "var(--muted-foreground)" }}
                                            >
                                                <i
                                                    className={`codicon codicon-${
                                                        projectState.projectOverview
                                                            .spellcheckIsEnabled
                                                            ? "check"
                                                            : "circle-slash"
                                                    } mr-1`}
                                                />
                                                {projectState.projectOverview.spellcheckIsEnabled
                                                    ? "Dictionary checking enabled"
                                                    : "Dictionary checking disabled"}
                                            </p>
                                        </div>
                                        <Button
                                            size="default"
                                            variant={
                                                projectState.projectOverview.spellcheckIsEnabled
                                                    ? "default"
                                                    : "outline"
                                            }
                                            onClick={() => handleProjectAction("toggleSpellcheck")}
                                            className={`px-4 py-2 font-semibold transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 ${
                                                projectState.projectOverview.spellcheckIsEnabled
                                                    ? "button-primary"
                                                    : "button-outline border-2"
                                            }`}
                                        >
                                            <i
                                                className={`codicon codicon-${
                                                    projectState.projectOverview.spellcheckIsEnabled
                                                        ? "check"
                                                        : "circle-slash"
                                                } mr-2 h-4 w-4`}
                                            />
                                            {projectState.projectOverview.spellcheckIsEnabled
                                                ? "ON"
                                                : "OFF"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Sync Settings - only show if project has remote */}
                            {projectState.repoHasRemote && (
                                <SyncSettings
                                    autoSyncEnabled={state.autoSyncEnabled}
                                    syncDelayMinutes={state.syncDelayMinutes}
                                    isSyncInProgress={projectState.isSyncInProgress}
                                    syncStage={projectState.syncStage}
                                    isFrontierExtensionEnabled={state.isFrontierExtensionEnabled}
                                    isAuthenticated={state.isAuthenticated}
                                    onToggleAutoSync={handleToggleAutoSync}
                                    onChangeSyncDelay={handleChangeSyncDelay}
                                    onTriggerSync={handleTriggerSync}
                                    onLogin={handleLogin}
                                />
                            )}

                            {/* Publish Card - only show if project doesn't have remote */}
                            {!projectState.repoHasRemote && (
                                <Card
                                    className="card border-2 shadow-lg hover:shadow-xl transition-all duration-200"
                                    style={{
                                        borderColor: "var(--ring)",
                                        backgroundColor: "var(--card)",
                                    }}
                                >
                                    <CardHeader className="pb-4 rounded-t-lg">
                                        <CardTitle
                                            className="flex items-center gap-3 text-lg font-bold"
                                            style={{ color: "var(--foreground)" }}
                                        >
                                            <i
                                                className="codicon codicon-cloud-upload text-2xl"
                                                style={{ color: "var(--ring)" }}
                                            />
                                            Publish Project
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="pt-6">
                                        <div className="space-y-4">
                                            <div
                                                className="flex items-start gap-3 p-3 rounded-lg border"
                                                style={{
                                                    backgroundColor: "var(--muted)",
                                                    borderColor: "var(--border)",
                                                }}
                                            >
                                                <i
                                                    className="codicon codicon-info text-lg mt-0.5"
                                                    style={{ color: "var(--ring)" }}
                                                />
                                                <p
                                                    className="text-sm leading-relaxed"
                                                    style={{ color: "var(--foreground)" }}
                                                >
                                                    Publish your project to the cloud to enable{" "}
                                                    <strong>syncing across devices</strong> and{" "}
                                                    <strong>team collaboration</strong>.
                                                </p>
                                            </div>
                                            <Button
                                                onClick={() => {
                                                    if (!state.isAuthenticated) {
                                                        handleProjectAction("openLoginFlow");
                                                    } else {
                                                        handleProjectAction("publishProject");
                                                }
                                                }}
                                                disabled={
                                                    projectState.isPublishingInProgress ||
                                                    !isOnline ||
                                                    !state.isFrontierExtensionEnabled
                                                }
                                                className="button-primary w-full h-12 font-bold text-base shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                                            >
                                                <i
                                                    className={`codicon ${
                                                        projectState.isPublishingInProgress
                                                            ? "codicon-loading codicon-modifier-spin"
                                                            : "codicon-cloud-upload"
                                                    } mr-3 h-5 w-5`}
                                                />
                                                {projectState.isPublishingInProgress
                                                    ? projectState.publishingStage ||
                                                      "Publishing..."
                                                    : !isOnline
                                                    ? "Offline"
                                                    : !state.isFrontierExtensionEnabled
                                                    ? "Extension Required"
                                                    : !state.isAuthenticated
                                                    ? "Log in to Publish"
                                                    : "Publish to Cloud"}
                                                {!projectState.isPublishingInProgress &&
                                                    isOnline &&
                                                    state.isFrontierExtensionEnabled &&
                                                    state.isAuthenticated && (
                                                    <i className="codicon codicon-arrow-right ml-3 h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Project Actions */}
                            <Card
                                className="card border-2 shadow-lg hover:shadow-xl transition-all duration-200"
                                style={{
                                    borderColor: "var(--ring)",
                                    backgroundColor: "var(--card)",
                                }}
                            >
                                <CardHeader className="pb-4 rounded-t-lg">
                                    <CardTitle
                                        className="text-lg font-semibold flex items-center gap-2"
                                        style={{ color: "var(--foreground)" }}
                                    >
                                        <i
                                            className="codicon codicon-tools text-xl"
                                            style={{ color: "var(--ring)" }}
                                        />
                                        Project Tools
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3 lg:gap-4">
                                        <Button
                                            variant="outline"
                                            size="default"
                                            onClick={() => handleProjectAction("openEditAnalysis")}
                                            className="button-outline justify-start h-12 lg:h-14 p-3 lg:p-4 border-2 transition-all duration-200 hover:shadow-md hover:scale-105 font-medium text-sm"
                                        >
                                            <i
                                                className="codicon codicon-graph mr-2 lg:mr-3 h-4 lg:h-5 w-4 lg:w-5 flex-shrink-0"
                                                style={{ color: "var(--ring)" }}
                                            />
                                            <div className="text-left min-w-0">
                                                <div className="font-semibold text-xs lg:text-sm truncate">
                                                    AI Metrics
                                                </div>
                                                <div
                                                    className="text-xs hidden sm:block"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                >
                                                    Analysis & insights
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="default"
                                            onClick={() => executeCommand("openCellLabelImporter")}
                                            className="button-outline justify-start h-12 lg:h-14 p-3 lg:p-4 border-2 transition-all duration-200 hover:shadow-md hover:scale-105 font-medium text-sm"
                                        >
                                            <i
                                                className="codicon codicon-symbol-array mr-2 lg:mr-3 h-4 lg:h-5 w-4 lg:w-5 flex-shrink-0"
                                                style={{ color: "var(--ring)" }}
                                            />
                                            <div className="text-left min-w-0">
                                                <div className="font-semibold text-xs lg:text-sm truncate">
                                                    Import Labels
                                                </div>
                                                <div
                                                    className="text-xs hidden sm:block"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                >
                                                    Cell label import
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="default"
                                            onClick={() =>
                                                handleProjectAction("openBookNameEditor")
                                            }
                                            className="button-outline justify-start h-12 lg:h-14 p-3 lg:p-4 border-2 transition-all duration-200 hover:shadow-md hover:scale-105 font-medium text-sm"
                                        >
                                            <i
                                                className="codicon codicon-book mr-2 lg:mr-3 h-4 lg:h-5 w-4 lg:w-5 flex-shrink-0"
                                                style={{ color: "var(--ring)" }}
                                            />
                                            <div className="text-left min-w-0">
                                                <div className="font-semibold text-xs lg:text-sm truncate">
                                                    Book Names
                                                </div>
                                                <div
                                                    className="text-xs hidden sm:block"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                >
                                                    Configure books
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="default"
                                            onClick={() => handleProjectAction("openAISettings")}
                                            className="button-outline justify-start h-12 lg:h-14 p-3 lg:p-4 border-2 transition-all duration-200 hover:shadow-md hover:scale-105 font-medium text-sm"
                                        >
                                            <i
                                                className="codicon codicon-settings mr-2 lg:mr-3 h-4 lg:h-5 w-4 lg:w-5 flex-shrink-0"
                                                style={{ color: "var(--ring)" }}
                                            />
                                            <div className="text-left min-w-0">
                                                <div className="font-semibold text-xs lg:text-sm truncate">
                                                    Copilot Settings
                                                </div>
                                                <div
                                                    className="text-xs hidden sm:block"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                >
                                                    AI configuration
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="default"
                                            onClick={() => handleProjectAction("openExportView")}
                                            className="button-outline justify-start h-12 lg:h-14 p-3 lg:p-4 border-2 transition-all duration-200 hover:shadow-md hover:scale-105 font-medium text-sm"
                                        >
                                            <i
                                                className="codicon codicon-export mr-2 lg:mr-3 h-4 lg:h-5 w-4 lg:w-5 flex-shrink-0"
                                                style={{ color: "var(--ring)" }}
                                            />
                                            <div className="text-left min-w-0">
                                                <div className="font-semibold text-xs lg:text-sm truncate">
                                                    Export Project
                                                </div>
                                                <div
                                                    className="text-xs hidden sm:block"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                >
                                                    Download files
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="default"
                                            onClick={() => handleProjectAction("checkForUpdates")}
                                            disabled={projectState.isCheckingForUpdates}
                                            className="button-outline justify-start h-12 lg:h-14 p-3 lg:p-4 border-2 transition-all duration-200 hover:shadow-md hover:scale-105 font-medium text-sm"
                                        >
                                            <i
                                                className={`codicon ${
                                                    projectState.isCheckingForUpdates
                                                        ? "codicon-loading codicon-modifier-spin"
                                                        : "codicon-extensions"
                                                } mr-2 lg:mr-3 h-4 lg:h-5 w-4 lg:w-5 flex-shrink-0`}
                                                style={{ color: "var(--ring)" }}
                                            />
                                            <div className="text-left min-w-0">
                                                <div className="font-semibold text-xs lg:text-sm truncate">
                                                    {projectState.isCheckingForUpdates
                                                        ? "Checking..."
                                                        : "Check for Updates"}
                                                </div>
                                                <div
                                                    className="text-xs hidden sm:block"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                >
                                                    Check for app updates
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="default"
                                            onClick={() => setIsTextDisplaySettingsOpen(true)}
                                            className="button-outline justify-start h-12 lg:h-14 p-3 lg:p-4 border-2 transition-all duration-200 hover:shadow-md hover:scale-105 font-medium text-sm"
                                        >
                                            <i
                                                className="codicon codicon-text-size mr-2 lg:mr-3 h-4 lg:h-5 w-4 lg:w-5 flex-shrink-0"
                                                style={{ color: "var(--ring)" }}
                                            />
                                            <div className="text-left min-w-0">
                                                <div className="font-semibold text-xs lg:text-sm truncate">
                                                    Text Display Settings
                                                </div>
                                                <div
                                                    className="text-xs hidden sm:block"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                >
                                                    Configure font, line numbers & direction
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            variant="outline"
                                            size="default"
                                            onClick={() => executeCommand("closeProject")}
                                            className="button-outline justify-start h-12 lg:h-14 p-3 lg:p-4 border-2 transition-all duration-200 hover:shadow-md hover:scale-105 font-medium text-sm"
                                        >
                                            <i
                                                className="codicon codicon-close mr-2 lg:mr-3 h-4 lg:h-5 w-4 lg:w-5 flex-shrink-0"
                                                style={{ color: "var(--destructive)" }}
                                            />
                                            <div className="text-left min-w-0">
                                                <div className="font-semibold text-xs lg:text-sm truncate">
                                                    Close Project
                                                </div>
                                                <div
                                                    className="text-xs hidden sm:block"
                                                    style={{ color: "var(--muted-foreground)" }}
                                                >
                                                    Exit workspace
                                                </div>
                                            </div>
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    ) : projectState.canInitializeProject ? (
                        <Card
                            className="card border-2 shadow-lg hover:shadow-xl transition-all duration-200"
                            style={{
                                borderColor: "var(--ring)",
                                backgroundColor: "var(--card)",
                            }}
                        >
                            <CardContent className="flex flex-col items-center justify-center p-8 text-center space-y-6">
                                <i
                                    className="codicon codicon-folder-opened text-5xl"
                                    style={{ color: "var(--ring)" }}
                                />
                                <div className="space-y-3">
                                    <h3
                                        className="text-xl font-bold"
                                        style={{ color: "var(--foreground)" }}
                                    >
                                        Initialize Project
                                    </h3>
                                    <div
                                        className="flex items-center gap-2 p-3 rounded-lg border"
                                        style={{
                                            backgroundColor: "var(--muted)",
                                            borderColor: "var(--border)",
                                        }}
                                    >
                                        <i
                                            className="codicon codicon-lightbulb"
                                            style={{ color: "var(--ring)" }}
                                        />
                                        <p
                                            className="text-sm"
                                            style={{ color: "var(--foreground)" }}
                                        >
                                            This workspace doesn't have a project yet. Projects are initialized
                                            automatically when created. Use the Startup Flow to create a new project.
                                        </p>
                                    </div>
                                </div>
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

            {/* Speech to Text settings moved to Copilot Settings */}

            <div className="flex flex-col items-center pt-6 text-center text-xs opacity-70">
                Codex Translation Editor
                <br />
                Patch Version: {projectState.appVersion ? `${projectState.appVersion}` : "unknown"}
            </div>

            {/* Text Display Settings Modal */}
            <TextDisplaySettingsModal
                isOpen={isTextDisplaySettingsOpen}
                onClose={() => setIsTextDisplaySettingsOpen(false)}
                onApply={handleApplyTextDisplaySettings}
            />

            {/* Rename Project Modal */}
            <RenameModal
                open={isRenameProjectModalOpen}
                title="Rename Project"
                description="Enter a new name for your project"
                originalLabel={projectState.projectOverview?.projectName || "Unnamed Project"}
                value={projectNameValue}
                placeholder="Enter project name"
                confirmButtonLabel="Save"
                disabled={!projectNameValue.trim()}
                onClose={() => {
                    setIsRenameProjectModalOpen(false);
                    setProjectNameValue("");
                }}
                onConfirm={() => {
                    if (projectNameValue.trim()) {
                        try {
                            vscode.postMessage({
                                command: "changeProjectName",
                                projectName: projectNameValue.trim(),
                            });
                        } catch (error) {
                            console.error("Could not send changeProjectName message:", error);
                        }
                        setIsRenameProjectModalOpen(false);
                        setProjectNameValue("");
                    }
                }}
                onValueChange={setProjectNameValue}
            />
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<MainMenu />);
