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
    sqlite: boolean;
    ffmpeg: boolean;
    ffprobe: boolean;
}

function getInitialStatus(): ToolStatus | null {
    try {
        const data = (window as any).initialData;
        if (data && typeof data.git === "boolean" && typeof data.sqlite === "boolean") {
            return {
                git: data.git,
                sqlite: data.sqlite,
                ffmpeg: data.ffmpeg ?? false,
                ffprobe: data.ffprobe ?? false,
            };
        }
    } catch {
        // no initialData available
    }
    return null;
}

export const MissingToolsWarning: React.FC = () => {
    const [status, setStatus] = useState<ToolStatus | null>(getInitialStatus);
    const [retrying, setRetrying] = useState(false);
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
                    sqlite: message.sqlite,
                    ffmpeg: message.ffmpeg,
                    ffprobe: message.ffprobe,
                });
                setRetrying(false);
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

    const handleDownload = useCallback(() => {
        vscode.postMessage({ command: "openDownloadPage" });
    }, []);

    if (!status) {
        return (
            <div className="flex items-center justify-center h-screen">
                <p className="text-muted-foreground text-sm">Checking tools…</p>
            </div>
        );
    }

    const sqliteMissing = !status.sqlite;
    const gitMissing = !status.git;
    const audioMissing = !status.ffmpeg || !status.ffprobe;
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
                            title="AI Learning Engine"
                            description="The AI learning and search engine could not be set up. Projects cannot be opened or created without this component."
                            severity="error"
                        />
                    )}

                    {gitMissing && (
                        <ToolCard
                            icon="codicon-warning"
                            iconColor="var(--chart-4)"
                            title="Sync Tool"
                            description="The sync tool could not be set up. You can still work offline, but syncing and collaboration features are unavailable. Your work will be saved locally."
                            severity="warning"
                        />
                    )}

                    {audioMissing && (
                        <ToolCard
                            icon="codicon-warning"
                            iconColor="var(--chart-4)"
                            title="Audio Tools"
                            description="Audio tools could not be set up. Audio import and export features are unavailable."
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
                            onClick={handleDownload}
                            className="text-sm font-semibold underline p-0 h-auto"
                        >
                            Download from codexeditor.app
                        </Button>
                    </CardContent>
                </Card>

                {!canContinue && (
                    <Alert variant="destructive">
                        <AlertDescription className="text-center">
                            Codex cannot start without the AI learning engine.
                            Please download the Codex application from{" "}
                            <button
                                onClick={handleDownload}
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
                            onClick={isOnline ? handleRetry : undefined}
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
                                onClick={handleContinue}
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
