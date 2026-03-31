import React, { useState, useEffect } from "react";
import { WebviewApi } from "vscode-webview";
import { LanguageMetadata } from "codex-types";
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
import { Label } from "../../components/ui/label";
import { LanguagePicker } from "../../shared/components/LanguagePicker";
import { MessagesToStartupFlowProvider } from "types";

interface ProjectCreationModalProps {
    open: boolean;
    onClose: () => void;
    vscode: WebviewApi<any>;
    recoveryMode?: boolean;
    defaultProjectName?: string;
}

export const ProjectCreationModal: React.FC<ProjectCreationModalProps> = ({
    open,
    onClose,
    vscode,
    recoveryMode = false,
    defaultProjectName = "",
}) => {
    const [projectName, setProjectName] = useState(defaultProjectName);
    const [sourceLanguage, setSourceLanguage] = useState<LanguageMetadata | null>(null);
    const [targetLanguage, setTargetLanguage] = useState<LanguageMetadata | null>(null);
    const [touched, setTouched] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);
    const [activePicker, setActivePicker] = useState<"source" | "target" | "projectType" | null>(null);

    useEffect(() => {
        if (!open) {
            if (!recoveryMode) {
                setProjectName("");
            }
            setSourceLanguage(null);
            setTargetLanguage(null);
            setTouched(false);
            setNameError(null);
            setActivePicker(null);
        }
    }, [open, recoveryMode]);

    useEffect(() => {
        if (recoveryMode && defaultProjectName) {
            setProjectName(defaultProjectName);
        }
    }, [recoveryMode, defaultProjectName]);

    useEffect(() => {
        if (!touched || recoveryMode) return;
        const trimmedName = projectName.trim();
        if (trimmedName.length === 0) {
            setNameError("Project name is required");
        } else if (trimmedName.length > 256) {
            setNameError("Project name must be 256 characters or less");
        } else {
            setNameError(null);
        }
    }, [projectName, touched, recoveryMode]);

    const isFormValid = (): boolean => {
        if (recoveryMode) {
            return sourceLanguage !== null && targetLanguage !== null;
        }
        const trimmedName = projectName.trim();
        return (
            trimmedName.length > 0 &&
            trimmedName.length <= 256 &&
            sourceLanguage !== null &&
            targetLanguage !== null
        );
    };

    const handleSubmit = () => {
        if (!isFormValid()) return;
        if (recoveryMode) {
            vscode.postMessage({
                command: "project.initializeWithLanguages",
                sourceLanguage: sourceLanguage!,
                targetLanguage: targetLanguage!,
            } as MessagesToStartupFlowProvider);
        } else {
            vscode.postMessage({
                command: "project.createForUpload",
                projectName: projectName.trim(),
                sourceLanguage: sourceLanguage!,
                targetLanguage: targetLanguage!,
            } as MessagesToStartupFlowProvider);
        }
    };

    const handleLanguageSelect = (language: LanguageMetadata) => {
        if (language.projectStatus === "source") {
            setSourceLanguage(language);
        } else {
            setTargetLanguage(language);
        }
    };

    const title = recoveryMode ? "Restore Project Settings" : "Create New Project";
    const description = recoveryMode
        ? "Your project is missing its configuration. Please select your languages to restore it."
        : "Configure your translation project settings";
    const submitLabel = recoveryMode ? "Restore Project" : "Get Started";

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent
                className="max-w-2xl overflow-visible"
                onEscapeKeyDown={(e) => {
                    if (document.querySelector(".language-picker__dropdown")) {
                        e.preventDefault();
                    }
                }}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="project-name">
                            Project Name {!recoveryMode && <span className="text-red-500">*</span>}
                        </Label>
                        <Input
                            id="project-name"
                            placeholder="Enter project name"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            onBlur={() => setTouched(true)}
                            disabled={recoveryMode}
                            className={nameError ? "border-red-500" : recoveryMode ? "opacity-60" : ""}
                        />
                        {nameError && touched && (
                            <p className="text-sm text-red-500">{nameError}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>
                            Source Language <span className="text-red-500">*</span>
                        </Label>
                        <LanguagePicker
                            onLanguageSelect={handleLanguageSelect}
                            projectStatus="source"
                            label="Select Source Language"
                            initialLanguage={sourceLanguage || undefined}
                            isActive={activePicker === "source"}
                            onActivate={() => setActivePicker("source")}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>
                            Target Language <span className="text-red-500">*</span>
                        </Label>
                        <LanguagePicker
                            onLanguageSelect={handleLanguageSelect}
                            projectStatus="target"
                            label="Select Target Language"
                            initialLanguage={targetLanguage || undefined}
                            isActive={activePicker === "target"}
                            onActivate={() => setActivePicker("target")}
                        />
                    </div>
                </div>

                <DialogFooter>
                    {!recoveryMode && (
                        <Button variant="ghost" onClick={onClose}>
                            Cancel
                        </Button>
                    )}
                    <Button onClick={handleSubmit} disabled={!isFormValid()}>
                        {submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
