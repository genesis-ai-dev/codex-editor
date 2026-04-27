import React, { useEffect, useState, useCallback } from "react";
import { useNetworkState } from "@uidotdev/usehooks";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Tooltip, TooltipTrigger, TooltipContent } from "../components/ui/tooltip";

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};

const vscode = acquireVsCodeApi();

interface ToolStatus {
    git: boolean;
    nativeGitAvailable: boolean;
    sqlite: boolean;
    nativeSqliteAvailable: boolean;
    ffmpeg: boolean;
}

type ViewMode = "warnings" | "status";
type AudioToolMode = "auto" | "builtin";
type GitToolMode = "auto" | "builtin";
type SqliteToolMode = "auto" | "builtin";

interface InitialState {
    status: ToolStatus;
    mode: ViewMode;
    audioToolMode: AudioToolMode;
    gitToolMode: GitToolMode;
    sqliteToolMode: SqliteToolMode;
    syncInProgress: boolean;
    audioProcessingInProgress: boolean;
}

function getInitialState(): InitialState | null {
    try {
        const data = (window as any).initialData;
        if (data && typeof data.git === "boolean" && typeof data.sqlite === "boolean") {
            return {
                status: {
                    git: data.git,
                    nativeGitAvailable: data.nativeGitAvailable ?? data.git,
                    sqlite: data.sqlite,
                    nativeSqliteAvailable: data.nativeSqliteAvailable ?? data.sqlite,
                    ffmpeg: data.ffmpeg ?? false,
                },
                mode: data.mode === "status" ? "status" : "warnings",
                audioToolMode: data.audioToolMode ?? "auto",
                gitToolMode: data.gitToolMode ?? "auto",
                sqliteToolMode: data.sqliteToolMode ?? "auto",
                syncInProgress: data.syncInProgress ?? false,
                audioProcessingInProgress: data.audioProcessingInProgress ?? false,
            };
        }
    } catch {
        // no initialData available
    }
    return null;
}

type ToolKey = "sqlite" | "git" | "ffmpeg";

export const MissingToolsWarning: React.FC = () => {
    const initial = getInitialState();
    const [status, setStatus] = useState<ToolStatus | null>(initial?.status ?? null);
    const [mode, setMode] = useState<ViewMode>(initial?.mode ?? "warnings");
    const [audioToolMode, setAudioToolMode] = useState<AudioToolMode>(initial?.audioToolMode ?? "auto");
    const [gitToolMode, setGitToolMode] = useState<GitToolMode>(initial?.gitToolMode ?? "auto");
    const [sqliteToolMode, setSqliteToolMode] = useState<SqliteToolMode>(initial?.sqliteToolMode ?? "auto");
    const [syncInProgress, setSyncInProgress] = useState(initial?.syncInProgress ?? false);
    const [audioProcessingInProgress, setAudioProcessingInProgress] = useState(initial?.audioProcessingInProgress ?? false);
    const [retrying, setRetrying] = useState(false);
    const [downloading, setDownloading] = useState<Record<ToolKey, boolean>>({
        sqlite: false,
        git: false,
        ffmpeg: false,
    });
    const [deleteMode, setDeleteMode] = useState(false);
    const [forceBuiltinMode, setForceBuiltinMode] = useState(false);
    const [deletedTools, setDeletedTools] = useState<Set<ToolKey>>(new Set());
    const network = useNetworkState();
    const isOnline = network?.online ?? true;

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (
                message?.command === "showWarnings" ||
                message?.command === "updateWarnings"
            ) {
                setStatus({
                    git: message.git,
                    nativeGitAvailable: message.nativeGitAvailable ?? message.git,
                    sqlite: message.sqlite,
                    nativeSqliteAvailable: message.nativeSqliteAvailable ?? message.sqlite,
                    ffmpeg: message.ffmpeg,
                });
                setMode("warnings");
                setRetrying(false);
            } else if (message?.command === "showToolsStatus") {
                setStatus({
                    git: message.git,
                    nativeGitAvailable: message.nativeGitAvailable ?? message.git,
                    sqlite: message.sqlite,
                    nativeSqliteAvailable: message.nativeSqliteAvailable ?? message.sqlite,
                    ffmpeg: message.ffmpeg,
                });
                setAudioToolMode(message.audioToolMode ?? "auto");
                setGitToolMode(message.gitToolMode ?? "auto");
                setSqliteToolMode(message.sqliteToolMode ?? "auto");
                setSyncInProgress(message.syncInProgress ?? false);
                setAudioProcessingInProgress(message.audioProcessingInProgress ?? false);
                setMode("status");
            } else if (message?.command === "toolDownloadResult") {
                setStatus({
                    git: message.git,
                    nativeGitAvailable: message.nativeGitAvailable ?? message.git,
                    sqlite: message.sqlite,
                    nativeSqliteAvailable: message.nativeSqliteAvailable ?? message.sqlite,
                    ffmpeg: message.ffmpeg,
                });
                if (message.audioToolMode) {
                    setAudioToolMode(message.audioToolMode);
                }
                if (message.gitToolMode) {
                    setGitToolMode(message.gitToolMode);
                }
                if (message.sqliteToolMode) {
                    setSqliteToolMode(message.sqliteToolMode);
                }
                setDownloading((prev) => ({ ...prev, [message.tool]: false }));
            } else if (message?.command === "audioModeChanged") {
                setAudioToolMode(message.audioToolMode);
                setStatus((prev) => prev ? { ...prev, ffmpeg: message.ffmpeg } : prev);
            } else if (message?.command === "gitModeChanged") {
                setGitToolMode(message.gitToolMode);
                setStatus((prev) => prev ? {
                    ...prev,
                    git: message.git,
                    nativeGitAvailable: message.nativeGitAvailable ?? prev.nativeGitAvailable,
                } : prev);
            } else if (message?.command === "sqliteModeChanged") {
                setSqliteToolMode(message.sqliteToolMode);
                setStatus((prev) => prev ? {
                    ...prev,
                    sqlite: message.sqlite,
                    nativeSqliteAvailable: message.nativeSqliteAvailable ?? prev.nativeSqliteAvailable,
                } : prev);
            } else if (message?.command === "operationStatusChanged") {
                setSyncInProgress(message.syncInProgress);
                setAudioProcessingInProgress(message.audioProcessingInProgress);
            } else if (message?.command === "showDeleteButtons") {
                setDeleteMode(true);
            } else if (message?.command === "showForceBuiltinButtons") {
                setForceBuiltinMode(true);
            } else if (message?.command === "toolDeleted") {
                setDeletedTools((prev) => new Set(prev).add(message.tool));
            }
        };

        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    const handleRetry = useCallback(() => {
        if (!isOnline) return;
        setRetrying(true);
        vscode.postMessage({ command: "retry" });
    }, [isOnline]);

    const handleContinue = useCallback(() => {
        vscode.postMessage({ command: "continue" });
    }, []);

    const handleClose = useCallback(() => {
        vscode.postMessage({ command: "close" });
    }, []);

    const handleDownload = useCallback(() => {
        vscode.postMessage({ command: "openDownloadPage" });
    }, []);

    const handleDownloadTool = useCallback((tool: ToolKey) => {
        setDownloading((prev) => ({ ...prev, [tool]: true }));
        vscode.postMessage({ command: "downloadTool", tool });
    }, []);

    const handleToggleAudioMode = useCallback(() => {
        vscode.postMessage({ command: "toggleAudioMode" });
    }, []);

    const handleToggleGitMode = useCallback(() => {
        vscode.postMessage({ command: "toggleGitMode" });
    }, []);

    const handleToggleSqliteMode = useCallback(() => {
        vscode.postMessage({ command: "toggleSqliteMode" });
    }, []);

    const handleDeleteTool = useCallback((tool: ToolKey) => {
        vscode.postMessage({ command: "deleteTool", tool });
    }, []);

    const handleForceBuiltinTool = useCallback((tool: ToolKey) => {
        vscode.postMessage({ command: "forceBuiltinTool", tool });
    }, []);

    const handleReloadWindow = useCallback(() => {
        vscode.postMessage({ command: "reloadWindow" });
    }, []);

    if (!status) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p className="text-muted-foreground text-sm">Checking tools…</p>
            </div>
        );
    }

    if (mode === "status") {
        return (
            <ToolsStatusView
                status={status}
                isOnline={isOnline}
                audioToolMode={audioToolMode}
                gitToolMode={gitToolMode}
                sqliteToolMode={sqliteToolMode}
                syncInProgress={syncInProgress}
                audioProcessingInProgress={audioProcessingInProgress}
                downloading={downloading}
                deleteMode={deleteMode}
                forceBuiltinMode={forceBuiltinMode}
                deletedTools={deletedTools}
                onClose={handleClose}
                onDownloadTool={handleDownloadTool}
                onToggleAudioMode={handleToggleAudioMode}
                onToggleGitMode={handleToggleGitMode}
                onToggleSqliteMode={handleToggleSqliteMode}
                onDeleteTool={handleDeleteTool}
                onForceBuiltinTool={handleForceBuiltinTool}
                onReloadWindow={handleReloadWindow}
            />
        );
    }

    return <WarningsView status={status} isOnline={isOnline} retrying={retrying} onRetry={handleRetry} onContinue={handleContinue} onDownload={handleDownload} />;
};

const TOOL_INFO = {
    sqlite: {
        name: "AI Learning and Search Tools",
        iconOk: "codicon-check",
        iconMissing: "codicon-error",
        descriptions: {
            available: "The native AI learning and search tools are installed and running.",
            limited: "Using fallback tools. Native tools are installed but not active.",
            builtinActive: "Using fallback tools. Full functionality is available but less performant.",
            missing: "The AI learning and search tools could not be set up. Projects cannot be opened or created without this component.",
        },
    },
    git: {
        name: "Sync Tools",
        iconOk: "codicon-check",
        iconMissing: "codicon-warning",
        descriptions: {
            available: "Native sync tools are active. Syncing and collaboration are fully operational.",
            limited: "Using fallback sync tools. Native sync tools are installed but not active.",
            builtinActive: "Using fallback sync tools. Syncing and collaboration may be limited.",
        },
    },
    ffmpeg: {
        name: "Audio Tools",
        iconOk: "codicon-check",
        iconMissing: "codicon-warning",
        descriptions: {
            available: "Native audio tools are active. Full audio format support is available for import/export.",
            limited: "Using fallback audio tools (.wav format). Full audio format support requires native audio tools.",
            missing: "Native audio tools could not be set up. Using fallback audio tools (.wav only).",
        },
    },
} as const;

interface ToolsStatusViewProps {
    status: ToolStatus;
    isOnline: boolean;
    audioToolMode: AudioToolMode;
    gitToolMode: GitToolMode;
    sqliteToolMode: SqliteToolMode;
    syncInProgress: boolean;
    audioProcessingInProgress: boolean;
    downloading: Record<ToolKey, boolean>;
    deleteMode: boolean;
    forceBuiltinMode: boolean;
    deletedTools: Set<ToolKey>;
    onClose: () => void;
    onDownloadTool: (tool: ToolKey) => void;
    onToggleAudioMode: () => void;
    onToggleGitMode: () => void;
    onToggleSqliteMode: () => void;
    onDeleteTool: (tool: ToolKey) => void;
    onForceBuiltinTool: (tool: ToolKey) => void;
    onReloadWindow: () => void;
}

const ToolsStatusView: React.FC<ToolsStatusViewProps> = ({
    status,
    isOnline,
    audioToolMode,
    gitToolMode,
    sqliteToolMode,
    syncInProgress,
    audioProcessingInProgress,
    downloading,
    deleteMode,
    forceBuiltinMode,
    deletedTools,
    onClose,
    onDownloadTool,
    onToggleAudioMode,
    onToggleGitMode,
    onToggleSqliteMode,
    onDeleteTool,
    onForceBuiltinTool,
    onReloadWindow,
}) => {
    const isForced = (mode: string) => mode === "force-builtin";
    const isBuiltinMode = (mode: string) => mode === "builtin" || mode === "force-builtin";

    const allOk = status.nativeSqliteAvailable && !isBuiltinMode(sqliteToolMode)
        && status.nativeGitAvailable && !isBuiltinMode(gitToolMode)
        && status.ffmpeg && !isBuiltinMode(audioToolMode);

    const getToolState = (mode: string, nativeAvailable: boolean) => {
        const forced = isForced(mode);
        const usingBuiltIn = isBuiltinMode(mode) || !nativeAvailable;
        const severity: "ok" | "warning" | "error" =
            forced ? "warning"
            : isBuiltinMode(mode) ? "warning"
            : !nativeAvailable ? "error"
            : "ok";
        const statusLabel =
            forced ? "Running Fallback Tools (locked)"
            : nativeAvailable && !usingBuiltIn ? "Installed and Running Native Tools"
            : nativeAvailable && usingBuiltIn ? "Installed and Running Fallback Tools"
            : "Not Installed \u2013 Running Fallback Tools";
        const toggleLabel =
            forced ? "Unlock Native Tools"
            : nativeAvailable && usingBuiltIn ? "Use Native Tools"
            : nativeAvailable ? "Use Fallback Tools"
            : undefined;
        const showDownload = !isBuiltinMode(mode) && !nativeAvailable;
        const showToggle = forced || nativeAvailable;

        return { forced, usingBuiltIn, severity, statusLabel, toggleLabel, showDownload, showToggle };
    };

    const sqlite = getToolState(sqliteToolMode, status.nativeSqliteAvailable);
    const git = getToolState(gitToolMode, status.nativeGitAvailable);
    const audio = getToolState(audioToolMode, status.ffmpeg);

    return (
        <div className="flex items-center justify-center min-h-screen p-6">
            <div className="w-full max-w-lg space-y-6">
                <div className="text-center space-y-2">
                    <h1
                        className="text-2xl font-bold"
                        style={{ color: "var(--foreground)" }}
                    >
                        Status
                    </h1>
                    <p
                        className="text-sm"
                        style={{ color: "var(--muted-foreground)" }}
                    >
                        {allOk
                            ? "All native tools are installed and running."
                            : "Some native tools are not fully configured. Codex is using fallback alternatives where needed."}
                    </p>
                </div>

                <div className="space-y-3">
                    <StatusCard
                        title={TOOL_INFO.sqlite.name}
                        description={
                            sqlite.usingBuiltIn
                                ? (status.sqlite ? TOOL_INFO.sqlite.descriptions.builtinActive : TOOL_INFO.sqlite.descriptions.missing)
                                : TOOL_INFO.sqlite.descriptions.available
                        }
                        severity={!status.sqlite && !sqlite.forced ? "error" : sqlite.severity}
                        statusLabelOverride={!status.sqlite && !sqlite.forced ? undefined : sqlite.statusLabel}
                        isOnline={isOnline}
                        downloading={downloading.sqlite}
                        onDownload={sqlite.showDownload ? () => onDownloadTool("sqlite") : undefined}
                        toggleLabel={sqlite.toggleLabel}
                        onToggle={sqlite.showToggle ? onToggleSqliteMode : undefined}
                        onDelete={deleteMode ? () => onDeleteTool("sqlite") : undefined}
                        onForceBuiltin={forceBuiltinMode && !sqlite.forced ? () => onForceBuiltinTool("sqlite") : undefined}
                        deleted={deletedTools.has("sqlite")}
                        nativeInstalled={status.nativeSqliteAvailable}
                    />

                    <StatusCard
                        title={TOOL_INFO.git.name}
                        description={
                            git.usingBuiltIn
                                ? TOOL_INFO.git.descriptions.builtinActive
                                : TOOL_INFO.git.descriptions.available
                        }
                        severity={git.severity}
                        statusLabelOverride={git.statusLabel}
                        isOnline={isOnline}
                        downloading={downloading.git}
                        onDownload={git.showDownload ? () => onDownloadTool("git") : undefined}
                        toggleLabel={git.toggleLabel}
                        onToggle={git.showToggle ? onToggleGitMode : undefined}
                        toggleDisabled={syncInProgress}
                        toggleDisabledReason={syncInProgress ? "Cannot switch while sync is in progress" : undefined}
                        onDelete={deleteMode ? () => onDeleteTool("git") : undefined}
                        onForceBuiltin={forceBuiltinMode && !git.forced ? () => onForceBuiltinTool("git") : undefined}
                        deleted={deletedTools.has("git")}
                        nativeInstalled={status.nativeGitAvailable}
                    />

                    <StatusCard
                        title={TOOL_INFO.ffmpeg.name}
                        description={
                            audio.usingBuiltIn
                                ? TOOL_INFO.ffmpeg.descriptions.limited
                                : TOOL_INFO.ffmpeg.descriptions.available
                        }
                        severity={audio.severity}
                        statusLabelOverride={audio.statusLabel}
                        isOnline={isOnline}
                        downloading={downloading.ffmpeg}
                        onDownload={audio.showDownload ? () => onDownloadTool("ffmpeg") : undefined}
                        toggleLabel={audio.toggleLabel}
                        onToggle={audio.showToggle ? onToggleAudioMode : undefined}
                        toggleDisabled={audioProcessingInProgress}
                        toggleDisabledReason={audioProcessingInProgress ? "Cannot switch while audio is being processed" : undefined}
                        onDelete={deleteMode ? () => onDeleteTool("ffmpeg") : undefined}
                        onForceBuiltin={forceBuiltinMode && !audio.forced ? () => onForceBuiltinTool("ffmpeg") : undefined}
                        deleted={deletedTools.has("ffmpeg")}
                        nativeInstalled={status.ffmpeg}
                    />
                </div>

                <div className="flex justify-center gap-3">
                    {deletedTools.size > 0 ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span>
                                    <Button
                                        disabled
                                        variant="outline"
                                        className="min-w-[120px]"
                                    >
                                        Close
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                Reload the window to apply tool changes
                            </TooltipContent>
                        </Tooltip>
                    ) : (
                        <Button
                            onClick={onClose}
                            variant="outline"
                            className="min-w-[120px]"
                        >
                            Close
                        </Button>
                    )}
                    {deletedTools.size > 0 && (
                        <Button
                            onClick={onReloadWindow}
                            className="min-w-[160px]"
                        >
                            <i className="codicon codicon-refresh mr-2" />
                            Reload to Apply
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

interface WarningsViewProps {
    status: ToolStatus;
    isOnline: boolean;
    retrying: boolean;
    onRetry: () => void;
    onContinue: () => void;
    onDownload: () => void;
}

const WarningsView: React.FC<WarningsViewProps> = ({
    status,
    isOnline,
    retrying,
    onRetry,
    onContinue,
    onDownload,
}) => {
    const sqliteMissing = !status.sqlite;
    const gitMissing = !status.git;
    const audioMissing = !status.ffmpeg;
    const canContinue = !sqliteMissing;
    const missingCount =
        (sqliteMissing ? 1 : 0) +
        (gitMissing ? 1 : 0) +
        (audioMissing ? 1 : 0);

    return (
        <div className="flex items-center justify-center min-h-screen p-6">
            <div className="w-full max-w-lg space-y-6">
                <div className="text-center space-y-2">
                    <h1
                        className="text-2xl font-bold"
                        style={{ color: "var(--foreground)" }}
                    >
                        Some Codex features are unavailable
                    </h1>
                    <p
                        className="text-sm"
                        style={{ color: "var(--muted-foreground)" }}
                    >
                        Some native tools could not be set up. Codex will use
                        fallback alternatives where available.
                    </p>
                </div>

                <div className="space-y-3">
                    {sqliteMissing && (
                        <ToolCard
                            icon="codicon-error"
                            iconColor="var(--destructive)"
                            title="AI Learning and Search Tools"
                            description="The AI learning and search tools could not be set up. Projects cannot be opened or created without this component."
                            severity="error"
                        />
                    )}

                    {gitMissing && (
                        <ToolCard
                            icon="codicon-warning"
                            iconColor="var(--chart-4)"
                            title="Sync Tools"
                            description="Native sync tools could not be set up. Fallback sync tools are active, but syncing and collaboration features may be limited. Your work will be saved locally."
                            severity="warning"
                        />
                    )}

                    {audioMissing && (
                        <ToolCard
                            icon="codicon-warning"
                            iconColor="var(--chart-4)"
                            title="Audio Tools"
                            description="Native audio tools could not be set up. Fallback audio tools are active with limited format support (.wav only)."
                            severity="warning"
                        />
                    )}
                </div>

                <Card
                    className="border"
                    style={{
                        borderColor: "var(--border)",
                        backgroundColor: "var(--muted)",
                    }}
                >
                    <CardContent className="p-4 text-center space-y-2">
                        <p
                            className="text-sm"
                            style={{ color: "var(--muted-foreground)" }}
                        >
                            These tools are included in the Codex application.
                        </p>
                        <Button
                            variant="link"
                            onClick={onDownload}
                            className="text-sm font-semibold underline p-0 h-auto"
                        >
                            Download from codexeditor.app
                        </Button>
                    </CardContent>
                </Card>

                {!canContinue && (
                    <Alert variant="destructive">
                        <AlertDescription className="text-center">
                            Codex cannot start without the search tools.
                            Please download the Codex application from{" "}
                            <button
                                onClick={onDownload}
                                className="underline font-semibold cursor-pointer bg-transparent border-none p-0"
                                style={{ color: "inherit" }}
                            >
                                codexeditor.app
                            </button>{" "}
                            or check your internet connection and retry.
                        </AlertDescription>
                    </Alert>
                )}

                <div className="flex flex-col items-center gap-2">
                    <div className="flex gap-3 justify-center">
                        <Button
                            onClick={isOnline ? onRetry : undefined}
                            disabled={!isOnline || retrying}
                            variant="outline"
                            className="min-w-[150px]"
                        >
                            {retrying ? (
                                <>
                                    <i className="codicon codicon-loading codicon-modifier-spin mr-2" />
                                    Retrying…
                                </>
                            ) : (
                                <>
                                    <i className={`codicon ${isOnline ? "codicon-refresh" : "codicon-globe"} mr-2`} />
                                    {missingCount === 1 ? "Retry Download" : "Retry Downloads"}
                                </>
                            )}
                        </Button>

                        {canContinue && (
                            <Button
                                onClick={onContinue}
                                className="min-w-[180px]"
                            >
                                Continue with limitations
                            </Button>
                        )}
                    </div>

                    {!isOnline && (
                        <p
                            className="text-xs text-center"
                            style={{ color: "var(--muted-foreground)" }}
                        >
                            <i className="codicon codicon-warning mr-1" />
                            You are offline. Connect to the internet to retry.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

interface ToolCardProps {
    icon: string;
    iconColor: string;
    title: string;
    description: string;
    severity: "error" | "warning";
}

const ToolCard: React.FC<ToolCardProps> = ({
    icon,
    iconColor,
    title,
    description,
    severity,
}) => (
    <Card
        className="border-2"
        style={{
            borderColor:
                severity === "error"
                    ? "var(--destructive)"
                    : "var(--chart-4)",
            backgroundColor: "var(--card)",
        }}
    >
        <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <i className={`codicon ${icon}`} style={{ color: iconColor }} />
                <span style={{ color: "var(--foreground)" }}>{title}</span>
            </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
            <p
                className="text-xs leading-relaxed"
                style={{ color: "var(--muted-foreground)" }}
            >
                {description}
            </p>
        </CardContent>
    </Card>
);

interface StatusCardProps {
    title: string;
    description: string;
    severity: "ok" | "warning" | "error";
    statusLabelOverride?: string;
    isOnline?: boolean;
    downloading?: boolean;
    onDownload?: () => void;
    toggleLabel?: string;
    onToggle?: () => void;
    toggleDisabled?: boolean;
    toggleDisabledReason?: string;
    onDelete?: () => void;
    onForceBuiltin?: () => void;
    deleted?: boolean;
    nativeInstalled?: boolean;
}

const StatusCard: React.FC<StatusCardProps> = ({
    title,
    description,
    severity,
    statusLabelOverride,
    isOnline = true,
    downloading = false,
    onDownload,
    toggleLabel,
    onToggle,
    toggleDisabled = false,
    toggleDisabledReason,
    onDelete,
    onForceBuiltin,
    deleted = false,
    nativeInstalled = true,
}) => {
    const borderColor =
        severity === "ok"
            ? "var(--chart-2)"
            : severity === "error"
              ? "var(--destructive)"
              : "var(--chart-4)";

    const icon =
        severity === "ok"
            ? "codicon-check"
            : severity === "error"
              ? "codicon-error"
              : "codicon-warning";

    const iconColor = borderColor;

    const statusLabel = statusLabelOverride ?? (
        severity === "ok"
            ? "Installed and Running Native Tools"
            : "Not Installed \u2013 Running Fallback Tools"
    );

    return (
        <Card
            className="border-2"
            style={{
                borderColor,
                backgroundColor: "var(--card)",
            }}
        >
            <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <i className={`codicon ${icon}`} style={{ color: iconColor }} />
                    <span style={{ color: "var(--foreground)" }}>{title}</span>
                    <span
                        className="ml-auto text-xs font-normal"
                        style={{ color: iconColor }}
                    >
                        {statusLabel}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-2">
                <p
                    className="text-xs leading-relaxed"
                    style={{ color: "var(--muted-foreground)" }}
                >
                    {description}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                    {onDownload && (
                        !isOnline && !downloading ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled
                                            className="h-7 text-xs"
                                        >
                                            <i className="codicon codicon-globe mr-1.5" />
                                            Offline
                                        </Button>
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    Connect to the internet to download
                                </TooltipContent>
                            </Tooltip>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={isOnline ? onDownload : undefined}
                                disabled={!isOnline || downloading}
                                className="h-7 text-xs"
                            >
                                {downloading ? (
                                    <>
                                        <i className="codicon codicon-loading codicon-modifier-spin mr-1.5" />
                                        Downloading…
                                    </>
                                ) : (
                                    <>
                                        <i className="codicon codicon-cloud-download mr-1.5" />
                                        Download and Install
                                    </>
                                )}
                            </Button>
                        )
                    )}
                    {onToggle && toggleLabel && (
                        toggleDisabled && toggleDisabledReason ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled
                                            className="h-7 text-xs"
                                        >
                                            <i className="codicon codicon-arrow-swap mr-1.5" />
                                            {toggleLabel}
                                        </Button>
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    {toggleDisabledReason}
                                </TooltipContent>
                            </Tooltip>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onToggle}
                                disabled={toggleDisabled}
                                className="h-7 text-xs"
                            >
                                <i className="codicon codicon-arrow-swap mr-1.5" />
                                {toggleLabel}
                            </Button>
                        )
                    )}
                    {onDelete && (
                        <Button
                            variant={deleted || !nativeInstalled ? "outline" : "destructive"}
                            size="sm"
                            onClick={deleted || !nativeInstalled ? undefined : onDelete}
                            disabled={deleted || !nativeInstalled}
                            className="h-7 text-xs"
                        >
                            <i className={`codicon ${deleted ? "codicon-check" : !nativeInstalled ? "codicon-circle-slash" : "codicon-trash"} mr-1.5`} />
                            {deleted ? "Deleted" : !nativeInstalled ? "Not Installed" : "Delete Tools"}
                        </Button>
                    )}
                    {onForceBuiltin && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onForceBuiltin}
                            className="h-7 text-xs"
                        >
                            <i className="codicon codicon-lock mr-1.5" />
                            Force Fallback Only
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
