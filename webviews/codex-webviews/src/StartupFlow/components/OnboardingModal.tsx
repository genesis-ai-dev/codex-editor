import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui";
import { MessagesToStartupFlowProvider } from "types";

export type ProjectType = "bible" | "subtitles" | "obs" | "documents" | "other";

interface OnboardingModalProps {
    open: boolean;
    onComplete: (projectTypes: ProjectType[], skipOnboarding: boolean) => void;
    onSkip: () => void;
    vscode: any;
}

const PROJECT_TYPE_OPTIONS: Array<{
    id: ProjectType;
    label: string;
    description: string;
    icon: string;
}> = [
    {
        id: "bible",
        label: "Bible Translation",
        description: "Translate biblical texts using USFM format",
        icon: "codicon-book",
    },
    {
        id: "subtitles",
        label: "Subtitles & Captions",
        description: "Translate video subtitles and captions",
        icon: "codicon-play",
    },
    {
        id: "obs",
        label: "Open Bible Stories",
        description: "Translate Bible stories for various audiences",
        icon: "codicon-library",
    },
    {
        id: "documents",
        label: "Company Documents",
        description: "Translate business documents and content",
        icon: "codicon-file-text",
    },
    {
        id: "other",
        label: "Other",
        description: "Custom translation projects",
        icon: "codicon-symbol-variable",
    },
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
    open,
    onComplete,
    onSkip,
    vscode,
}) => {
    const [selectedTypes, setSelectedTypes] = useState<Set<ProjectType>>(new Set());
    const [skipOnboarding, setSkipOnboarding] = useState(false);

    const handleToggleType = (type: ProjectType) => {
        const newSelected = new Set(selectedTypes);
        if (newSelected.has(type)) {
            newSelected.delete(type);
        } else {
            newSelected.add(type);
        }
        setSelectedTypes(newSelected);
    };

    const handleGetStarted = () => {
        const projectTypes = Array.from(selectedTypes);
        // If no types selected, default to "other"
        const finalTypes = projectTypes.length > 0 ? projectTypes : ["other"];
        onComplete(finalTypes, skipOnboarding);
    };

    const handleSkip = () => {
        onSkip();
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleSkip()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl">Welcome to Codex Editor!</DialogTitle>
                    <DialogDescription className="text-base mt-2">
                        Let's get you started. Choose the types of projects you'll be working on,
                        and we'll create some sample files to help you understand how Codex works.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-4">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        What types of projects will you be working on?
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {PROJECT_TYPE_OPTIONS.map((option) => {
                            const isSelected = selectedTypes.has(option.id);
                            return (
                                <div
                                    key={option.id}
                                    onClick={() => handleToggleType(option.id)}
                                    className={`
                                        flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer
                                        transition-all duration-200
                                        ${
                                            isSelected
                                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                                : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                                        }
                                    `}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => handleToggleType(option.id)}
                                        className="mt-1 h-4 w-4 cursor-pointer"
                                    />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <i className={`codicon ${option.icon} text-lg`}></i>
                                            <span className="font-medium text-gray-900 dark:text-gray-100">
                                                {option.label}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            {option.description}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <input
                            type="checkbox"
                            id="skip-onboarding"
                            checked={skipOnboarding}
                            onChange={(e) => setSkipOnboarding(e.target.checked)}
                            className="h-4 w-4 cursor-pointer"
                        />
                        <label
                            htmlFor="skip-onboarding"
                            className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                        >
                            Don't show this again
                        </label>
                    </div>
                </div>

                <DialogFooter className="flex gap-2">
                    <Button variant="secondary" onClick={handleSkip}>
                        Skip and Start Blank Project
                    </Button>
                    <Button
                        onClick={handleGetStarted}
                        disabled={selectedTypes.size === 0}
                        className="min-w-[140px]"
                    >
                        Get Started
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default OnboardingModal;

