import React from "react";
import { useNetworkState } from "@uidotdev/usehooks";
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
    onToggleAutoSync: (enabled: boolean) => void;
    onChangeSyncDelay: (minutes: number) => void;
    onTriggerSync: () => void;
}

export const SyncSettings: React.FC<SyncSettingsProps> = ({
    autoSyncEnabled,
    syncDelayMinutes,
    isSyncInProgress,
    syncStage,
    onToggleAutoSync,
    onChangeSyncDelay,
    onTriggerSync,
}) => {
    const network = useNetworkState();
    const isOnline = network?.online ?? true; // Default to true if network state is unavailable
    return (
        <Card
            className="card border-2 shadow-lg hover:shadow-xl transition-all duration-200"
            style={{
                borderColor: "var(--ring)",
                backgroundColor: "var(--card)",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
            }}
        >
            <CardHeader className="pb-4 mb-3">
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
                        onClick={onTriggerSync}
                        disabled={isSyncInProgress || !isOnline}
                        size="default"
                        className="button-primary font-semibold px-3 py-2 text-sm xl:px-4 xl:text-base shadow-md hover:shadow-lg transform hover:scale-105 transition-all duration-200 min-w-[100px] max-w-[140px] xl:max-w-none disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                        <i
                            className={`codicon ${
                                isSyncInProgress
                                    ? "codicon-loading codicon-modifier-spin"
                                    : "codicon-sync"
                            } mr-2 h-4 w-4`}
                            style={{ height: "fit-content" }}
                        />
                        <span className="hidden sm:inline">
                            {!isOnline
                                ? "Offline"
                                : isSyncInProgress
                                ? syncStage || "Syncing..."
                                : "Sync Now"}
                        </span>
                        <span className="sm:hidden">
                            {!isOnline ? "Offline" : isSyncInProgress ? "Syncing" : "Sync"}
                        </span>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                {!isOnline && (
                    <Alert variant="destructive">
                        <i className="codicon codicon-warning h-4 w-4" />
                        <AlertDescription>
                            Network connection unavailable. Sync functionality is disabled until
                            connection is restored.
                        </AlertDescription>
                    </Alert>
                )}
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

                {autoSyncEnabled && isOnline && (
                    <div
                        className="flex items-center justify-between p-3 rounded-lg border animate-in slide-in-from-top-2 duration-300"
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
                                <SelectItem value="1">
                                    <span className="flex items-center gap-2">
                                        <i className="codicon codicon-dashboard" />1 min
                                    </span>
                                </SelectItem>
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
