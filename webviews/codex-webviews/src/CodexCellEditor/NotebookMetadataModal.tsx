import React, { useState } from "react";
import { CustomNotebookMetadata } from "../../../../types";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { Separator } from "../components/ui/separator";
import { Badge } from "../components/ui/badge";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface NotebookMetadataModalProps {
    isOpen: boolean;
    onClose: () => void;
    metadata: CustomNotebookMetadata;
    onMetadataChange: (key: string, value: string) => void;
    onSave: () => void;
    onPickFile: () => void;
    tempVideoUrl: string;
}

// Define user-editable fields with proper labels and descriptions
const USER_EDITABLE_FIELDS = {
    videoUrl: {
        label: "Video URL",
        description: "Link to video file for this chapter",
        type: "url" as const,
        hasFilePicker: true,
    },
    textDirection: {
        label: "Text Direction",
        description: "Reading direction for this content",
        type: "select" as const,
        options: [
            { value: "ltr", label: "Left to Right" },
            { value: "rtl", label: "Right to Left" },
        ],
    },
    fontSize: {
        label: "Font Size",
        description: "Text size in pixels",
        type: "number" as const,
        min: 8,
        max: 24,
    },
    corpusMarker: {
        label: "Corpus Marker",
        description: "Identifier for this text corpus",
        type: "text" as const,
    },
} as const;

const NotebookMetadataModal: React.FC<NotebookMetadataModalProps> = ({
    isOpen,
    onClose,
    metadata,
    onMetadataChange,
    onSave,
    onPickFile,
    tempVideoUrl,
}) => {
    const [hasChanges, setHasChanges] = useState(false);

    const handleFieldChange = (key: string, value: string) => {
        setHasChanges(true);
        onMetadataChange(key, value);
    };

    const handleSave = () => {
        onSave();
        setHasChanges(false);
    };

    const handleClose = () => {
        onClose();
        setHasChanges(false);
    };

    const renderField = (key: string, config: typeof USER_EDITABLE_FIELDS[keyof typeof USER_EDITABLE_FIELDS]) => {
        const currentValue = key === "videoUrl" && tempVideoUrl ? tempVideoUrl : (metadata[key as keyof CustomNotebookMetadata] || "");
        
        return (
            <div key={key} className="space-y-2">
                <div className="flex items-center gap-2">
                    <Label htmlFor={key} className="text-sm font-medium">
                        {config.label}
                    </Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button className="text-muted-foreground hover:text-foreground">
                                    <i className="codicon codicon-info" style={{ fontSize: '12px' }} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-xs">{config.description}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                
                {config.type === "select" && config.options ? (
                    <Select 
                        value={String(currentValue)} 
                        onValueChange={(value) => handleFieldChange(key, value)}
                    >
                        <SelectTrigger id={key}>
                            <SelectValue placeholder={`Select ${config.label.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                            {config.options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : config.type === "url" && config.hasFilePicker ? (
                    <div className="flex gap-2">
                        <Input
                            id={key}
                            type="url"
                            value={String(currentValue)}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
                            placeholder="Enter video URL or use file picker"
                            className="flex-1"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={onPickFile}
                            title="Pick Video File"
                        >
                            <i className="codicon codicon-folder-opened" />
                        </Button>
                    </div>
                ) : config.type === "number" ? (
                    <Input
                        id={key}
                        type="number"
                        value={String(currentValue)}
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        min={config.min}
                        max={config.max}
                        placeholder={`Enter ${config.label.toLowerCase()}`}
                    />
                ) : (
                    <Input
                        id={key}
                        type="text"
                        value={String(currentValue)}
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        placeholder={`Enter ${config.label.toLowerCase()}`}
                    />
                )}
            </div>
        );
    };

    // Get technical/other fields for display in "Other" section
    const otherFields = Object.entries(metadata)
        .filter(([key]) => {
            // Include technical fields that users might want to see but not edit
            const otherFields = [
                'textDirectionSource', 'lineNumbersEnabled', 'lineNumbersEnabledSource',
                'validationMigrationComplete'
            ];
            return otherFields.includes(key);
        })
        .filter(([_, value]) => value !== undefined && value !== null);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <i className="codicon codicon-notebook" />
                        Edit Metadata
                    </DialogTitle>
                </DialogHeader>
                
                <div className="space-y-6">
                    {/* User-Editable Fields */}
                    <div className="space-y-4">
                        {Object.entries(USER_EDITABLE_FIELDS).map(([key, config]) => 
                            renderField(key, config)
                        )}
                    </div>


                    {/* System Info (Read-only) */}
                    <>
                        <Separator />
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-muted-foreground">System Information</h3>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                    <span className="text-muted-foreground">ID:</span>
                                    <span className="ml-2 font-mono">{metadata.id}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Original Name:</span>
                                    <span className="ml-2">{metadata.originalName}</span>
                                </div>
                                {metadata.sourceCreatedAt && (
                                    <div>
                                        <span className="text-muted-foreground">Source Created:</span>
                                        <span className="ml-2">
                                            {new Date(metadata.sourceCreatedAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                )}
                                {metadata.codexLastModified && (
                                    <div>
                                        <span className="text-muted-foreground">Last Modified:</span>
                                        <span className="ml-2">
                                            {new Date(metadata.codexLastModified).toLocaleDateString()}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                    </>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!hasChanges}>
                        <i className="codicon codicon-save mr-2" />
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NotebookMetadataModal;
