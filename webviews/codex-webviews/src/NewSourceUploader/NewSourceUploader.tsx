import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import {
    ImporterPlugin,
    ImporterComponentProps,
    ProviderMessage,
    ExistingFile,
} from "./types/plugin";
import { NotebookPair } from "./types/common";
import { importerPlugins, getImporterById } from "./importers/registry.tsx";
import { FileText, FolderOpen } from "lucide-react";
import "./App.css";
import "../tailwind.css";

// Get the VSCode API that was set up in the HTML
const vscode: { postMessage: (message: any) => void } = (window as any).vscodeApi;

const NewSourceUploader: React.FC = () => {
    const [activePluginId, setActivePluginId] = useState<string | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [existingFiles, setExistingFiles] = useState<ExistingFile[]>([]);
    const [isLoadingFiles, setIsLoadingFiles] = useState(true);

    // Check for existing files on mount
    useEffect(() => {
        const checkExistingFiles = () => {
            setIsLoadingFiles(true);

            // Set up listener for response
            const handleMessage = (event: MessageEvent) => {
                const message = event.data;
                if (message.command === "existingFilesFound") {
                    setExistingFiles(message.files || []);
                    setIsLoadingFiles(false);
                    window.removeEventListener("message", handleMessage);
                }
            };

            window.addEventListener("message", handleMessage);

            // Send request to check files
            vscode.postMessage({
                command: "checkExistingFiles",
            });

            // Timeout fallback
            const timeout = setTimeout(() => {
                setIsLoadingFiles(false);
                window.removeEventListener("message", handleMessage);
            }, 5000);

            return () => {
                clearTimeout(timeout);
                window.removeEventListener("message", handleMessage);
            };
        };

        checkExistingFiles();
    }, []);

    const handleSelectPlugin = useCallback(
        (pluginId: string) => {
            if (isDirty) {
                const confirmLeave = window.confirm(
                    "You have unsaved changes. Are you sure you want to leave this import?"
                );
                if (!confirmLeave) return;
            }
            setActivePluginId(pluginId);
            setIsDirty(false);
        },
        [isDirty]
    );

    const handleComplete = useCallback(
        (notebooks: NotebookPair | NotebookPair[]) => {
            // Normalize to array format
            const notebookPairs = Array.isArray(notebooks) ? notebooks : [notebooks];

            // Send notebooks to provider for writing
            const message: ProviderMessage = {
                command: "writeNotebooks",
                notebookPairs,
                metadata: {
                    importerType: activePluginId,
                    timestamp: new Date().toISOString(),
                },
            };

            vscode.postMessage(message);

            // Reset to homepage
            setActivePluginId(null);
            setIsDirty(false);
        },
        [activePluginId]
    );

    const handleCancel = useCallback(() => {
        if (isDirty) {
            const confirmLeave = window.confirm("Cancel import? Any unsaved changes will be lost.");
            if (!confirmLeave) return;
        }
        setActivePluginId(null);
        setIsDirty(false);
    }, [isDirty]);

    // If a plugin is active, render its component
    if (activePluginId) {
        const plugin = getImporterById(activePluginId);
        if (!plugin) {
            return (
                <div className="container mx-auto p-6">
                    <Card>
                        <CardContent className="p-6">
                            <p className="text-center text-red-600">
                                Error: Plugin '{activePluginId}' not found
                            </p>
                            <Button
                                onClick={() => setActivePluginId(null)}
                                className="mt-4 mx-auto block"
                            >
                                Back to Home
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            );
        }

        const PluginComponent = plugin.component;
        return (
            <PluginComponent
                onComplete={handleComplete}
                onCancel={handleCancel}
                existingFiles={existingFiles}
            />
        );
    }

    // Render homepage with plugin cards
    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold">Source File Importer</h1>
                <p className="text-muted-foreground">
                    Choose an import method to bring your content into Codex
                </p>
            </div>

            {/* Existing Files Section */}
            {!isLoadingFiles && existingFiles.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FolderOpen className="h-5 w-5" />
                            Existing Source Files
                        </CardTitle>
                        <CardDescription>
                            {existingFiles.length} source file{existingFiles.length > 1 ? "s" : ""}{" "}
                            found in your project. You can import translations or additional content
                            for these files.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="max-h-48 overflow-y-auto space-y-2">
                            {existingFiles.map((file, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-2 rounded-lg border bg-muted/30"
                                >
                                    <div className="flex items-center gap-2">
                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                        <div>
                                            <p className="font-medium text-sm">{file.name}</p>
                                            <div className="flex gap-2 text-xs text-muted-foreground">
                                                <span>{file.cellCount} cells</span>
                                                {file.type !== "unknown" && (
                                                    <Badge variant="outline" className="text-xs">
                                                        {file.type}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Plugin Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {importerPlugins.map((plugin) => {
                    const Icon = plugin.icon;
                    const isEnabled = plugin.enabled !== false;

                    return (
                        <Card
                            className={cn(
                                "cursor-pointer transition-all",
                                isEnabled
                                    ? "hover:shadow-lg hover:border-primary/50"
                                    : "opacity-50 cursor-not-allowed"
                            )}
                            onClick={() => isEnabled && handleSelectPlugin(plugin.id)}
                        >
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <Icon className="h-8 w-8 text-muted-foreground" />
                                    {!isEnabled && <Badge variant="secondary">Coming Soon</Badge>}
                                </div>
                                <CardTitle className="text-lg">{plugin.name}</CardTitle>
                                <CardDescription>{plugin.description}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {plugin.supportedExtensions &&
                                    plugin.supportedExtensions.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {plugin.supportedExtensions.slice(0, 3).map((ext) => (
                                                <Badge
                                                    key={ext}
                                                    variant="outline"
                                                    className="text-xs"
                                                >
                                                    .{ext}
                                                </Badge>
                                            ))}
                                            {plugin.supportedExtensions.length > 3 && (
                                                <Badge variant="outline" className="text-xs">
                                                    +{plugin.supportedExtensions.length - 3} more
                                                </Badge>
                                            )}
                                        </div>
                                    )}
                                {plugin.tags && plugin.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {plugin.tags.map((tag) => (
                                            <Badge
                                                key={tag}
                                                variant="secondary"
                                                className="text-xs"
                                            >
                                                {tag}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};

export default NewSourceUploader;
