import React, { useState, useEffect } from "react";
import { WebviewApi } from "vscode-webview";
import { LanguageMetadata, LanguageProjectStatus } from "codex-types";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import { LanguagePicker } from "../../shared/components/LanguagePicker";
import { MessagesToStartupFlowProvider } from "../types";
import { Lock } from "lucide-react";

type ProjectType = "bible" | "subtitles" | "obs" | "documents" | "other";

// English language metadata for auto-selection
const ENGLISH_LANGUAGE: LanguageMetadata = {
    tag: "eng",
    name: { en: "English" },
    refName: "English",
    projectStatus: LanguageProjectStatus.SOURCE,
    iso1: "en",
    scope: "I",
    type: "L",
};

interface ProjectCreationModalProps {
    isOpen: boolean;
    onClose: () => void;
    vscode: WebviewApi<any>;
    mode: "generate" | "upload";
}

export const ProjectCreationModal: React.FC<ProjectCreationModalProps> = ({
    isOpen,
    onClose,
    vscode,
    mode,
}) => {
    // Form state
    const [projectName, setProjectName] = useState("");
    const [projectType, setProjectType] = useState<ProjectType | "">("");
    const [sourceLanguage, setSourceLanguage] = useState<LanguageMetadata | null>(null);
    const [targetLanguage, setTargetLanguage] = useState<LanguageMetadata | null>(null);

    // Validation state
    const [touched, setTouched] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);

    // Auto-select Bible and English when mode is "generate"
    useEffect(() => {
        if (mode === "generate") {
            setProjectType("bible");
            setSourceLanguage(ENGLISH_LANGUAGE);
        }
    }, [mode]);

    // Reset form when modal closes
    useEffect(() => {
        if (!isOpen) {
            setProjectName("");
            setProjectType(mode === "generate" ? "bible" : "");
            setSourceLanguage(mode === "generate" ? ENGLISH_LANGUAGE : null);
            setTargetLanguage(null);
            setTouched(false);
            setNameError(null);
        }
    }, [isOpen, mode]);

    // Validate project name
    useEffect(() => {
        if (!touched) return;

        const trimmedName = projectName.trim();
        if (trimmedName.length === 0) {
            setNameError("Project name is required");
        } else if (trimmedName.length > 256) {
            setNameError("Project name must be 256 characters or less");
        } else {
            setNameError(null);
        }
    }, [projectName, touched]);

    // Check if form is valid
    const isFormValid = (): boolean => {
        const trimmedName = projectName.trim();
        const hasValidName = trimmedName.length > 0 && trimmedName.length <= 256;

        if (!hasValidName) {
            return false;
        }

        // For generate mode, only need name and target language
        // (project type and source language are auto-filled)
        if (mode === "generate") {
            return targetLanguage !== null;
        }

        // For upload mode, need all fields
        return (
            projectType !== "" &&
            sourceLanguage !== null &&
            targetLanguage !== null
        );
    };

    const handleSubmit = () => {
        if (!isFormValid()) return;

        const trimmedName = projectName.trim();

        if (mode === "generate") {
            vscode.postMessage({
                command: "project.createWithSamples",
                projectName: trimmedName,
                projectType: projectType as ProjectType,  // Will always be "bible"
                sourceLanguage: sourceLanguage!,          // Will always be English
                targetLanguage: targetLanguage!,
            } as MessagesToStartupFlowProvider);
        } else {
            vscode.postMessage({
                command: "project.createForUpload",
                projectName: trimmedName,
                projectType: projectType as ProjectType,
                sourceLanguage: sourceLanguage!,
                targetLanguage: targetLanguage!,
            } as MessagesToStartupFlowProvider);
        }

        // Modal will close when we receive confirmation from provider
    };

    const getProjectTypeDescription = (type: ProjectType): string => {
        switch (type) {
            case "bible":
                return "Sample Bible text with source and target translations";
            case "subtitles":
                return "Sample subtitle file for video translation";
            case "obs":
                return "Sample Open Bible Stories content";
            case "documents":
                return "Sample document for general translation";
            case "other":
                return "Basic project structure without specific samples";
            default:
                return "";
        }
    };

    const handleLanguageSelect = (language: LanguageMetadata) => {
        if (language.projectStatus === "source") {
            setSourceLanguage(language);
        } else {
            setTargetLanguage(language);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Create New Project</DialogTitle>
                    <DialogDescription>
                        Configure your translation project settings
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Project Name */}
                    <div className="space-y-2">
                        <Label htmlFor="project-name">
                            Project Name <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="project-name"
                            placeholder="Enter project name"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            onBlur={() => setTouched(true)}
                            className={nameError ? "border-red-500" : ""}
                        />
                        {nameError && touched && (
                            <p className="text-sm text-red-500">{nameError}</p>
                        )}
                    </div>

                    {/* Project Type */}
                    <div className="space-y-2">
                        <Label htmlFor="project-type" className="flex items-center gap-2">
                            <span>
                                Project Type <span className="text-red-500">*</span>
                            </span>
                            {mode === "generate" && (
                                <Lock className="h-3 w-3 text-muted-foreground" />
                            )}
                        </Label>
                        <Select
                            value={projectType}
                            onValueChange={(value) => setProjectType(value as ProjectType)}
                            disabled={mode === "generate"}
                        >
                            <SelectTrigger id="project-type" className={mode === "generate" ? "opacity-60 cursor-not-allowed" : ""}>
                                <SelectValue placeholder="Select project type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="bible">Bible Translation</SelectItem>
                                <SelectItem value="subtitles">Subtitles Translation</SelectItem>
                                <SelectItem value="obs">Open Bible Stories</SelectItem>
                                <SelectItem value="documents">Document Translation</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Source Language */}
                    <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                            <span>
                                Source Language <span className="text-red-500">*</span>
                            </span>
                            {mode === "generate" && (
                                <Lock
                                    className="h-3 w-3 text-muted-foreground"
                                    title="Locked to English for sample projects"
                                />
                            )}
                        </Label>
                        {mode === "generate" ? (
                            <div className="flex items-center h-10 px-3 py-2 border border-input bg-background rounded-md opacity-60 cursor-not-allowed text-sm">
                                English
                            </div>
                        ) : (
                            <LanguagePicker
                                onLanguageSelect={handleLanguageSelect}
                                projectStatus="source"
                                label="Select Source Language"
                                initialLanguage={sourceLanguage || undefined}
                            />
                        )}
                    </div>

                    {/* Target Language */}
                    <div className="space-y-2">
                        <Label>
                            Target Language <span className="text-red-500">*</span>
                        </Label>
                        <LanguagePicker
                            onLanguageSelect={handleLanguageSelect}
                            projectStatus="target"
                            label="Select Target Language"
                            initialLanguage={targetLanguage || undefined}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!isFormValid()}>
                        Get Started
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
