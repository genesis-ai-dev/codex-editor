import React, { useEffect, useState, useCallback } from "react";
import { useNetworkState } from "@uidotdev/usehooks";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Alert, AlertDescription } from "../components/ui/alert";

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};

const vscode = acquireVsCodeApi();

interface ToolStatus {
    git: boolean;
    nativeGitAvailable: boolean;
    sqlite: boolean;
    ffmpeg: boolean;
}

type ViewMode = "warnings" | "status";
type AudioToolMode = "auto" | "builtin";
type GitToolMode = "auto" | "builtin";

interface InitialState {
    status: ToolStatus;
    mode: ViewMode;
    audioToolMode: AudioToolMode;
    gitToolMode: GitToolMode;
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
                    ffmpeg: data.ffmpeg ?? false,
                },
                mode: data.mode === "status" ? "status" : "warnings",
                audioToolMode: data.audioToolMode ?? "auto",
                gitToolMode: data.gitToolMode ?? "auto",
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
    const [retrying, setRetrying] = useState(false);
    const [downloading, setDownloading] = useState<Record<ToolKey, boolean>>({
        sqlite: false,
        git: false,
        ffmpeg: false,
    });
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
                    ffmpeg: message.ffmpeg,
                });
                setMode("warnings");
                setRetrying(false);
            } else if (message?.command === "showToolsStatus") {
                setStatus({
                    git: message.git,
                    nativeGitAvailable: message.nativeGitAvailable ?? message.git,
                    sqlite: message.sqlite,
                    ffmpeg: message.ffmpeg,
                });
                setAudioToolMode(message.audioToolMode ?? "auto");
                setGitToolMode(message.gitToolMode ?? "auto");
                setMode("status");
            } else if (message?.command === "toolDownloadResult") {
                setStatus({
                    git: message.git,
                    nativeGitAvailable: message.nativeGitAvailable ?? message.git,
                    sqlite: message.sqlite,
                    ffmpeg: message.ffmpeg,
                });
                if (message.audioToolMode) {
                    setAudioToolMode(message.audioToolMode);
                }
                if (message.gitToolMode) {
                    setGitToolMode(message.gitToolMode);
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
                audioToolMode={audioToolMode}
                gitToolMode={gitToolMode}
                downloading={downloading}
                onClose={handleClose}
                onDownloadTool={handleDownloadTool}
                onToggleAudioMode={handleToggleAudioMode}
                onToggleGitMode={handleToggleGitMode}
            />
        );
    }

    return <WarningsView status={status} isOnline={isOnline} retrying={retrying} onRetry={handleRetry} onContinue={handleContinue} onDownload={handleDownload} />;
};

const TOOL_INFO = {
    sqlite: {
        name: "AI Learning and Search Engine",
        iconOk: "codicon-check",
        iconMissing: "codicon-error",
        descriptions: {
            available: "The AI learning and search engine is working correctly.",
            missing: "The AI learning and search engine could not be set up. Projects cannot be opened or created without this component.",
        },
    },
    git: {
        name: "Sync Tools",
        iconOk: "codicon-check",
        iconMissing: "codicon-warning",
        descriptions: {
            available: "Syncing and collaboration features are fully operational.",
            limited: "Using fallback sync tools. Full sync tools are installed but not active.",
            builtinActive: "Syncing and collaboration features are operational using the built-in engine.",
        },
    },
    ffmpeg: {
        name: "Audio Tools",
        iconOk: "codicon-check",
        iconMissing: "codicon-warning",
        descriptions: {
            available: "Full audio format support is available for import and export.",
            limited: "Using fallback audio processing (.wav format). Install the full audio tools for additional format support.",
            missing: "Audio tools could not be set up. Using fallback audio processing (.wav only).",
        },
    },
} as const;

interface ToolsStatusViewProps {
    status: ToolStatus;
    audioToolMode: AudioToolMode;
    gitToolMode: GitToolMode;
    downloading: Record<ToolKey, boolean>;
    onClose: () => void;
    onDownloadTool: (tool: ToolKey) => void;
    onToggleAudioMode: () => void;
    onToggleGitMode: () => void;
}

const ToolsStatusView: React.FC<ToolsStatusViewProps> = ({
    status,
    audioToolMode,
    gitToolMode,
    downloading,
    onClose,
    onDownloadTool,
    onToggleAudioMode,
    onToggleGitMode,
}) => {
    const audioUsingBuiltIn = audioToolMode === "builtin" || !status.ffmpeg;
    const gitUsingBuiltIn = gitToolMode === "builtin" || !status.nativeGitAvailable;
    const allOk = status.sqlite && status.nativeGitAvailable && status.ffmpeg;

    const audioDescription = (() => {
        if (audioToolMode === "builtin" && status.ffmpeg) {
            return "Using fallback audio processing. Full audio tools are installed but not active.";
        }
        if (audioToolMode === "builtin" && !status.ffmpeg) {
            return "Using fallback audio processing (.wav format). Full audio tools are not installed.";
        }
        if (status.ffmpeg) {
            return TOOL_INFO.ffmpeg.descriptions.available;
        }
        return TOOL_INFO.ffmpeg.descriptions.limited;
    })();

    const audioSeverity: "ok" | "warning" = audioUsingBuiltIn
        ? (status.ffmpeg ? "ok" : "warning")
        : "ok";

    const audioStatusLabel = (() => {
        if (!audioUsingBuiltIn) {
            return "Installed";
        }
        return status.ffmpeg ? "Installed – Using Fallback" : "Not Installed – Using Fallback";
    })();

    return (
        <div className="flex items-center justify-center min-h-screen p-6">
            <div className="w-full max-w-lg space-y-6">
                <div className="text-center space-y-2">
                    <h1
                        className="text-2xl font-bold"
                        style={{ color: "var(--foreground)" }}
                    >
                        Tools Status
                    </h1>
                    <p
                        className="text-sm"
                        style={{ color: "var(--muted-foreground)" }}
                    >
                        {allOk
                            ? "All tools are installed and working properly."
                            : "Some tools are not fully configured. Codex can still work with reduced functionality."}
                    </p>
                </div>

                <div className="space-y-3">
                    <StatusCard
                        title={TOOL_INFO.sqlite.name}
                        description={
                            status.sqlite
                                ? TOOL_INFO.sqlite.descriptions.available
                                : TOOL_INFO.sqlite.descriptions.missing
                        }
                        severity={status.sqlite ? "ok" : "error"}
                        downloading={downloading.sqlite}
                        onDownload={!status.sqlite ? () => onDownloadTool("sqlite") : undefined}
                    />

                    <StatusCard
                        title={TOOL_INFO.git.name}
                        description={(() => {
                            if (gitToolMode === "builtin" && status.nativeGitAvailable) {
                                return TOOL_INFO.git.descriptions.limited;
                            }
                            if (!status.nativeGitAvailable) {
                                return TOOL_INFO.git.descriptions.builtinActive;
                            }
                            return TOOL_INFO.git.descriptions.available;
                        })()}
                        severity={gitUsingBuiltIn ? "ok" : "ok"}
                        statusLabelOverride={(() => {
                            if (status.nativeGitAvailable && !gitUsingBuiltIn) {
                                return "Installed";
                            }
                            if (status.nativeGitAvailable && gitUsingBuiltIn) {
                                return "Installed \u2013 Using Built-in Engine";
                            }
                            return "Using Built-in Engine";
                        })()}
                        downloading={downloading.git}
                        onDownload={!status.nativeGitAvailable ? () => onDownloadTool("git") : undefined}
                        toggleLabel={status.nativeGitAvailable ? (gitUsingBuiltIn ? "Switch to Full" : "Switch to Built-in") : undefined}
                        onToggle={status.nativeGitAvailable ? onToggleGitMode : undefined}
                    />

                    <StatusCard
                        title={TOOL_INFO.ffmpeg.name}
                        description={audioDescription}
                        severity={audioSeverity}
                        statusLabelOverride={audioStatusLabel}
                        downloading={downloading.ffmpeg}
                        onDownload={!status.ffmpeg ? () => onDownloadTool("ffmpeg") : undefined}
                        toggleLabel={status.ffmpeg ? (audioUsingBuiltIn ? "Switch to Full" : "Switch to Fallback") : undefined}
                        onToggle={status.ffmpeg ? onToggleAudioMode : undefined}
                    />
                </div>

                <div className="flex justify-center">
                    <Button
                        onClick={onClose}
                        variant="outline"
                        className="min-w-[120px]"
                    >
                        Close
                    </Button>
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
                        The following tools could not be set up. Codex needs them to
                        work properly.
                    </p>
                </div>

                <div className="space-y-3">
                    {sqliteMissing && (
                        <ToolCard
                            icon="codicon-error"
                            iconColor="var(--destructive)"
                            title="Search Engine (SQLite)"
                            description="The search and AI learning engine could not be set up. Projects cannot be opened or created without this component."
                            severity="error"
                        />
                    )}

                    {gitMissing && (
                        <ToolCard
                            icon="codicon-warning"
                            iconColor="var(--chart-4)"
                            title="Sync Tools (Git)"
                            description="Sync tools could not be set up. You can still work offline, but syncing and collaboration features are unavailable. Your work will be saved locally."
                            severity="warning"
                        />
                    )}

                    {audioMissing && (
                        <ToolCard
                            icon="codicon-warning"
                            iconColor="var(--chart-4)"
                            title="Audio Tools"
                            description="Audio tools could not be set up. Audio import will work but is limited to .wav export. Install the tools for full format support."
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
                            Codex cannot start without the search engine.
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
    downloading?: boolean;
    onDownload?: () => void;
    toggleLabel?: string;
    onToggle?: () => void;
}

const StatusCard: React.FC<StatusCardProps> = ({
    title,
    description,
    severity,
    statusLabelOverride,
    downloading = false,
    onDownload,
    toggleLabel,
    onToggle,
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
            ? "Installed"
            : "Not Installed – Using Fallback"
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
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onDownload}
                            disabled={downloading}
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
                                    Download
                                </>
                            )}
                        </Button>
                    )}
                    {onToggle && toggleLabel && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onToggle}
                            className="h-7 text-xs"
                        >
                            <i className="codicon codicon-arrow-swap mr-1.5" />
                            {toggleLabel}
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
