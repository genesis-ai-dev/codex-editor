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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../components/ui/select";
import { Label } from "../../components/ui/label";
import { LanguagePicker } from "../../shared/components/LanguagePicker";
import { MessagesToStartupFlowProvider } from "types";

type ProjectType = "bible" | "subtitles" | "obs" | "documents" | "dubbing" | "audioTranslation" | "audiobibleTranslation" | "other";

interface ProjectCreationModalProps {
    open: boolean;
    onClose: () => void;
    vscode: WebviewApi<any>;
}

export const ProjectCreationModal: React.FC<ProjectCreationModalProps> = ({
    open,
    onClose,
    vscode,
}) => {
    const [projectName, setProjectName] = useState("");
    const [projectType, setProjectType] = useState<ProjectType | "">("");
    const [sourceLanguage, setSourceLanguage] = useState<LanguageMetadata | null>(null);
    const [targetLanguage, setTargetLanguage] = useState<LanguageMetadata | null>(null);
    const [touched, setTouched] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);

    // Reset form when modal closes
    useEffect(() => {
        if (!open) {
            setProjectName("");
            setProjectType("");
            setSourceLanguage(null);
            setTargetLanguage(null);
            setTouched(false);
            setNameError(null);
        }
    }, [open]);

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

    const isFormValid = (): boolean => {
        const trimmedName = projectName.trim();
        return (
            trimmedName.length > 0 &&
            trimmedName.length <= 256 &&
            projectType !== "" &&
            sourceLanguage !== null &&
            targetLanguage !== null
        );
    };

    const handleSubmit = () => {
        if (!isFormValid()) return;
        vscode.postMessage({
            command: "project.createForUpload",
            projectName: projectName.trim(),
            projectType: projectType as ProjectType,
            sourceLanguage: sourceLanguage!,
            targetLanguage: targetLanguage!,
        } as MessagesToStartupFlowProvider);
    };

    const handleLanguageSelect = (language: LanguageMetadata) => {
        if (language.projectStatus === "source") {
            setSourceLanguage(language);
        } else {
            setTargetLanguage(language);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
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
                        <Label htmlFor="project-type">
                            Project Type <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={projectType}
                            onValueChange={(value) => setProjectType(value as ProjectType)}
                        >
                            <SelectTrigger id="project-type">
                                <SelectValue placeholder="Select project type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="bible">Bible Translation</SelectItem>
                                <SelectItem value="subtitles">Subtitles Translation</SelectItem>
                                <SelectItem value="obs">Open Bible Stories</SelectItem>
                                <SelectItem value="documents">Document Translation</SelectItem>
                                <SelectItem value="dubbing">Dubbing</SelectItem>
                                <SelectItem value="audioTranslation">Audio Translation</SelectItem>
                                <SelectItem value="audiobibleTranslation">Audiobible Translation</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Source Language */}
                    <div className="space-y-2">
                        <Label>
                            Source Language <span className="text-red-500">*</span>
                        </Label>
                        <LanguagePicker
                            onLanguageSelect={handleLanguageSelect}
                            projectStatus="source"
                            label="Select Source Language"
                            initialLanguage={sourceLanguage || undefined}
                        />
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
                    <Button onClick={handleSubmit} disabled={!isFormValid()} title="Upload Sources">
                        Get Started
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
