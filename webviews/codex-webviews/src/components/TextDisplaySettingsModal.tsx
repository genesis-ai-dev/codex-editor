import React, { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";

interface TextDisplaySettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (settings: TextDisplaySettings) => void;
}

export interface TextDisplaySettings {
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
    { label: "24px", value: 24 }
];

export const TextDisplaySettingsModal: React.FC<TextDisplaySettingsModalProps> = ({
    isOpen,
    onClose,
    onApply,
}) => {
    const [fileScope, setFileScope] = useState<"source" | "target" | "both">("both");
    const [updateBehavior, setUpdateBehavior] = useState<"all" | "skip">("all");
    const [fontSize, setFontSize] = useState<number | undefined>(14);
    const [enableLineNumbers, setEnableLineNumbers] = useState<boolean | undefined>(true);
    const [textDirection, setTextDirection] = useState<"ltr" | "rtl" | undefined>("ltr");
    const [enableFontSize, setEnableFontSize] = useState(false);
    const [enableLineNumbersToggle, setEnableLineNumbersToggle] = useState(false);
    const [enableTextDirection, setEnableTextDirection] = useState(false);

    const handleApply = () => {
        const settings: TextDisplaySettings = {
            fileScope,
            updateBehavior,
            ...(enableFontSize && fontSize !== undefined && { fontSize }),
            ...(enableLineNumbersToggle && enableLineNumbers !== undefined && { enableLineNumbers }),
            ...(enableTextDirection && textDirection !== undefined && { textDirection }),
        };

        onApply(settings);
        onClose();
    };

    const hasSelectedSettings = enableFontSize || enableLineNumbersToggle || enableTextDirection;

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 flex items-center justify-center z-50"
            style={{
                backgroundColor: "rgba(0, 0, 0, 0.5)"
            }}
        >
            <Card 
                className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
                style={{
                    backgroundColor: "var(--card)",
                    borderColor: "var(--border)",
                }}
            >
                <CardHeader className="pb-4">
                    <CardTitle 
                        className="text-lg font-semibold flex items-center gap-2"
                        style={{ color: "var(--foreground)" }}
                    >
                        <i 
                            className="codicon codicon-text-size text-xl"
                            style={{ color: "var(--ring)" }}
                        />
                        Text Display Settings
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* File Scope Selection */}
                    <div className="space-y-3">
                        <Label 
                            className="text-sm font-semibold space-y-3 mt-3"
                            style={{ color: "var(--foreground)" }}
                        >
                            File Scope
                        </Label>
                        <Select
                            value={fileScope}
                            onValueChange={(value) => setFileScope(value as "source" | "target" | "both")}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="source">Source files only</SelectItem>
                                <SelectItem value="target">Target files only</SelectItem>
                                <SelectItem value="both">Both source and target files</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Separator />

                    {/* Update Behavior */}
                    <div className="space-y-3">
                        <Label 
                            className="text-sm font-semibold"
                            style={{ color: "var(--foreground)" }}
                        >
                            Update Behavior
                        </Label>
                        <Select
                            value={updateBehavior}
                            onValueChange={(value) => setUpdateBehavior(value as "all" | "skip")}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Update all files</SelectItem>
                                <SelectItem value="skip">Skip files that already have local settings</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Separator />

                    {/* Settings */}
                    <div className="space-y-4">
                        <Label 
                            className="text-sm font-semibold"
                            style={{ color: "var(--foreground)" }}
                        >
                            Settings to Apply
                        </Label>

                        {/* Font Size */}
                        <div 
                            className="flex items-center justify-between p-3 rounded-lg border"
                            style={{
                                backgroundColor: "var(--muted)",
                                borderColor: "var(--border)",
                            }}
                        >
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={enableFontSize}
                                        onCheckedChange={setEnableFontSize}
                                        className="shadow-sm border border-border/20"
                                    />
                                    <Label 
                                        className="text-sm font-medium"
                                        style={{ color: "var(--foreground)" }}
                                    >
                                        Font Size
                                    </Label>
                                </div>
                                <p 
                                    className="text-xs"
                                    style={{ color: "var(--muted-foreground)" }}
                                >
                                    Text size in pixels
                                </p>
                            </div>
                            {enableFontSize && (
                                <Select
                                    value={fontSize?.toString()}
                                    onValueChange={(value) => setFontSize(parseInt(value, 10))}
                                >
                                    <SelectTrigger className="w-32">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {fontSizeOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value.toString()}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {/* Line Numbers */}
                        <div 
                            className="flex items-center justify-between p-3 rounded-lg border"
                            style={{
                                backgroundColor: "var(--muted)",
                                borderColor: "var(--border)",
                            }}
                        >
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={enableLineNumbersToggle}
                                        onCheckedChange={setEnableLineNumbersToggle}
                                        className="shadow-sm border border-border/20"
                                    />
                                    <Label 
                                        className="text-sm font-medium"
                                        style={{ color: "var(--foreground)" }}
                                    >
                                        Line Numbers
                                    </Label>
                                </div>
                                <p 
                                    className="text-xs"
                                    style={{ color: "var(--muted-foreground)" }}
                                >
                                    Show or hide line numbers
                                </p>
                            </div>
                            {enableLineNumbersToggle && (
                                <Select
                                    value={enableLineNumbers ? "true" : "false"}
                                    onValueChange={(value) => setEnableLineNumbers(value === "true")}
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
                        </div>

                        {/* Text Direction */}
                        <div 
                            className="flex items-center justify-between p-3 rounded-lg border"
                            style={{
                                backgroundColor: "var(--muted)",
                                borderColor: "var(--border)",
                            }}
                        >
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={enableTextDirection}
                                        onCheckedChange={setEnableTextDirection}
                                        className="shadow-sm border border-border/20"
                                    />
                                    <Label 
                                        className="text-sm font-medium"
                                        style={{ color: "var(--foreground)" }}
                                    >
                                        Text Direction
                                    </Label>
                                </div>
                                <p 
                                    className="text-xs"
                                    style={{ color: "var(--muted-foreground)" }}
                                >
                                    Reading direction for content
                                </p>
                            </div>
                            {enableTextDirection && (
                                <Select
                                    value={textDirection}
                                    onValueChange={(value) => setTextDirection(value as "ltr" | "rtl")}
                                >
                                    <SelectTrigger className="w-32">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ltr">LTR <span>→</span></SelectItem>
                                        <SelectItem value="rtl"><span>←</span> RTL</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-3 pt-4">
                        <Button
                            variant="outline"
                            onClick={onClose}
                            className="button-outline"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleApply}
                            disabled={!hasSelectedSettings}
                            className="button-primary"
                        >
                            Apply Changes
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};