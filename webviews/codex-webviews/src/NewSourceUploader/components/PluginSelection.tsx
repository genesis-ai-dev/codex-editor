import React, { useState, useMemo, useEffect } from "react";
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
import { Checkbox } from "../../components/ui/checkbox";
import { ArrowLeft, Info, Search, Sparkles, Settings } from "lucide-react";
import { ImporterPlugin } from "../types/plugin";
import { ImportIntent } from "../types/wizard";
import { ExistingFile } from "../types/plugin";
import {
    getEssentialImporters,
    getSpecializedImporters,
    searchPlugins,
} from "../importers/registry";
import { cn } from "../../lib/utils";
import { getExportGroupKeyForImporterPlugin } from "@sharedUtils/exportOptionsEligibility";
import { ExportOptionsPreviewPanel } from "./ExportOptionsPreviewPanel";
import { getImporterById } from "../importers/registry";

interface PluginSelectionProps {
    plugins: ImporterPlugin[];
    intent: ImportIntent;
    selectedSource?: ExistingFile;
    existingSourceCount: number;
    onSelectPlugin: (pluginId: string) => void;
    onBack?: () => void;
}

const PluginCard: React.FC<{
    plugin: ImporterPlugin;
    onPick: (id: string) => void;
    isPending: boolean;
    className?: string;
}> = ({ plugin, onPick, isPending, className }) => {
    const Icon = plugin.icon;
    const isEnabled = plugin.enabled !== false;
    const isBetaPlugin =
        plugin.id === "indesign-importer" ||
        plugin.id === "biblica-importer" ||
        plugin.id === "reach4life-importer" ||
        plugin.id === "spreadsheet";

    return (
        <Card
            className={cn(
                "cursor-pointer transition-all group relative overflow-hidden",
                isEnabled ? "hover:shadow-lg hover:scale-[1.02]" : "opacity-50 cursor-not-allowed",
                className,
                isBetaPlugin ? "hover:border-yellow-500" : "hover:border-primary",
                isPending && "ring-2 ring-primary border-primary shadow-md scale-[1.01]"
            )}
            onClick={() => isEnabled && onPick(plugin.id)}
        >
            <CardHeader className="pb-4">
                <div className="flex items-start justify-between mb-3">
                    <Icon className="h-10 w-10 group-hover:scale-110 transition-transform" />
                    <div className="flex items-center gap-2">
                        {isBetaPlugin && (
                            <Badge
                                variant="secondary"
                                className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                            >
                                in BETA
                            </Badge>
                        )}
                        {!isEnabled && <Badge variant="secondary">Soon</Badge>}
                    </div>
                </div>
                <CardTitle
                    className={cn(
                        "text-xl font-medium transition-colors",
                        isBetaPlugin ? "group-hover:text-yellow-500" : "group-hover:text-primary"
                    )}
                >
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
                            .map((tag) => (
                                <Badge
                                    key={tag}
                                    variant="secondary"
                                    className={`text-xs ${
                                        tag === "Round-trip"
                                            ? "bg-green-500/10 text-green-600 dark:bg-green-500/15 dark:text-green-400 border-green-500/20"
                                            : "opacity-60"
                                    }`}
                                >
                                    {tag}
                                </Badge>
                            ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

/** Matches Tailwind `max-sm` (single-column importer grids use `grid-cols-1` below `sm`). */
const MAX_SM_SINGLE_COLUMN_MQ = "(max-width: 639px)";

function useIsImporterSingleColumn(): boolean {
    const [singleColumn, setSingleColumn] = useState(() =>
        typeof window !== "undefined" ? window.matchMedia(MAX_SM_SINGLE_COLUMN_MQ).matches : false
    );
    useEffect(() => {
        const mql = window.matchMedia(MAX_SM_SINGLE_COLUMN_MQ);
        const onChange = (): void => setSingleColumn(mql.matches);
        onChange();
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
    }, []);
    return singleColumn;
}

const PendingImporterExportCard: React.FC<{
    pendingPluginName: string;
    previewGroupKey: string;
    onCancel: () => void;
    onConfirm: () => void;
    className?: string;
}> = ({ pendingPluginName, previewGroupKey, onCancel, onConfirm, className }) => {
    return (
        <div
            className={cn(
                "rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col max-sm:animate-nsu-export-panel-from-bottom sm:animate-nsu-export-panel-from-right",
                className
            )}
        >
            <div className="p-4 pb-3 border-b border-border/60 bg-muted/20">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    Selected importer
                </p>
                <p className="text-sm font-semibold mt-0.5">{pendingPluginName}</p>
            </div>
            <div className="p-4">
                <ExportOptionsPreviewPanel groupKey={previewGroupKey} />
            </div>
            <div className="border-t border-border p-4 bg-muted/15 flex flex-col gap-6">
                <div className="grid grid-cols-2 gap-3 max-w-md mx-auto w-full">
                    <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        onClick={onCancel}
                        className="h-12 min-h-12 w-full text-base"
                    >
                        Cancel
                    </Button>
                    <Button type="button" size="lg" onClick={onConfirm} className="h-12 min-h-12 w-full text-base">
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    );
};

export const PluginSelection: React.FC<PluginSelectionProps> = ({
    intent,
    selectedSource,
    existingSourceCount,
    onSelectPlugin,
    onBack,
}) => {
    const [essentialSearchQuery, setEssentialSearchQuery] = useState("");
    const [essentialRoundTripOnly, setEssentialRoundTripOnly] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [specializedRoundTripOnly, setSpecializedRoundTripOnly] = useState(false);
    const [pendingPluginId, setPendingPluginId] = useState<string | null>(null);
    const isImporterSingleColumn = useIsImporterSingleColumn();
    const isTargetImport = intent === "target";

    const previewGroupKey = pendingPluginId
        ? getExportGroupKeyForImporterPlugin(pendingPluginId)
        : null;
    const pendingPlugin = pendingPluginId ? getImporterById(pendingPluginId) : undefined;

    const essentialPlugins = useMemo(() => getEssentialImporters(isTargetImport), [isTargetImport]);
    const specializedPlugins = useMemo(
        () => getSpecializedImporters(isTargetImport),
        [isTargetImport]
    );

    const filteredEssentialPlugins = useMemo(() => {
        let result = essentialSearchQuery
            ? searchPlugins(essentialSearchQuery, essentialPlugins)
            : essentialPlugins;
        if (essentialRoundTripOnly) {
            result = result.filter((p) => p.tags?.includes("Round-trip"));
        }
        return result;
    }, [essentialSearchQuery, essentialPlugins, essentialRoundTripOnly]);

    const filteredSpecializedPlugins = useMemo(() => {
        let result = searchQuery
            ? searchPlugins(searchQuery, specializedPlugins)
            : specializedPlugins;
        if (specializedRoundTripOnly) {
            result = result.filter((p) => p.tags?.includes("Round-trip"));
        }
        return result;
    }, [searchQuery, specializedPlugins, specializedRoundTripOnly]);

    const handlePickPlugin = (id: string) => {
        setPendingPluginId(id);
    };

    const handleConfirmPlugin = () => {
        if (!pendingPluginId) {
            return;
        }
        onSelectPlugin(pendingPluginId);
        setPendingPluginId(null);
    };

    const handleCancelPending = () => {
        setPendingPluginId(null);
    };

    const showInlineExportPanel =
        Boolean(pendingPluginId && previewGroupKey && isImporterSingleColumn);
    const showAsideExportPanel =
        Boolean(pendingPluginId && previewGroupKey && !isImporterSingleColumn);

    return (
        <div
            className={cn(
                "container mx-auto p-4 lg:p-6",
                pendingPluginId ? "max-w-[1400px]" : "max-w-7xl"
            )}
        >
                <div
                className={cn(
                    "gap-8",
                    pendingPluginId && showAsideExportPanel
                        ? "flex flex-col sm:grid sm:grid-cols-[minmax(0,1fr)_min(280px,34vw)] lg:grid-cols-[minmax(0,1fr)_min(300px,32vw)] xl:grid-cols-[minmax(0,1fr)_360px] sm:items-start"
                        : "flex flex-col"
                )}
            >
                <div className="space-y-8 min-w-0">
                    {/* Header */}
                    {onBack && (
                        <div className="flex items-center gap-4">
                            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
                                <ArrowLeft className="h-4 w-4" />
                                Back
                            </Button>
                        </div>
                    )}

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
                                        <span className="font-medium">
                                            Creating translation for:
                                        </span>
                                        <span className="ml-2 font-semibold">
                                            {selectedSource.name}
                                        </span>
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
                                <Sparkles className="h-6 w-6 text-blue-500" />
                                <h2 className="text-3xl font-light">Most Popular</h2>
                            </div>
                            <p className="text-muted-foreground text-lg">For everyday files</p>
                        </div>

                        <div className="max-w-md mx-auto flex items-center gap-3">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search tools..."
                                    value={essentialSearchQuery}
                                    onChange={(e) => setEssentialSearchQuery(e.target.value)}
                                    className="pl-10 border-muted-foreground/20"
                                />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
                                <Checkbox
                                    checked={essentialRoundTripOnly}
                                    onCheckedChange={(checked) =>
                                        setEssentialRoundTripOnly(checked === true)
                                    }
                                />
                                <span className="text-sm text-muted-foreground">Round-trip</span>
                            </label>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
                            {filteredEssentialPlugins.map((plugin) => (
                                <React.Fragment key={plugin.id}>
                                    <PluginCard
                                        plugin={plugin}
                                        onPick={handlePickPlugin}
                                        isPending={pendingPluginId === plugin.id}
                                        className={cn(
                                            "border-2 shadow-sm hover:shadow-xl",
                                            plugin.id === "docx" ||
                                                plugin.id === "pdf-importer" ||
                                                plugin.id === "usfm-experimental" ||
                                                plugin.id === "indesign-importer" ||
                                                plugin.id === "biblica-importer" ||
                                                plugin.id === "spreadsheet"
                                                ? "hover:border-yellow-500"
                                                : "hover:border-primary"
                                        )}
                                    />
                                    {showInlineExportPanel && pendingPluginId === plugin.id && previewGroupKey && (
                                        <div className="col-span-1 sm:col-span-2 lg:col-span-3 w-full min-w-0">
                                            <PendingImporterExportCard
                                                pendingPluginName={pendingPlugin?.name ?? pendingPluginId}
                                                previewGroupKey={previewGroupKey}
                                                onCancel={handleCancelPending}
                                                onConfirm={handleConfirmPlugin}
                                            />
                                        </div>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>

                        {essentialSearchQuery && filteredEssentialPlugins.length === 0 && (
                            <div className="text-center py-6">
                                <p className="text-muted-foreground/60 text-sm">
                                    No matches for "{essentialSearchQuery}"
                                </p>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEssentialSearchQuery("")}
                                    className="mt-1 text-xs"
                                >
                                    Clear
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Specialized Tools Section */}
                    <div className="space-y-6 pt-8">
                        <div className="text-center space-y-3">
                            <div className="flex items-center justify-center gap-3">
                                <Settings className="h-6 w-6 text-blue-500" />
                                <h2 className="text-3xl font-light">Specialized</h2>
                            </div>
                            <p className="text-muted-foreground text-lg">For specific workflows</p>
                        </div>

                        {/* Search Bar */}
                        <div className="max-w-md mx-auto flex items-center gap-3">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search tools..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-10 border-muted-foreground/20"
                                />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
                                <Checkbox
                                    checked={specializedRoundTripOnly}
                                    onCheckedChange={(checked) =>
                                        setSpecializedRoundTripOnly(checked === true)
                                    }
                                />
                                <span className="text-sm text-muted-foreground">Round-trip</span>
                            </label>
                        </div>

                        {/* Specialized Tools Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
                            {filteredSpecializedPlugins.map((plugin) => (
                                <React.Fragment key={plugin.id}>
                                    <PluginCard
                                        plugin={plugin}
                                        onPick={handlePickPlugin}
                                        isPending={pendingPluginId === plugin.id}
                                        className={cn(
                                            "border-2 shadow-sm hover:shadow-xl opacity-95 hover:opacity-100",
                                            plugin.id === "docx" ||
                                                plugin.id === "pdf-importer" ||
                                                plugin.id === "usfm-experimental" ||
                                                plugin.id === "indesign-importer" ||
                                                plugin.id === "biblica-importer" ||
                                                plugin.id === "spreadsheet"
                                                ? "hover:border-yellow-500"
                                                : "hover:border-primary"
                                        )}
                                    />
                                    {showInlineExportPanel && pendingPluginId === plugin.id && previewGroupKey && (
                                        <div className="col-span-1 sm:col-span-2 lg:col-span-3 w-full min-w-0">
                                            <PendingImporterExportCard
                                                pendingPluginName={pendingPlugin?.name ?? pendingPluginId}
                                                previewGroupKey={previewGroupKey}
                                                onCancel={handleCancelPending}
                                                onConfirm={handleConfirmPlugin}
                                            />
                                        </div>
                                    )}
                                </React.Fragment>
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
                </div>

                {showAsideExportPanel && previewGroupKey && pendingPluginId && (
                    <aside className="w-full shrink-0 sm:sticky sm:top-4 sm:self-start">
                        <PendingImporterExportCard
                            pendingPluginName={pendingPlugin?.name ?? pendingPluginId}
                            previewGroupKey={previewGroupKey}
                            onCancel={handleCancelPending}
                            onConfirm={handleConfirmPlugin}
                        />
                    </aside>
                )}
            </div>
        </div>
    );
};
