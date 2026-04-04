import React, { useState, useEffect } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { CheckCircle2, Loader2, ArrowRight, FileText } from "lucide-react";

interface ImportProgressViewProps {
    stage: string;
    detail?: string;
    count: number;
    importName: string;
    isComplete: boolean;
    onStartTranslating: () => void;
    onImportMore: () => void;
    sourceFileCount: number;
}

const STAGE_STEPS = [
    { key: "preparing", label: "Preparing files" },
    { key: "creating", label: "Creating notebooks" },
    { key: "metadata", label: "Finishing setup" },
    { key: "processing", label: "Processing imported files" },
    { key: "indexing", label: "AI learning content" },
    { key: "complete", label: "Import complete" },
];

const getStageIndex = (stage: string): number => {
    if (stage.includes("complete") || stage.includes("success")) return 5;
    if (stage.includes("index") || stage.includes("learning")) return 4;
    if (stage.includes("processing") || stage.includes("process")) return 3;
    if (stage.includes("metadata") || stage.includes("finaliz")) return 2;
    if (stage.includes("creating") || stage.includes("notebook")) return 1;
    return 0;
};

export const ImportProgressView: React.FC<ImportProgressViewProps> = ({
    stage,
    detail,
    count,
    importName,
    isComplete,
    onStartTranslating,
    onImportMore,
    sourceFileCount,
}) => {
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        if (isComplete) {
            const timer = setTimeout(() => setShowSuccess(true), 300);
            return () => clearTimeout(timer);
        }
    }, [isComplete]);

    const currentStageIndex = isComplete ? STAGE_STEPS.length - 1 : getStageIndex(stage);
    const notebooksText = count === 1 ? "notebook" : "notebooks";

    return (
        <div className="container mx-auto p-6 max-w-2xl">
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                {/* Icon */}
                <div className="mb-8">
                    {isComplete ? (
                        <div className={`transition-all duration-500 ${showSuccess ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}>
                            <div className="p-4 rounded-full bg-green-100 dark:bg-green-900/30">
                                <CheckCircle2 className="h-16 w-16 text-green-600 dark:text-green-400" />
                            </div>
                        </div>
                    ) : (
                        <div className="p-4 rounded-full bg-blue-100 dark:bg-blue-900/30">
                            <Loader2 className="h-16 w-16 text-blue-600 dark:text-blue-400 animate-spin" />
                        </div>
                    )}
                </div>

                {/* Title */}
                <h1 className="text-3xl font-bold mb-2 text-center">
                    {isComplete
                        ? count === 1
                            ? `Successfully imported "${importName}"!`
                            : `Successfully imported ${count} ${notebooksText}!`
                        : count === 1
                            ? `Importing "${importName}"...`
                            : `Importing ${count} ${notebooksText}...`}
                </h1>

                {!isComplete && (
                    <p className="text-muted-foreground mb-8 text-center">
                        Please wait while your files are being processed
                    </p>
                )}

                {/* Progress Steps */}
                <Card className="w-full max-w-md mt-4 mb-8">
                    <CardContent className="pt-6">
                        <div className="space-y-3">
                            {STAGE_STEPS.map((step, index) => {
                                const isDone = index < currentStageIndex || isComplete;
                                const isCurrent = index === currentStageIndex && !isComplete;

                                return (
                                    <div
                                        key={step.key}
                                        className={`transition-opacity duration-300 ${
                                            index > currentStageIndex && !isComplete
                                                ? "opacity-30"
                                                : "opacity-100"
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                                                {isDone ? (
                                                    <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                                                ) : isCurrent ? (
                                                    <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
                                                ) : (
                                                    <div className="h-3 w-3 rounded-full border-2 border-muted-foreground/30" />
                                                )}
                                            </div>
                                            <span
                                                className={`text-sm ${
                                                    isDone
                                                        ? "text-muted-foreground"
                                                        : isCurrent
                                                            ? "text-foreground font-medium"
                                                            : "text-muted-foreground/50"
                                                }`}
                                            >
                                                {step.label}
                                            </span>
                                        </div>
                                        {isCurrent && detail && (
                                            <p className="text-xs text-muted-foreground ml-9 mt-1 truncate">
                                                {detail}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>

                {/* Success Actions */}
                {isComplete && showSuccess && (
                    <div className="flex flex-col sm:flex-row gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <Button
                            onClick={onImportMore}
                            variant="outline"
                            size="default"
                        >
                            Import More Files
                        </Button>
                        <Button
                            onClick={onStartTranslating}
                            size="default"
                            disabled={sourceFileCount === 0}
                        >
                            <FileText className="h-4 w-4 mr-2" />
                            Start Translating
                            <ArrowRight className="h-4 w-4 ml-2" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
