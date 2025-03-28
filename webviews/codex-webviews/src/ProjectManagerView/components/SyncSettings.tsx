import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";

interface SyncSettingsProps {
    autoSyncEnabled: boolean;
    syncDelayMinutes: number;
    onToggleAutoSync: (enabled: boolean) => void;
    onChangeSyncDelay: (minutes: number) => void;
    onTriggerSync: () => void;
}

const SyncSettings: React.FC<SyncSettingsProps> = ({
    autoSyncEnabled,
    syncDelayMinutes,
    onToggleAutoSync,
    onChangeSyncDelay,
    onTriggerSync,
}) => {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                padding: "0.75rem",
                backgroundColor: "var(--vscode-list-hoverBackground)",
                borderRadius: "4px",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <div style={{ fontWeight: "bold" }}>Sync Settings</div>
                <VSCodeButton onClick={onTriggerSync}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                        }}
                    >
                        <i className="codicon codicon-sync"></i> Sync Now
                    </div>
                </VSCodeButton>
            </div>

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <div>Auto-sync changes</div>
                <div className="switch-container">
                    <label className="switch">
                        <input
                            type="checkbox"
                            checked={autoSyncEnabled}
                            onChange={(e) => onToggleAutoSync(e.target.checked)}
                        />
                        <span className="slider round"></span>
                    </label>
                </div>
            </div>

            {autoSyncEnabled && (
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <div>Sync interval</div>
                    <VSCodeDropdown
                        value={syncDelayMinutes.toString()}
                        onChange={(e) => {
                            // Type assertion to handle the VSCode dropdown event
                            const target = e.target as HTMLSelectElement;
                            if (target && target.value) {
                                onChangeSyncDelay(parseInt(target.value, 10));
                            }
                        }}
                        style={{ width: "150px" }}
                    >
                        <VSCodeOption value="1">1 minute</VSCodeOption>
                        <VSCodeOption value="5">5 minutes</VSCodeOption>
                        <VSCodeOption value="15">15 minutes</VSCodeOption>
                        <VSCodeOption value="30">30 minutes</VSCodeOption>
                        <VSCodeOption value="60">60 minutes</VSCodeOption>
                    </VSCodeDropdown>
                </div>
            )}
        </div>
    );
};

export default SyncSettings;
