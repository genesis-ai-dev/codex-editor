import React from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { FileInput, FileOutput, ArrowRight, FileText } from "lucide-react";
import { ImportIntent } from "../types/wizard";
import { cn } from "../../lib/utils";

interface IntentSelectionProps {
    onSelectIntent: (intent: ImportIntent) => void;
    onStartTranslating: () => void;
    sourceFileCount: number;
    targetFileCount: number;
    translationPairCount: number;
}

export const IntentSelection: React.FC<IntentSelectionProps> = ({
    onSelectIntent,
    onStartTranslating,
    sourceFileCount,
    targetFileCount,
    translationPairCount,
}) => {
    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <div className="text-center space-y-4 mb-8">
                <h1 className="text-4xl font-bold">What would you like to import?</h1>
                <p className="text-lg text-muted-foreground">
                    Codex helps you manage translation pairs - original content and their
                    translations
                </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Source Files Card */}
                <Card
                    className={cn(
                        "cursor-pointer transition-all hover:shadow-lg hover:border-primary/50",
                        "relative overflow-hidden"
                    )}
                    onClick={() => onSelectIntent("source")}
                >
                    <CardHeader className="pb-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                                <FileInput className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <CardTitle className="text-xl">Source Files</CardTitle>
                        </div>
                        <CardDescription className="text-base">
                            Original content that you want to translate or transform
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            <div className="text-sm text-muted-foreground">
                                Examples: Biblical texts, documents, subtitles, markdown files
                            </div>
                            {sourceFileCount > 0 && (
                                <div className="pt-3 border-t">
                                    <p className="text-sm font-medium">
                                        You have {sourceFileCount} source file
                                        {sourceFileCount !== 1 ? "s" : ""} in this project
                                    </p>
                                </div>
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            className="w-full mt-4 justify-between group"
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelectIntent("source");
                            }}
                        >
                            Import Source Files
                            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                        </Button>
                    </CardContent>
                </Card>

                {/* Target Files Card */}
                <Card
                    className={cn(
                        "cursor-pointer transition-all hover:shadow-lg hover:border-primary/50",
                        "relative overflow-hidden",
                        sourceFileCount === 0 && "opacity-60"
                    )}
                    onClick={() => sourceFileCount > 0 && onSelectIntent("target")}
                >
                    <CardHeader className="pb-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/30">
                                <FileOutput className="h-6 w-6 text-green-600 dark:text-green-400" />
                            </div>
                            <CardTitle className="text-xl">Target Files</CardTitle>
                        </div>
                        <CardDescription className="text-base">
                            Translations or transformed versions of your source files
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            <div className="text-sm text-muted-foreground">
                                Create translations for your existing source files
                            </div>
                            {sourceFileCount === 0 ? (
                                <div className="pt-3 border-t">
                                    <p className="text-sm text-amber-600 dark:text-amber-500 font-medium">
                                        Import source files first to create translations
                                    </p>
                                </div>
                            ) : (
                                <div className="pt-3 border-t space-y-1">
                                    {targetFileCount > 0 && (
                                        <p className="text-sm font-medium">
                                            {targetFileCount} target file
                                            {targetFileCount !== 1 ? "s" : ""} created
                                        </p>
                                    )}
                                    {translationPairCount > 0 && (
                                        <p className="text-sm text-muted-foreground">
                                            {translationPairCount} translation pair
                                            {translationPairCount !== 1 ? "s" : ""}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            className="w-full mt-4 justify-between group"
                            disabled={sourceFileCount === 0}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (sourceFileCount > 0) {
                                    onSelectIntent("target");
                                }
                            }}
                        >
                            Create Target Files
                            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Info Section */}
            <div className="mt-8 p-4 rounded-lg bg-muted/50 text-center">
                <p className="text-sm text-muted-foreground">
                    A <span className="font-medium text-foreground">source</span> is your original
                    text that you want to translate from. When you add a source, Codex creates empty
                    target files ready for your translations. Already have translations in progress?
                    Choose <span className="font-medium text-foreground">target</span> to import
                    your existing translation work into the project.
                </p>
            </div>

            {/* Start Translating Button */}
            {sourceFileCount > 0 && (
                <div className="mt-6 text-center">
                    <Button
                        onClick={onStartTranslating}
                        variant="outline"
                        size="default"
                        className="px-8 py-2"
                    >
                        <FileText className="h-4 w-4 mr-2" />
                        Continue
                    </Button>
                </div>
            )}
        </div>
    );
};
