import React, { useState, useMemo } from "react";
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
import { Input } from "../../components/ui/input";
import { ArrowLeft, FileText, FolderOpen, Info, Search, Sparkles, Settings } from "lucide-react";
import { ImporterPlugin } from "../types/plugin";
import { ImportIntent } from "../types/wizard";
import { ExistingFile } from "../types/plugin";
import {
    getEssentialImporters,
    getSpecializedImporters,
    searchPlugins,
} from "../importers/registry";
import { cn } from "../../lib/utils";

interface PluginSelectionProps {
    plugins: ImporterPlugin[];
    intent: ImportIntent;
    selectedSource?: ExistingFile;
    existingSourceCount: number;
    onSelectPlugin: (pluginId: string) => void;
    onBack: () => void;
}

const PluginCard: React.FC<{
    plugin: ImporterPlugin;
    onSelect: (id: string) => void;
    className?: string;
}> = ({ plugin, onSelect, className }) => {
    const Icon = plugin.icon;
    const isEnabled = plugin.enabled !== false;

    return (
        <Card
            className={cn(
                "cursor-pointer transition-all group relative overflow-hidden",
                isEnabled ? "hover:shadow-lg hover:scale-[1.02]" : "opacity-50 cursor-not-allowed",
                className
            )}
            onClick={() => isEnabled && onSelect(plugin.id)}
        >
            <CardHeader className="pb-4">
                <div className="flex items-start justify-between mb-3">
                    <Icon className="h-10 w-10 group-hover:scale-110 transition-transform" />
                    {!isEnabled && <Badge variant="secondary">Soon</Badge>}
                </div>
                <CardTitle className="text-xl font-medium group-hover:text-primary transition-colors">
                    {plugin.name}
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed text-muted-foreground/80">
                    {plugin.description}
                </CardDescription>
            </CardHeader>
            <CardContent className="pt-1 pb-4">
                {plugin.supportedExtensions && plugin.supportedExtensions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                        {plugin.supportedExtensions.slice(0, 4).map((ext) => (
                            <Badge key={ext} variant="outline" className="text-xs font-mono">
                                .{ext}
                            </Badge>
                        ))}
                        {plugin.supportedExtensions.length > 4 && (
                            <Badge variant="outline" className="text-xs">
                                +{plugin.supportedExtensions.length - 4}
                            </Badge>
                        )}
                    </div>
                )}
                {plugin.tags && plugin.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {plugin.tags
                            .filter((tag) => !["Essential", "Specialized"].includes(tag))
                            .slice(0, 2)
                            .map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs opacity-60">
                                    {tag}
                                </Badge>
                            ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export const PluginSelection: React.FC<PluginSelectionProps> = ({
    plugins,
    intent,
    selectedSource,
    existingSourceCount,
    onSelectPlugin,
    onBack,
}) => {
    const [searchQuery, setSearchQuery] = useState("");
    const isTargetImport = intent === "target";

    const essentialPlugins = useMemo(() => getEssentialImporters(), []);
    const specializedPlugins = useMemo(() => getSpecializedImporters(), []);

    const filteredSpecializedPlugins = useMemo(() => {
        return searchQuery ? searchPlugins(searchQuery, specializedPlugins) : specializedPlugins;
    }, [searchQuery, specializedPlugins]);

    return (
        <div className="container mx-auto p-6 max-w-7xl space-y-8">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
            </div>

            {/* Title Section */}
            <div className="text-center space-y-3">
                <h1 className="text-4xl font-light tracking-tight">
                    {isTargetImport ? "Add Your Translation" : "Import Your Content"}
                </h1>
                <div className="text-lg text-muted-foreground max-w-2xl mx-auto text-center">
                    {isTargetImport
                        ? `Choose the format for translating "${selectedSource?.name}"`
                        : "Choose the format that matches your files"}
                </div>
            </div>

            {/* Context Information */}
            {isTargetImport && selectedSource && (
                <Alert className="max-w-4xl mx-auto">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="ml-2">
                        <div className="flex items-center justify-between">
                            <div>
                                <span className="font-medium">Creating translation for:</span>
                                <span className="ml-2 font-semibold">{selectedSource.name}</span>
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

            {/* Essential Tools Section */}
            <div className="space-y-8">
                <div className="text-center space-y-3">
                    <div className="flex items-center justify-center gap-3">
                        <Sparkles className="h-6 w-6 text-primary" />
                        <h2 className="text-3xl font-light">Most Popular</h2>
                    </div>
                    <p className="text-muted-foreground text-lg">For everyday files</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
                    {essentialPlugins.map((plugin) => (
                        <PluginCard
                            key={plugin.id}
                            plugin={plugin}
                            onSelect={onSelectPlugin}
                            className="border-2 hover:border-primary shadow-sm hover:shadow-xl"
                        />
                    ))}
                </div>
            </div>

            {/* Specialized Tools Section */}
            <div className="space-y-6 pt-8">
                <div className="text-center space-y-2">
                    <div className="flex items-center justify-center gap-2">
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        <h2 className="text-xl font-light text-muted-foreground">Specialized</h2>
                    </div>
                    <p className="text-sm text-muted-foreground/80">For specific workflows</p>
                </div>

                {/* Search Bar */}
                <div className="max-w-sm mx-auto">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search tools..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 border-muted-foreground/20"
                        />
                    </div>
                </div>

                {/* Specialized Tools Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
                    {filteredSpecializedPlugins.map((plugin) => (
                        <PluginCard
                            key={plugin.id}
                            plugin={plugin}
                            onSelect={onSelectPlugin}
                            className="opacity-95 hover:opacity-100 border-muted-foreground/10 hover:border-muted-foreground/30"
                        />
                    ))}
                </div>

                {searchQuery && filteredSpecializedPlugins.length === 0 && (
                    <div className="text-center py-6">
                        <p className="text-muted-foreground/60 text-sm">
                            No matches for "{searchQuery}"
                        </p>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSearchQuery("")}
                            className="mt-1 text-xs"
                        >
                            Clear
                        </Button>
                    </div>
                )}
            </div>

            {/* Simplified Help Text */}
            <div className="text-center pt-4">
                <p className="text-xs text-muted-foreground/60">
                    {isTargetImport
                        ? "Choose the format that matches your translation files"
                        : "Need help? Most Popular tools work with any text file"}
                </p>
            </div>
        </div>
    );
};
