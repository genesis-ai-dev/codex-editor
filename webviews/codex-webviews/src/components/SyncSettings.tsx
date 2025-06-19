import React from "react";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface SyncSettingsProps {
    autoSyncEnabled: boolean;
    syncDelayMinutes: number;
    onToggleAutoSync: (enabled: boolean) => void;
    onChangeSyncDelay: (minutes: number) => void;
    onTriggerSync: () => void;
}

export const SyncSettings: React.FC<SyncSettingsProps> = ({
    autoSyncEnabled,
    syncDelayMinutes,
    onToggleAutoSync,
    onChangeSyncDelay,
    onTriggerSync,
}) => {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-sm font-medium">Sync Settings</CardTitle>
                <Button onClick={onTriggerSync} size="sm" variant="outline">
                    <i className="codicon codicon-sync mr-2 h-4 w-4" />
                    Sync Now
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <label className="text-sm font-medium">Auto-sync changes</label>
                        <p className="text-xs text-muted-foreground">
                            Automatically sync your changes to the cloud
                        </p>
                    </div>
                    <Switch checked={autoSyncEnabled} onCheckedChange={onToggleAutoSync} />
                </div>

                {autoSyncEnabled && (
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <label className="text-sm font-medium">Sync interval</label>
                            <p className="text-xs text-muted-foreground">
                                How often to sync your changes
                            </p>
                        </div>
                        <Select
                            value={syncDelayMinutes.toString()}
                            onValueChange={(value) => onChangeSyncDelay(parseInt(value, 10))}
                        >
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">1 minute</SelectItem>
                                <SelectItem value="5">5 minutes</SelectItem>
                                <SelectItem value="15">15 minutes</SelectItem>
                                <SelectItem value="30">30 minutes</SelectItem>
                                <SelectItem value="60">60 minutes</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
