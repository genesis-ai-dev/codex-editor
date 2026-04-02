import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { WebviewHeader } from "../components/WebviewHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import "../tailwind.css";

function getVSCodeAPI() {
    const w = window as unknown as { __vscodeApi?: ReturnType<typeof acquireVsCodeApi> };
    if (w.__vscodeApi) return w.__vscodeApi;
    const api = acquireVsCodeApi();
    w.__vscodeApi = api;
    return api;
}

interface TextDisplaySettings {
    fileScope: "source" | "target" | "both";
    updateBehavior: "all" | "skip";
    fontSize?: number;
    enableLineNumbers?: boolean;
    textDirection?: "ltr" | "rtl";
}

const fontSizeOptions = [
    { label: "8px", value: 8 },
    { label: "9px", value: 9 },
    { label: "10px", value: 10 },
    { label: "11px", value: 11 },
    { label: "12px", value: 12 },
    { label: "14px (Default)", value: 14 },
    { label: "18px", value: 18 },
    { label: "24px", value: 24 },
];

function InterfaceSettingsApp() {
    const vscode = getVSCodeAPI();

    // Text Display Settings state
    const [fileScope, setFileScope] = useState<"source" | "target" | "both">("both");
    const [updateBehavior, setUpdateBehavior] = useState<"all" | "skip">("all");
    const [fontSize, setFontSize] = useState<number | undefined>(14);
    const [enableLineNumbers, setEnableLineNumbers] = useState<boolean | undefined>(true);
    const [textDirection, setTextDirection] = useState<"ltr" | "rtl" | undefined>("ltr");
    const [enableFontSize, setEnableFontSize] = useState(false);
    const [enableLineNumbersToggle, setEnableLineNumbersToggle] = useState(false);
    const [enableTextDirection, setEnableTextDirection] = useState(false);

    // Search Settings state
    const [highlightSearchResults, setHighlightSearchResults] = useState(true);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "init") {
                if (typeof message.data?.highlightSearchResults === "boolean") {
                    setHighlightSearchResults(message.data.highlightSearchResults);
                }
            }
        };
        window.addEventListener("message", handler);
        vscode.postMessage({ command: "webviewReady" });
        return () => window.removeEventListener("message", handler);
    }, [vscode]);

    const hasSelectedTextSettings = enableFontSize || enableLineNumbersToggle || enableTextDirection;

    const handleApplyTextDisplay = () => {
        const settings: TextDisplaySettings = {
            fileScope,
            updateBehavior,
            ...(enableFontSize && fontSize !== undefined && { fontSize }),
            ...(enableLineNumbersToggle && enableLineNumbers !== undefined && { enableLineNumbers }),
            ...(enableTextDirection && textDirection !== undefined && { textDirection }),
        };
        vscode.postMessage({ command: "applyTextDisplaySettings", data: settings });
    };

    const handleToggleHighlightSearch = (checked: boolean) => {
        setHighlightSearchResults(checked);
        vscode.postMessage({ command: "updateHighlightSearchResults", value: checked });
    };

    return (
        <div style={{ padding: 12 }}>
            <WebviewHeader title="Interface Settings" showBackButton={false} />

            <div className="space-y-8">
                {/* Text Display Settings Section */}
                <div className="border rounded p-4">
                    <div className="font-medium mb-4 flex items-center gap-2">
                        <i className="codicon codicon-text-size" style={{ color: "var(--ring)" }} />
                        Text Display Settings
                    </div>

                    <div className="space-y-5">
                        {/* File Scope */}
                        <div className="space-y-1">
                            <div className="font-medium">File Scope</div>
                            <div className="text-sm opacity-70 mb-2">
                                Which files to apply display settings to
                            </div>
                            <Select
                                value={fileScope}
                                onValueChange={(value) =>
                                    setFileScope(value as "source" | "target" | "both")
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="source">Source files only</SelectItem>
                                    <SelectItem value="target">Target files only</SelectItem>
                                    <SelectItem value="both">
                                        Both source and target files
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Update Behavior */}
                        <div className="space-y-1">
                            <div className="font-medium">Update Behavior</div>
                            <div className="text-sm opacity-70 mb-2">
                                How to handle files with existing local settings
                            </div>
                            <Select
                                value={updateBehavior}
                                onValueChange={(value) =>
                                    setUpdateBehavior(value as "all" | "skip")
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Update all files</SelectItem>
                                    <SelectItem value="skip">
                                        Skip files that already have local settings
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Font Size */}
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">Font Size</div>
                                <div className="text-sm opacity-70">
                                    Text size in pixels
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {enableFontSize && (
                                    <Select
                                        value={fontSize?.toString()}
                                        onValueChange={(value) =>
                                            setFontSize(parseInt(value, 10))
                                        }
                                    >
                                        <SelectTrigger className="w-32">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {fontSizeOptions.map((option) => (
                                                <SelectItem
                                                    key={option.value}
                                                    value={option.value.toString()}
                                                >
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                <Switch
                                    checked={enableFontSize}
                                    onCheckedChange={setEnableFontSize}
                                />
                            </div>
                        </div>

                        {/* Line Numbers */}
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">Line Numbers</div>
                                <div className="text-sm opacity-70">
                                    Show or hide line numbers
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {enableLineNumbersToggle && (
                                    <Select
                                        value={enableLineNumbers ? "true" : "false"}
                                        onValueChange={(value) =>
                                            setEnableLineNumbers(value === "true")
                                        }
                                    >
                                        <SelectTrigger className="w-32">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="true">Enable</SelectItem>
                                            <SelectItem value="false">Disable</SelectItem>
                                        </SelectContent>
                                    </Select>
                                )}
                                <Switch
                                    checked={enableLineNumbersToggle}
                                    onCheckedChange={setEnableLineNumbersToggle}
                                />
                            </div>
                        </div>

                        {/* Text Direction */}
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">Text Direction</div>
                                <div className="text-sm opacity-70">
                                    Reading direction for content
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {enableTextDirection && (
                                    <Select
                                        value={textDirection}
                                        onValueChange={(value) =>
                                            setTextDirection(value as "ltr" | "rtl")
                                        }
                                    >
                                        <SelectTrigger className="w-32">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ltr">
                                                LTR &rarr;
                                            </SelectItem>
                                            <SelectItem value="rtl">
                                                &larr; RTL
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                )}
                                <Switch
                                    checked={enableTextDirection}
                                    onCheckedChange={setEnableTextDirection}
                                />
                            </div>
                        </div>

                        {/* Apply Button */}
                        <div className="flex justify-end pt-2">
                            <Button
                                onClick={handleApplyTextDisplay}
                                disabled={!hasSelectedTextSettings}
                                size="sm"
                            >
                                Apply Changes
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Search Settings Section */}
                <div className="border rounded p-4">
                    <div className="font-medium mb-4 flex items-center gap-2">
                        <i className="codicon codicon-eye" style={{ color: "var(--ring)" }} />
                        Search Settings
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium">
                                Highlight Search Results in Panel
                            </div>
                            <div className="text-sm opacity-70">
                                Highlight matching text in search results within the parallel
                                passages panel
                            </div>
                        </div>
                        <Switch
                            checked={highlightSearchResults}
                            onCheckedChange={handleToggleHighlightSearch}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<InterfaceSettingsApp />);
