import React from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { ArrowLeft, FileText, FolderOpen, Info } from "lucide-react";
import { ImporterPlugin } from "../types/plugin";
import { ImportIntent } from "../types/wizard";
import { ExistingFile } from "../types/plugin";
import { cn } from "../../lib/utils";

interface PluginSelectionProps {
    plugins: ImporterPlugin[];
    intent: ImportIntent;
    selectedSource?: ExistingFile;
    existingSourceCount: number;
    onSelectPlugin: (pluginId: string) => void;
    onBack: () => void;
}

export const PluginSelection: React.FC<PluginSelectionProps> = ({
    plugins,
    intent,
    selectedSource,
    existingSourceCount,
    onSelectPlugin,
    onBack,
}) => {
    const isTargetImport = intent === "target";

    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
            </div>

            {/* Title Section */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold">
                    {isTargetImport ? `Choose Format for Translation` : "Choose Import Method"}
                </h1>
                <p className="text-muted-foreground">
                    {isTargetImport
                        ? `Select how you want to import the translation for "${selectedSource?.name}"`
                        : "Select the format of your source files to import"}
                </p>
            </div>

            {/* Context Information */}
            {isTargetImport && selectedSource && (
                <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription className="ml-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="font-medium">Creating translation for:</span>
                                <span className="ml-2">{selectedSource.name}</span>
                                <Badge variant="outline" className="ml-2 text-xs">
                                    {selectedSource.type}
                                </Badge>
                                <span className="text-muted-foreground ml-2">
                                    ({selectedSource.cellCount} cells)
                                </span>
                            </div>
                        </div>
                    </AlertDescription>
                </Alert>
            )}

            {/* Existing Files Info */}
            {!isTargetImport && existingSourceCount > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <FolderOpen className="h-5 w-5" />
                            Project Status
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            You currently have {existingSourceCount} source file
                            {existingSourceCount > 1 ? "s" : ""} in your project. You can import
                            additional source files or create translations for existing ones.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Plugin Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {plugins.map((plugin) => {
                    const Icon = plugin.icon;
                    const isEnabled = plugin.enabled !== false;

                    return (
                        <Card
                            key={plugin.id}
                            className={cn(
                                "cursor-pointer transition-all",
                                isEnabled
                                    ? "hover:shadow-lg hover:border-primary/50"
                                    : "opacity-50 cursor-not-allowed"
                            )}
                            onClick={() => isEnabled && onSelectPlugin(plugin.id)}
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

            {/* Help Text */}
            <div className="text-center text-sm text-muted-foreground mt-6">
                {isTargetImport
                    ? "Choose the format that matches your translation files"
                    : "Select the format that matches your source files"}
            </div>
        </div>
    );
};
