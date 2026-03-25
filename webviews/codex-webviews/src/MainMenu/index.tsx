import { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useNetworkState } from "@uidotdev/usehooks";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Tooltip, TooltipTrigger, TooltipContent } from "../components/ui/tooltip";
import { SyncSettings } from "../components/SyncSettings";
import {
    TextDisplaySettingsModal,
    type TextDisplaySettings,
} from "../components/TextDisplaySettingsModal";
import { getVSCodeAPI } from "../shared/vscodeApi";

const vscode = getVSCodeAPI();
import "../tailwind.css";

// Inline editable field component
interface EditableFieldProps {
    value: string;
    onSave: (value: string) => void;
    placeholder?: string;
    className?: string;
    inputClassName?: string;
}

function EditableField({
    value,
    onSave,
    placeholder = "Click to edit",
    className = "",
    inputClassName = "",
}: EditableFieldProps) {
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
        const showPrivacyWarning = editValue.trim() !== "" && !/^\d+$/.test(editValue.trim());
        const showEmptyError = editValue.trim() === "";
        return (
            <div className="flex flex-col gap-2 w-full min-w-0">
                <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    className={`bg-transparent border border-primary outline-none text-sm px-3 py-1 w-full min-w-0 rounded-md ${inputClassName}`}
                />
                {showPrivacyWarning && (
                    <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800 font-normal">
                        Your project name may appear in publicly available bug reports. Please do
                        not name your project anything that could pose a security or IP risk to your
                        team.
                    </div>
                )}
                {showEmptyError && (
                    <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 font-normal">
                        Project name cannot be empty
                    </div>
                )}
            </div>
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

const TOOL_DOT_STYLES: Record<string, { icon: string; color: string }> = {
    ok: { icon: "codicon-pass-filled", color: "#22c55e" },
    missing: { icon: "codicon-error", color: "#ef4444" },
    fallback: { icon: "codicon-warning", color: "#f59e0b" },
};

type ToolDotStatus = "ok" | "missing" | "fallback";

const ToolDot: React.FC<{ status: ToolDotStatus }> = ({ status }) => {
    const { icon, color } = TOOL_DOT_STYLES[status];
    return (
        <i
            className={`codicon ${icon}`}
            style={{ color, fontSize: "14px" }}
        />
    );
};

interface ToolsStatusData {
    sqlite: boolean;
    nativeSqliteAvailable: boolean;
    git: boolean;
    nativeGitAvailable: boolean;
    ffmpeg: boolean;
    audioToolMode: "auto" | "builtin";
    gitToolMode: "auto" | "builtin";
    sqliteToolMode: "auto" | "builtin";
}

const getToolStatuses = (ts: ToolsStatusData) => {
    const sqlite: ToolDotStatus = !ts.nativeSqliteAvailable ? "missing"
        : ts.sqliteToolMode === "builtin" ? "fallback" : "ok";
    const git: ToolDotStatus = !ts.nativeGitAvailable ? "missing"
        : ts.gitToolMode === "builtin" ? "fallback" : "ok";
    const audio: ToolDotStatus = !ts.ffmpeg ? "missing"
        : ts.audioToolMode === "builtin" ? "fallback" : "ok";
    return { sqlite, git, audio };
};

const getGlobalStatus = (statuses: { sqlite: ToolDotStatus; git: ToolDotStatus; audio: ToolDotStatus }): ToolDotStatus => {
    const vals = [statuses.sqlite, statuses.git, statuses.audio];
    if (vals.includes("missing")) return "missing";
    if (vals.includes("fallback")) return "fallback";
    return "ok";
};

type TooltipDisplayStatus = "ok" | "fallback";

const TOOLTIP_STYLES: Record<TooltipDisplayStatus, { icon: string; color: string; label: string }> = {
    ok: { icon: "codicon-pass-filled", color: "#22c55e", label: "Native" },
    fallback: { icon: "codicon-warning", color: "#f59e0b", label: "Fallback" },
};

const StatusTooltip: React.FC<{ toolsStatus: ToolsStatusData }> = ({ toolsStatus }) => {
    const statuses = getToolStatuses(toolsStatus);
    const global = getGlobalStatus(statuses);

    const toDisplay = (s: ToolDotStatus): TooltipDisplayStatus => s === "ok" ? "ok" : "fallback";

    const tools = [
        { label: "AI & Search", status: toDisplay(statuses.sqlite) },
        { label: "Sync", status: toDisplay(statuses.git) },
        { label: "Audio", status: toDisplay(statuses.audio) },
    ];

    return (
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="flex items-center cursor-default">
                        <ToolDot status={global === "missing" ? "fallback" : global} />
                    </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" sideOffset={4} className="p-0 bg-popover text-popover-foreground border border-border shadow-md rounded-lg z-50">
                    <div className="flex flex-col gap-1 py-2 px-3">
                        {tools.map(({ label, status }) => (
                            <div key={label} className="flex items-center justify-between gap-4 text-xs">
                                <span className="text-muted-foreground">{label}</span>
                                <span className="flex items-center gap-1.5 font-medium" style={{ color: TOOLTIP_STYLES[status].color }}>
                                    <i className={`codicon ${TOOLTIP_STYLES[status].icon}`} style={{ fontSize: "12px" }} />
                                    {TOOLTIP_STYLES[status].label}
                                </span>
                            </div>
                        ))}
                    </div>
                </TooltipContent>
            </Tooltip>
        </span>
    );
};

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
    isImportInProgress: boolean;
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
    isGitAvailable: boolean;
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
            isImportInProgress: false,
            isPublishingInProgress: false,
            publishingStage: "",
        },
        autoSyncEnabled: true,
        syncDelayMinutes: 5,
        isFrontierExtensionEnabled: true,
        isAuthenticated: false,
        isGitAvailable: true,
    });

    const network = useNetworkState();
    const isOnline = network?.online ?? true;

    const [isTextDisplaySettingsOpen, setIsTextDisplaySettingsOpen] = useState(false);

    const [toolsStatus, setToolsStatus] = useState<{
        sqlite: boolean;
        nativeSqliteAvailable: boolean;
        git: boolean;
        nativeGitAvailable: boolean;
        ffmpeg: boolean;
        audioToolMode: "auto" | "builtin";
        gitToolMode: "auto" | "builtin";
        sqliteToolMode: "auto" | "builtin";
    } | null>(null);

    // Optimistic local state for validation counters so rapid clicks work correctly.
    // Without this, each click reads from the stale server-confirmed state (which
    // hasn't round-tripped yet), causing lost increments and UI bouncing.
    const [localValidationCount, setLocalValidationCount] = useState<number | null>(null);
    const [localValidationCountAudio, setLocalValidationCountAudio] = useState<number | null>(
        null
    );
    const validationCountDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const validationCountAudioDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const localCountFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const localCountAudioFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const displayValidationCount =
        localValidationCount ??
        state.projectState.projectOverview?.validationCount ??
        1;
    const displayValidationCountAudio =
        localValidationCountAudio ??
        state.projectState.projectOverview?.validationCountAudio ??
        1;

    // Clear optimistic override once the server has caught up to the local value
    useEffect(() => {
        const serverCount = state.projectState.projectOverview?.validationCount;
        if (localValidationCount !== null && serverCount === localValidationCount) {
            setLocalValidationCount(null);
        }
    }, [state.projectState.projectOverview?.validationCount, localValidationCount]);

    useEffect(() => {
        const serverCount = state.projectState.projectOverview?.validationCountAudio;
        if (localValidationCountAudio !== null && serverCount === localValidationCountAudio) {
            setLocalValidationCountAudio(null);
        }
    }, [state.projectState.projectOverview?.validationCountAudio, localValidationCountAudio]);

    // Clean up debounce timers on unmount
    useEffect(() => {
        return () => {
            if (validationCountDebounceRef.current) clearTimeout(validationCountDebounceRef.current);
            if (validationCountAudioDebounceRef.current)
                clearTimeout(validationCountAudioDebounceRef.current);
            if (localCountFallbackRef.current) clearTimeout(localCountFallbackRef.current);
            if (localCountAudioFallbackRef.current)
                clearTimeout(localCountAudioFallbackRef.current);
        };
    }, []);

    const handleValidationCountChange = useCallback(
        (newCount: number) => {
            setLocalValidationCount(newCount);

            if (validationCountDebounceRef.current)
                clearTimeout(validationCountDebounceRef.current);
            if (localCountFallbackRef.current) clearTimeout(localCountFallbackRef.current);

            validationCountDebounceRef.current = setTimeout(() => {
                try {
                    vscode.postMessage({
                        command: "setValidationCountDirect",
                        data: { count: newCount },
                    });
                } catch (error) {
                    console.error("Could not send validation count:", error);
                }
            }, 150);

            // Safety net: clear optimistic state after 5s in case server never confirms
            localCountFallbackRef.current = setTimeout(() => {
                setLocalValidationCount(null);
            }, 5000);
        },
        []
    );

    const handleValidationCountAudioChange = useCallback(
        (newCount: number) => {
            setLocalValidationCountAudio(newCount);

            if (validationCountAudioDebounceRef.current)
                clearTimeout(validationCountAudioDebounceRef.current);
            if (localCountAudioFallbackRef.current)
                clearTimeout(localCountAudioFallbackRef.current);

            validationCountAudioDebounceRef.current = setTimeout(() => {
                try {
                    vscode.postMessage({
                        command: "setValidationCountAudioDirect",
                        data: { count: newCount },
                    });
                } catch (error) {
                    console.error("Could not send audio validation count:", error);
                }
            }, 150);

            localCountAudioFallbackRef.current = setTimeout(() => {
                setLocalValidationCountAudio(null);
            }, 5000);
        },
        []
    );

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
                        isGitAvailable: message.data.isGitAvailable ?? prevState.isGitAvailable,
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
                            isImportInProgress:
                                message.data.isImportInProgress ??
                                prevState.projectState.isImportInProgress,
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
                case "toolsStatusSummary":
                    setToolsStatus(message.data);
                    break;
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

    const handleDownloadSyncRuntime = () => {
        handleProjectAction("downloadSyncRuntime");
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
                                            value={
                                                projectState.projectOverview.projectName ||
                                                "Unnamed Project"
                                            }
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
                                        <div className="grid grid-cols-1 min-[311px]:grid-cols-2 gap-4">
                                            <div
                                                className="p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors"
                                                onClick={() =>
                                                    handleProjectAction(
                                                        "changeSourceLanguage",
                                                        projectState.projectOverview.sourceLanguage
                                                    )
                                                }
                                                title="Click to change source language"
                                            >
                                                <div className="text-xs text-muted-foreground mb-1">
                                                    Source
                                                </div>
                                                <div className="text-sm font-medium">
                                                    {getLanguageDisplay(
                                                        projectState.projectOverview.sourceLanguage
                                                    )}
                                                </div>
                                            </div>
                                            <div
                                                className="p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors"
                                                onClick={() =>
                                                    handleProjectAction(
                                                        "changeTargetLanguage",
                                                        projectState.projectOverview.targetLanguage
                                                    )
                                                }
                                                title="Click to change target language"
                                            >
                                                <div className="text-xs text-muted-foreground mb-1">
                                                    Target
                                                </div>
                                                <div className="min-w-0 break-words text-sm font-medium">
                                                    {getLanguageDisplay(
                                                        projectState.projectOverview.targetLanguage
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Validations and Documents row */}
                                        <div className="grid grid-cols-1 min-[311px]:grid-cols-2 gap-4">
                                            <div className="p-3 rounded-lg bg-muted/30">
                                                <div className="text-xs text-muted-foreground mb-2">
                                                    Required Validations
                                                </div>
                                                <div className="flex flex-col gap-1.5 text-sm">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-muted-foreground">
                                                            Text:
                                                        </span>
                                                        <div className="flex items-center gap-0.5">
                                                            <button
                                                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-xs font-bold cursor-pointer"
                                                                onClick={() => {
                                                                    if (displayValidationCount > 1)
                                                                        handleValidationCountChange(
                                                                            displayValidationCount - 1
                                                                        );
                                                                }}
                                                                title="Decrease"
                                                            >
                                                                -
                                                            </button>
                                                            <span className="w-5 text-center font-semibold">
                                                                {displayValidationCount}
                                                            </span>
                                                            <button
                                                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-xs font-bold cursor-pointer"
                                                                onClick={() => {
                                                                    if (displayValidationCount < 15)
                                                                        handleValidationCountChange(
                                                                            displayValidationCount + 1
                                                                        );
                                                                }}
                                                                title="Increase"
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-muted-foreground">
                                                            Audio:
                                                        </span>
                                                        <div className="flex items-center gap-0.5">
                                                            <button
                                                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-xs font-bold cursor-pointer"
                                                                onClick={() => {
                                                                    if (
                                                                        displayValidationCountAudio >
                                                                        1
                                                                    )
                                                                        handleValidationCountAudioChange(
                                                                            displayValidationCountAudio -
                                                                                1
                                                                        );
                                                                }}
                                                                title="Decrease"
                                                            >
                                                                -
                                                            </button>
                                                            <span className="w-5 text-center font-semibold">
                                                                {displayValidationCountAudio}
                                                            </span>
                                                            <button
                                                                className="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-xs font-bold cursor-pointer"
                                                                onClick={() => {
                                                                    if (
                                                                        displayValidationCountAudio <
                                                                        15
                                                                    )
                                                                        handleValidationCountAudioChange(
                                                                            displayValidationCountAudio +
                                                                                1
                                                                        );
                                                                }}
                                                                title="Increase"
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div
                                                className="p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-accent transition-colors"
                                                onClick={() =>
                                                    handleProjectAction("openSourceUpload")
                                                }
                                                title="Click to add documents"
                                            >
                                                <div className="text-xs text-muted-foreground mb-1">
                                                    Documents
                                                </div>
                                                <div className="text-sm font-medium flex items-center gap-2">
                                                    {projectState.projectOverview.sourceTexts
                                                        ?.length || 0}{" "}
                                                    texts
                                                    <i className="codicon codicon-add text-[12px] text-muted-foreground" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Publish Card - only show if project doesn't have remote */}
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
                                                <div className="font-semibold text-sm">
                                                    Publish to Cloud
                                                </div>
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
                                                    !state.isGitAvailable ||
                                                    projectState.isPublishingInProgress ||
                                                    projectState.isImportInProgress ||
                                                    !isOnline ||
                                                    !state.isFrontierExtensionEnabled
                                                }
                                                title={!state.isGitAvailable ? "Sync unavailable — missing sync tools" : undefined}
                                                size="sm"
                                                className="flex-shrink-0"
                                            >
                                                {!state.isGitAvailable ? (
                                                    "Sync Unavailable"
                                                ) : projectState.isPublishingInProgress ? (
                                                    <>
                                                        <i className="codicon codicon-loading codicon-modifier-spin mr-2" />
                                                        {projectState.publishingStage ||
                                                            "Publishing..."}
                                                    </>
                                                ) : projectState.isImportInProgress ? (
                                                    <>
                                                        <i className="codicon codicon-loading codicon-modifier-spin mr-2" />
                                                        Importing...
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

                            {/* Sync Settings - only show if project has remote */}
                            {projectState.repoHasRemote && (
                                <SyncSettings
                                    autoSyncEnabled={state.autoSyncEnabled}
                                    syncDelayMinutes={state.syncDelayMinutes}
                                    isSyncInProgress={projectState.isSyncInProgress}
                                    syncStage={projectState.syncStage}
                                    isImportInProgress={projectState.isImportInProgress ?? false}
                                    isFrontierExtensionEnabled={state.isFrontierExtensionEnabled}
                                    isAuthenticated={state.isAuthenticated}
                                    isGitAvailable={state.isGitAvailable}
                                    onToggleAutoSync={handleToggleAutoSync}
                                    onChangeSyncDelay={handleChangeSyncDelay}
                                    onTriggerSync={handleTriggerSync}
                                    onLogin={handleLogin}
                                    onDownloadSyncRuntime={handleDownloadSyncRuntime}
                                />
                            )}

                            {/* Tools Section - Clean 2-column grid */}
                            <Card className="border shadow-sm">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                                        <i
                                            className="codicon codicon-tools"
                                            style={{ color: "var(--ring)" }}
                                        />
                                        Tools
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-2">
                                    <div className="grid grid-cols-1 min-[311px]:grid-cols-2 gap-2">
                                        {[
                                            {
                                                icon: "codicon-graph",
                                                label: "AI Metrics",
                                                action: () =>
                                                    handleProjectAction("openEditAnalysis"),
                                            },
                                            {
                                                icon: "codicon-settings",
                                                label: "Copilot Settings",
                                                action: () => handleProjectAction("openAISettings"),
                                            },
                                            {
                                                icon: "codicon-export",
                                                label: "Export",
                                                action: () => handleProjectAction("openExportView"),
                                            },
                                            {
                                                icon: "codicon-text-size",
                                                label: "Text Display",
                                                action: () => setIsTextDisplaySettingsOpen(true),
                                            },
                                            {
                                                icon: "codicon-symbol-array",
                                                label: "Import Labels",
                                                action: () =>
                                                    executeCommand("openCellLabelImporter"),
                                            },
                                            {
                                                icon: "codicon-replace-all",
                                                label: "Migration",
                                                action: () =>
                                                    executeCommand("openCodexMigrationTool"),
                                            },
                                            {
                                                icon: "codicon-circuit-board",
                                                label: "Status",
                                                action: () =>
                                                    executeCommand("openToolsStatus"),
                                                suffix: toolsStatus ? (
                                                    <StatusTooltip toolsStatus={toolsStatus} />
                                                ) : (
                                                    <span className="flex items-center ml-auto">
                                                        <i
                                                            className="codicon codicon-loading codicon-modifier-spin"
                                                            style={{ color: "var(--muted-foreground)", fontSize: "14px" }}
                                                        />
                                                    </span>
                                                ),
                                            },
                                            {
                                                icon: "codicon-extensions",
                                                label: projectState.isCheckingForUpdates
                                                    ? "Checking..."
                                                    : "Updates",
                                                action: () =>
                                                    handleProjectAction("checkForUpdates"),
                                                disabled: projectState.isCheckingForUpdates,
                                                spinning: projectState.isCheckingForUpdates,
                                            },
                                            {
                                                icon: "codicon-close",
                                                label: "Close Project",
                                                action: () => executeCommand("closeProject"),
                                                destructive: true,
                                            },
                                        ].map((item, idx) => (
                                            <button
                                                key={idx}
                                                onClick={item.action}
                                                disabled={item.disabled}
                                                className={`flex items-center gap-2 p-3 rounded-lg text-left transition-colors text-sm ${
                                                    item.destructive
                                                        ? "hover:bg-destructive/10 hover:text-destructive"
                                                        : "hover:bg-accent"
                                                } ${
                                                    item.disabled
                                                        ? "opacity-50 cursor-not-allowed"
                                                        : "cursor-pointer"
                                                }`}
                                            >
                                                <i
                                                    className={`codicon ${
                                                        item.spinning
                                                            ? "codicon-loading codicon-modifier-spin"
                                                            : item.icon
                                                    }`}
                                                    style={{
                                                        color: item.destructive
                                                            ? "var(--destructive)"
                                                            : "var(--ring)",
                                                    }}
                                                />
                                                <span className={item.destructive ? "" : ""}>
                                                    {item.label}
                                                </span>
                                                {item.suffix}
                                            </button>
                                        ))}
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
