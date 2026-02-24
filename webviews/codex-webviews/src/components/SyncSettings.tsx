import React, { useEffect } from "react";
import { useNetworkState } from "@uidotdev/usehooks";
import { vscode } from "../EditableReactTable/utilities/vscode";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";

interface SyncSettingsProps {
    autoSyncEnabled: boolean;
    syncDelayMinutes: number;
    isSyncInProgress: boolean;
    syncStage: string;
    isImportInProgress?: boolean;
    isFrontierExtensionEnabled: boolean;
    isAuthenticated: boolean;
    onToggleAutoSync: (enabled: boolean) => void;
    onChangeSyncDelay: (minutes: number) => void;
    onTriggerSync: () => void;
    onLogin: () => void;
}

export const SyncSettings: React.FC<SyncSettingsProps> = ({
    autoSyncEnabled,
    syncDelayMinutes,
    isSyncInProgress,
    syncStage,
    isImportInProgress = false,
    isFrontierExtensionEnabled,
    isAuthenticated,
    onToggleAutoSync,
    onChangeSyncDelay,
    onTriggerSync,
    onLogin,
}) => {
    const network = useNetworkState();
    const isOnline = network?.online ?? true; // Default to true if network state is unavailable

    // UI Polling Fallback: Verify sync state every 5 seconds when sync is in progress
    // This prevents UI from getting stuck if backend state changes (crash, completion, etc.)
    useEffect(() => {
        if (!isSyncInProgress) {
            return; // No need to poll when not syncing
        }

        const pollInterval = setInterval(() => {
            // Request lock status check from backend
            if (typeof vscode !== "undefined") {
                vscode.postMessage({ type: "checkSyncLock" });
            }
        }, 5000); // Poll every 5 seconds

        return () => clearInterval(pollInterval);
    }, [isSyncInProgress]);

    // Listen for lock status responses
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.data.type === "syncLockStatus") {
                // If lock doesn't exist but UI thinks sync is in progress, request refresh
                if (!event.data.exists && isSyncInProgress) {
                    console.log(
                        "[SyncSettings] Lock released but UI still shows syncing, requesting state refresh"
                    );
                    if (typeof vscode !== "undefined") {
                        vscode.postMessage({ type: "refreshSyncState" });
                    }
                }
            }
        };

        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [isSyncInProgress]);

    return (
        <Card
            className="card border-2 shadow-lg hover:shadow-xl transition-all duration-200"
            style={{
                borderColor: "var(--ring)",
                backgroundColor: "var(--card)",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
            }}
        >
            <CardHeader className="pb-4 mb-3 rounded-t-lg">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle
                        className="text-base font-semibold flex items-center gap-2"
                        style={{ color: "var(--foreground)" }}
                    >
                        <i
                            className="codicon codicon-cloud text-lg"
                            style={{ color: "var(--ring)" }}
                        />
                        Sync Settings
                    </CardTitle>
                    <Button
                        onClick={() => {
                            if (!isAuthenticated) {
                                onLogin();
                            } else {
                                onTriggerSync();
                            }
                        }}
                        disabled={
                            isSyncInProgress ||
                            isImportInProgress ||
                            !isOnline ||
                            !isFrontierExtensionEnabled
                        }
                        size="default"
                        className="button-primary font-semibold py-2 text-sm xl:text-base shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 min-w-[100px] max-w-[160px] xl:max-w-none disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none relative pl-10 pr-3 xl:pl-12 xl:pr-4"
                    >
                        {/* Icon container - positioned absolutely on the left */}
                        <div 
                            className="absolute left-0 top-0 bottom-0 w-10 xl:w-12 flex items-center justify-center"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            <i
                                className={`codicon ${
                                    isSyncInProgress
                                        ? "codicon-loading codicon-modifier-spin"
                                        : "codicon-sync"
                                }`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '16px',
                                    height: '16px',
                                    fontSize: '16px',
                                    transformOrigin: 'center center',
                                    lineHeight: 1
                                }}
                            />
                        </div>
                        
                        {/* Text - now has left padding to avoid the icon area */}
                        <span className="hidden sm:inline">
                            {!isOnline
                                ? "Offline"
                                : isSyncInProgress
                                ? syncStage || "Syncing..."
                                : !isAuthenticated
                                ? "Log in to sync"
                                : "Sync Now"}
                        </span>
                        <span className="sm:hidden">
                            {!isOnline
                                ? "Offline"
                                : isSyncInProgress
                                ? "Syncing"
                                : !isAuthenticated
                                ? "Log in to sync"
                                : "Sync"}
                        </span>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                {!isFrontierExtensionEnabled && (
                    <Alert variant="destructive">
                        <AlertDescription>
                            <div className="flex">
                                <i className="codicon codicon-warning h-4 w-4" />
                                <span className="ml-2">
                                    Enable the Frontier Authentication extension to sync
                                </span>
                            </div>
                        </AlertDescription>
                    </Alert>
                )}
                {isFrontierExtensionEnabled && !isAuthenticated && (
                    <Alert variant="destructive" className="hidden">
                        <AlertDescription>
                            <div className="flex">
                                <i className="codicon codicon-warning h-4 w-4" />
                                <span className="ml-2">You must be logged in to sync</span>
                            </div>
                        </AlertDescription>
                    </Alert>
                )}
                {!isOnline && (
                    <Alert variant="destructive">
                        <i className="codicon codicon-warning h-4 w-4" />
                        <AlertDescription>
                            Network connection unavailable. Sync functionality is disabled until
                            connection is restored.
                        </AlertDescription>
                    </Alert>
                )}
                {isFrontierExtensionEnabled && isAuthenticated && (
                    <div
                        className="flex items-center justify-between p-3 rounded-lg border transition-all duration-200 flex-wrap gap-2"
                        style={{
                            backgroundColor: "var(--muted)",
                            borderColor: "var(--border)",
                        }}
                    >
                        <div className="space-y-1">
                            <label
                                className="text-sm font-semibold flex items-center gap-2"
                                style={{ color: "var(--foreground)" }}
                            >
                                <i
                                    className="codicon codicon-settings-gear"
                                    style={{ color: "var(--muted-foreground)" }}
                                />
                                Auto-sync
                            </label>
                            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                                {!isOnline
                                    ? "Requires network connection"
                                    : "Automatically sync changes to cloud"}
                            </p>
                        </div>
                        <div className="relative">
                            <Switch
                                checked={autoSyncEnabled && isOnline}
                                onCheckedChange={isOnline ? onToggleAutoSync : undefined}
                                disabled={!isOnline}
                                className="shadow-sm border border-border/20"
                            />
                        </div>
                    </div>
                )}

                {autoSyncEnabled && isOnline && isFrontierExtensionEnabled && isAuthenticated && (
                    <div
                        className="flex items-center justify-between p-3 rounded-lg border animate-in slide-in-from-top-2 duration-300 flex-wrap gap-2"
                        style={{
                            backgroundColor: "var(--muted)",
                            borderColor: "var(--border)",
                        }}
                    >
                        <div className="space-y-1">
                            <label
                                className="text-sm font-semibold flex items-center gap-2"
                                style={{ color: "var(--foreground)" }}
                            >
                                <i
                                    className="codicon codicon-clock"
                                    style={{ color: "var(--muted-foreground)" }}
                                />
                                Sync Interval
                            </label>
                            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                                How often to sync changes
                            </p>
                        </div>
                        <Select
                            value={syncDelayMinutes.toString()}
                            onValueChange={(value) => onChangeSyncDelay(parseInt(value, 10))}
                        >
                            <SelectTrigger
                                className="w-28 lg:w-36 font-medium input text-sm"
                                style={{
                                    borderWidth: "2px",
                                    borderColor: "var(--border)",
                                }}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="5">
                                    <span className="flex items-center gap-2">
                                        <i className="codicon codicon-dashboard" />5 min
                                    </span>
                                </SelectItem>
                                <SelectItem value="15">
                                    <span className="flex items-center gap-2">
                                        <i className="codicon codicon-watch" />
                                        15 min
                                    </span>
                                </SelectItem>
                                <SelectItem value="30">
                                    <span className="flex items-center gap-2">
                                        <i className="codicon codicon-watch" />
                                        30 min
                                    </span>
                                </SelectItem>
                                <SelectItem value="60">
                                    <span className="flex items-center gap-2">
                                        <i className="codicon codicon-clock" />1 hour
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
