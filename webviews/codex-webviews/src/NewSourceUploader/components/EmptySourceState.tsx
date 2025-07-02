import React from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { FileInput, ArrowLeft, AlertCircle } from "lucide-react";

interface EmptySourceStateProps {
    onImportSources: () => void;
    onBack: () => void;
}

export const EmptySourceState: React.FC<EmptySourceStateProps> = ({ onImportSources, onBack }) => {
    return (
        <div className="container mx-auto p-6 max-w-3xl">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
            </div>

            <Card className="mt-12">
                <CardContent className="p-12 text-center space-y-6">
                    <div className="p-4 rounded-full bg-amber-100 dark:bg-amber-900/30 w-fit mx-auto">
                        <AlertCircle className="h-12 w-12 text-amber-600 dark:text-amber-400" />
                    </div>

                    <div className="space-y-3">
                        <h2 className="text-2xl font-bold">No Source Files Found</h2>
                        <p className="text-lg text-muted-foreground max-w-md mx-auto">
                            To create translation pairs, you'll need source files first.
                        </p>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-6 max-w-lg mx-auto">
                        <p className="text-sm text-muted-foreground">
                            <span className="font-medium">Source files</span> are your original
                            content - documents, biblical text, or any material you want to
                            translate or transform.
                        </p>
                    </div>

                    <div className="pt-4">
                        <Button size="lg" onClick={onImportSources} className="gap-2">
                            <FileInput className="h-5 w-5" />
                            Import Source Files
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Info Cards */}
            <div className="mt-8 grid md:grid-cols-3 gap-4 text-center">
                <div className="p-4 rounded-lg border bg-card">
                    <div className="text-2xl mb-2">📄</div>
                    <h3 className="font-medium text-sm mb-1">Documents</h3>
                    <p className="text-xs text-muted-foreground">DOCX, Markdown, Plain Text</p>
                </div>
                <div className="p-4 rounded-lg border bg-card">
                    <div className="text-2xl mb-2">📖</div>
                    <h3 className="font-medium text-sm mb-1">Biblical Texts</h3>
                    <p className="text-xs text-muted-foreground">USFM, Paratext, eBible</p>
                </div>
                <div className="p-4 rounded-lg border bg-card">
                    <div className="text-2xl mb-2">🎬</div>
                    <h3 className="font-medium text-sm mb-1">Media Files</h3>
                    <p className="text-xs text-muted-foreground">Subtitles, Transcripts</p>
                </div>
            </div>
        </div>
    );
};
