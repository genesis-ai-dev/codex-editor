import { useState, useEffect, useRef, useCallback } from "react";
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
import "../tailwind.css";

// Inline editable field component
interface EditableFieldProps {
    value: string;
    onSave: (value: string) => void;
    placeholder?: string;
    className?: string;
    inputClassName?: string;
}

function EditableField({ value, onSave, placeholder = "Click to edit", className = "", inputClassName = "" }: EditableFieldProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setEditValue(value);
    }, [value]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleSave = useCallback(() => {
        if (editValue.trim() && editValue !== value) {
            onSave(editValue.trim());
        } else {
            setEditValue(value);
        }
        setIsEditing(false);
    }, [editValue, value, onSave]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleSave();
        } else if (e.key === "Escape") {
            setEditValue(value);
            setIsEditing(false);
        }
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className={`bg-transparent border-b border-primary outline-none text-sm py-0.5 w-full min-w-0 ${inputClassName}`}
            />
        );
    }

    return (
        <span
            onClick={() => setIsEditing(true)}
            className={`block truncate min-w-0 cursor-pointer hover:bg-accent px-1 -mx-1 py-0.5 rounded transition-colors ${className}`}
            title="Click to edit"
        >
            {value || <span className="text-muted-foreground italic">{placeholder}</span>}
        </span>
    );
}

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
    });

    const network = useNetworkState();
    const isOnline = network?.online ?? true;

    const [isTextDisplaySettingsOpen, setIsTextDisplaySettingsOpen] = useState(false);

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
                            <Card className="border shadow-sm">
                                <CardHeader className="pb-2 overflow-hidden">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <i
                                            className="codicon codicon-folder-opened text-xl"
                                            style={{ color: "var(--ring)" }}
                                        />
                                        <EditableField
                                            value={projectState.projectOverview.projectName || "Unnamed Project"}
                                            onSave={(name) => {
                                                vscode.postMessage({
                                                    command: "changeProjectName",
                                                    projectName: name,
                                                });
                                            }}
                                            placeholder="Enter project name"
                                            className="text-lg font-semibold"
                                            inputClassName="text-lg font-semibold"
                                        />
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-4">
                                    <div className="space-y-3">
                                        {/* Languages row */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div
                                                className="p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors"
                                                onClick={() => handleProjectAction("changeSourceLanguage", projectState.projectOverview.sourceLanguage)}
                                                title="Click to change source language"
                                            >
                                                <div className="text-xs text-muted-foreground mb-1">Source</div>
                                                <div className="text-sm font-medium">
                                                    {getLanguageDisplay(projectState.projectOverview.sourceLanguage)}
                                                </div>
                                            </div>
                                            <div
                                                className="p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors"
                                                onClick={() => handleProjectAction("changeTargetLanguage", projectState.projectOverview.targetLanguage)}
                                                title="Click to change target language"
                                            >
                                                <div className="text-xs text-muted-foreground mb-1">Target</div>
                                                <div className="text-sm font-medium">
                                                    {getLanguageDisplay(projectState.projectOverview.targetLanguage)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Validations and Documents row */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-3 rounded-lg bg-muted/30">
                                                <div className="text-xs text-muted-foreground mb-2">Required Validations</div>
                                                <div className="flex flex-col gap-1.5 text-sm">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-muted-foreground">Text:</span>
                                                        <div className="flex items-center gap-0.5">
                                                            <button
                                                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-xs font-bold cursor-pointer"
                                                                onClick={() => {
                                                                    const current = projectState.projectOverview.validationCount || 1;
                                                                    if (current > 1) handleProjectAction("setValidationCountDirect", { count: current - 1 });
                                                                }}
                                                                title="Decrease"
                                                            >-</button>
                                                            <span className="w-5 text-center font-semibold">{projectState.projectOverview.validationCount || 1}</span>
                                                            <button
                                                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-xs font-bold cursor-pointer"
                                                                onClick={() => {
                                                                    const current = projectState.projectOverview.validationCount || 1;
                                                                    if (current < 15) handleProjectAction("setValidationCountDirect", { count: current + 1 });
                                                                }}
                                                                title="Increase"
                                                            >+</button>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-muted-foreground">Audio:</span>
                                                        <div className="flex items-center gap-0.5">
                                                            <button
                                                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-xs font-bold cursor-pointer"
                                                                onClick={() => {
                                                                    const current = projectState.projectOverview.validationCountAudio || 1;
                                                                    if (current > 1) handleProjectAction("setValidationCountAudioDirect", { count: current - 1 });
                                                                }}
                                                                title="Decrease"
                                                            >-</button>
                                                            <span className="w-5 text-center font-semibold">{projectState.projectOverview.validationCountAudio || 1}</span>
                                                            <button
                                                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-xs font-bold cursor-pointer"
                                                                onClick={() => {
                                                                    const current = projectState.projectOverview.validationCountAudio || 1;
                                                                    if (current < 15) handleProjectAction("setValidationCountAudioDirect", { count: current + 1 });
                                                                }}
                                                                title="Increase"
                                                            >+</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div
                                                className="p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-accent transition-colors"
                                                onClick={() => handleProjectAction("openSourceUpload")}
                                                title="Click to add documents"
                                            >
                                                <div className="text-xs text-muted-foreground mb-1">Documents</div>
                                                <div className="text-sm font-medium flex items-center gap-2">
                                                    {projectState.projectOverview.sourceTexts?.length || 0} texts
                                                    <i className="codicon codicon-add text-xs text-muted-foreground" />
                                                </div>
                                            </div>
                                        </div>
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

                            {/* Tools Section - Clean 2-column grid */}
                            <Card className="border shadow-sm">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                                        <i className="codicon codicon-tools" style={{ color: "var(--ring)" }} />
                                        Tools
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            { icon: "codicon-graph", label: "AI Metrics", action: () => handleProjectAction("openEditAnalysis") },
                                            { icon: "codicon-settings", label: "Copilot Settings", action: () => handleProjectAction("openAISettings") },
                                            { icon: "codicon-export", label: "Export", action: () => handleProjectAction("openExportView") },
                                            { icon: "codicon-text-size", label: "Text Display", action: () => setIsTextDisplaySettingsOpen(true) },
                                            { icon: "codicon-symbol-array", label: "Import Labels", action: () => executeCommand("openCellLabelImporter") },
                                            { icon: "codicon-replace-all", label: "Migration", action: () => executeCommand("openCodexMigrationTool") },
                                            { icon: "codicon-extensions", label: projectState.isCheckingForUpdates ? "Checking..." : "Updates", action: () => handleProjectAction("checkForUpdates"), disabled: projectState.isCheckingForUpdates, spinning: projectState.isCheckingForUpdates },
                                            { icon: "codicon-close", label: "Close Project", action: () => executeCommand("closeProject"), destructive: true },
                                        ].map((item, idx) => (
                                            <button
                                                key={idx}
                                                onClick={item.action}
                                                disabled={item.disabled}
                                                className={`flex items-center gap-2 p-3 rounded-lg text-left transition-colors text-sm ${
                                                    item.destructive
                                                        ? "hover:bg-destructive/10 hover:text-destructive"
                                                        : "hover:bg-accent"
                                                } ${item.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                                            >
                                                <i
                                                    className={`codicon ${item.spinning ? "codicon-loading codicon-modifier-spin" : item.icon}`}
                                                    style={{ color: item.destructive ? "var(--destructive)" : "var(--ring)" }}
                                                />
                                                <span className={item.destructive ? "" : ""}>{item.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Publish Card - at the bottom, only show if project doesn't have remote */}
                            {!projectState.repoHasRemote && (
                                <Card className="border shadow-sm bg-muted/20">
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-4">
                                            <div className="flex-shrink-0">
                                                <i
                                                    className="codicon codicon-cloud-upload text-2xl"
                                                    style={{ color: "var(--ring)" }}
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-sm">Publish to Cloud</div>
                                                <div className="text-xs text-muted-foreground">
                                                    Enable syncing and collaboration
                                                </div>
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
                                                size="sm"
                                                className="flex-shrink-0"
                                            >
                                                {projectState.isPublishingInProgress ? (
                                                    <>
                                                        <i className="codicon codicon-loading codicon-modifier-spin mr-2" />
                                                        {projectState.publishingStage || "Publishing..."}
                                                    </>
                                                ) : !isOnline ? (
                                                    "Offline"
                                                ) : !state.isFrontierExtensionEnabled ? (
                                                    "Extension Required"
                                                ) : !state.isAuthenticated ? (
                                                    "Log in"
                                                ) : (
                                                    "Publish"
                                                )}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
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
                                            This workspace doesn't have a project yet. Initialize it
                                            to get started with translation.
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    onClick={async () => {
                                        if (!projectState.isInitializing) {
                                            handleProjectAction("initializeProject");
                                        }
                                    }}
                                    disabled={projectState.isInitializing}
                                    className="button-primary h-12 px-8 font-bold text-base shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                                >
                                    <i className="codicon codicon-add mr-3 h-5 w-5" />
                                    {projectState.isInitializing
                                        ? "Initializing Project..."
                                        : "Initialize Project"}
                                    {!projectState.isInitializing && (
                                        <i className="codicon codicon-arrow-right ml-3 h-4 w-4" />
                                    )}
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

            {/* Footer */}
            <div className="text-center text-xs text-muted-foreground py-4">
                Codex Editor {projectState.appVersion ? `v${projectState.appVersion}` : ""}
            </div>

            {/* Text Display Settings Modal */}
            <TextDisplaySettingsModal
                isOpen={isTextDisplaySettingsOpen}
                onClose={() => setIsTextDisplaySettingsOpen(false)}
                onApply={handleApplyTextDisplaySettings}
            />
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<MainMenu />);
