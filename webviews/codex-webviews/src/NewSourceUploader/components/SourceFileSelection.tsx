import React, { useState, useMemo } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
    FileText,
    Search,
    Calendar,
    FileType,
    ArrowLeft,
    ChevronRight,
    FolderOpen,
} from "lucide-react";
import { ExistingFile } from "../types/plugin";
import { BasicFileInfo } from "../types/wizard";
import { cn } from "../../lib/utils";

interface SourceFileSelectionProps {
    sourceFiles: BasicFileInfo[];
    onSelectSource: (source: BasicFileInfo) => void;
    onBack: () => void;
}

export const SourceFileSelection: React.FC<SourceFileSelectionProps> = ({
    sourceFiles,
    onSelectSource,
    onBack,
}) => {
    const [searchQuery, setSearchQuery] = useState("");

    // Filter files based on search only (no type filtering for BasicFileInfo)
    const filteredFiles = useMemo(() => {
        return sourceFiles.filter((file) => {
            const matchesSearch = file.name.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesSearch;
        });
    }, [sourceFiles, searchQuery]);

    const formatDate = (dateString?: string) => {
        if (!dateString) return "Unknown date";
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    };

    const getFileTypeIcon = (type: string) => {
        switch (type) {
            case "bible":
            case "ebibleCorpus":
                return "📖";
            case "paratext":
                return "📚";
            case "docx":
                return "📄";
            case "markdown":
                return "📝";
            case "subtitle":
                return "🎬";
            default:
                return "📁";
        }
    };

    return (
        <div className="container mx-auto p-6 max-w-5xl">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
            </div>

            <div className="text-center space-y-4 mb-8">
                <h1 className="text-3xl font-bold">Select Source File</h1>
                <p className="text-lg text-muted-foreground">
                    Choose the source file you want to create a translation for
                </p>
            </div>

            {/* Search */}
            <div className="flex gap-4 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by file name..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>

            {/* File List */}
            {filteredFiles.length === 0 ? (
                <Card>
                    <CardContent className="p-12 text-center">
                        <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-muted-foreground">
                            {searchQuery
                                ? "No files match your search criteria"
                                : "No source files found in your project"}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <ScrollArea className="h-[500px] pr-4">
                    <div className="space-y-2">
                        {filteredFiles.map((file, index) => (
                            <Card
                                key={`${file.path}-${index}`}
                                className={cn(
                                    "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
                                    "group"
                                )}
                                onClick={() => onSelectSource(file)}
                            >
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4 flex-1">
                                            <div className="p-2 rounded-lg bg-muted">
                                                <FileText className="h-5 w-5 text-muted-foreground" />
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="font-medium text-base mb-1">
                                                    {file.name}
                                                </h4>
                                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                                    <span className="text-xs">{file.path}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </ScrollArea>
            )}

            {/* Summary */}
            <div className="mt-6 text-center text-sm text-muted-foreground">
                Showing {filteredFiles.length} of {sourceFiles.length} source files
            </div>
        </div>
    );
};
