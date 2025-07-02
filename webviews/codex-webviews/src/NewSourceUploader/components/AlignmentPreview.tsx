import React, { useState } from "react";
import { Button } from "../../components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../components/ui/card";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../components/ui/select";
import {
    CheckCircle,
    XCircle,
    AlertCircle,
    FileText,
    ArrowRight,
    RefreshCw,
    Info,
    Zap,
    Target,
} from "lucide-react";
import {
    AlignedCell,
    CellAligner,
    ImportedContent,
    sequentialCellAligner,
    defaultCellAligner,
} from "../types/plugin";

export interface AlignmentPreviewProps {
    alignedCells: AlignedCell[];
    importedContent: ImportedContent[];
    targetCells: any[];
    sourceCells: any[];
    selectedSourceName?: string;
    onConfirm: (alignedCells: AlignedCell[]) => void;
    onCancel: () => void;
    onRetryAlignment?: (aligner: CellAligner) => Promise<void>;
    isRetrying?: boolean;
}

export const AlignmentPreview: React.FC<AlignmentPreviewProps> = ({
    alignedCells,
    importedContent,
    targetCells,
    sourceCells,
    selectedSourceName,
    onConfirm,
    onCancel,
    onRetryAlignment,
    isRetrying = false,
}) => {
    const [selectedAlignmentMethod, setSelectedAlignmentMethod] = useState<string>("current");

    // Calculate statistics
    const matchedCount = alignedCells.filter((c) => c.notebookCell && !c.isParatext).length;
    const paratextCount = alignedCells.filter((c) => c.isParatext).length;
    const additionalOverlapCount = alignedCells.filter((c) => c.isAdditionalOverlap).length;
    const averageConfidence =
        alignedCells.length > 0
            ? alignedCells.reduce((sum, cell) => sum + (cell.confidence || 0), 0) /
              alignedCells.length
            : 0;

    // Determine if alignment looks good or needs improvement
    const alignmentQuality =
        matchedCount > paratextCount ? "good" : matchedCount > 0 ? "partial" : "poor";

    const handleRetryWithMethod = async (method: string) => {
        if (!onRetryAlignment) return;

        let aligner: CellAligner;
        switch (method) {
            case "sequential":
                aligner = sequentialCellAligner;
                break;
            case "exact-id":
                aligner = defaultCellAligner;
                break;
            default:
                return;
        }

        await onRetryAlignment(aligner);
    };

    const getAlignmentMethodBadge = (method?: string) => {
        switch (method) {
            case "exact-id":
                return <Badge variant="default">ID Match</Badge>;
            case "sequential":
                return <Badge variant="secondary">Sequential</Badge>;
            case "timestamp":
                return <Badge variant="outline">Timestamp</Badge>;
            case "custom":
                return <Badge variant="outline">Custom</Badge>;
            default:
                return <Badge variant="outline">Unknown</Badge>;
        }
    };

    const getConfidenceBadge = (confidence?: number) => {
        if (confidence === undefined) return null;
        const level = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
        const variant =
            level === "high" ? "default" : level === "medium" ? "secondary" : "destructive";
        return (
            <Badge variant={variant} className="text-xs">
                {Math.round(confidence * 100)}% confidence
            </Badge>
        );
    };

    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Target className="h-6 w-6" />
                        Review Translation Alignment
                    </h1>
                    {selectedSourceName && (
                        <p className="text-muted-foreground">
                            Importing translation for:{" "}
                            <span className="font-medium">{selectedSourceName}</span>
                        </p>
                    )}
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onCancel} disabled={isRetrying}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => onConfirm(alignedCells)}
                        className="flex items-center gap-2"
                        disabled={isRetrying}
                    >
                        <CheckCircle className="h-4 w-4" />
                        Confirm Import
                    </Button>
                </div>
            </div>

            {/* Alignment Quality Alert */}
            {alignmentQuality === "poor" && (
                <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                        <strong>Poor alignment detected!</strong> Only {matchedCount} out of{" "}
                        {importedContent.length} items could be matched. Consider trying sequential
                        insertion or check if you selected the correct file.
                    </AlertDescription>
                </Alert>
            )}

            {alignmentQuality === "partial" && (
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        <strong>Partial alignment.</strong> {matchedCount} items matched,{" "}
                        {paratextCount} will be added as paratext. You may want to try a different
                        alignment method.
                    </AlertDescription>
                </Alert>
            )}

            {alignmentQuality === "good" && (
                <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                        <strong>Good alignment!</strong> {matchedCount} items successfully matched
                        with existing cells.
                    </AlertDescription>
                </Alert>
            )}

            {/* Alignment Statistics */}
            <Card>
                <CardHeader>
                    <CardTitle>Alignment Summary</CardTitle>
                    <CardDescription>
                        Review how the imported content will be aligned with existing cells
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                                {matchedCount}
                            </p>
                            <p className="text-sm text-muted-foreground">Matched Cells</p>
                        </div>
                        <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                                {paratextCount}
                            </p>
                            <p className="text-sm text-muted-foreground">Paratext Cells</p>
                        </div>
                        {additionalOverlapCount > 0 && (
                            <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                    {additionalOverlapCount}
                                </p>
                                <p className="text-sm text-muted-foreground">Additional Overlaps</p>
                            </div>
                        )}
                        <div className="text-center p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
                            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                {Math.round(averageConfidence * 100)}%
                            </p>
                            <p className="text-sm text-muted-foreground">Avg Confidence</p>
                        </div>
                    </div>

                    {/* Retry with different alignment method */}
                    {onRetryAlignment && (
                        <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                            <Info className="h-5 w-5 text-muted-foreground" />
                            <div className="flex-1">
                                <p className="text-sm font-medium">
                                    Try a different alignment method:
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Sequential insertion works well for documents without structured
                                    IDs
                                </p>
                            </div>
                            <Select
                                value={selectedAlignmentMethod}
                                onValueChange={setSelectedAlignmentMethod}
                                disabled={isRetrying}
                            >
                                <SelectTrigger className="w-48">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="current">Current Alignment</SelectItem>
                                    <SelectItem value="sequential">Sequential Insertion</SelectItem>
                                    <SelectItem value="exact-id">Exact ID Matching</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button
                                onClick={() => handleRetryWithMethod(selectedAlignmentMethod)}
                                disabled={selectedAlignmentMethod === "current" || isRetrying}
                                size="sm"
                                variant="outline"
                                className="flex items-center gap-2"
                            >
                                {isRetrying ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Zap className="h-4 w-4" />
                                )}
                                Retry
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Detailed Alignment View */}
            <Tabs defaultValue="matched" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="matched">Matched ({matchedCount})</TabsTrigger>
                    <TabsTrigger value="paratext">Paratext ({paratextCount})</TabsTrigger>
                    <TabsTrigger value="all">All ({alignedCells.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="matched">
                    <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                        <div className="space-y-2">
                            {alignedCells
                                .filter((cell) => cell.notebookCell && !cell.isParatext)
                                .map((cell, index) => (
                                    <Card key={index} className="p-3">
                                        <div className="flex items-start gap-3">
                                            <ArrowRight className="h-4 w-4 text-green-600 dark:text-green-400 mt-1" />
                                            <div className="flex-1 space-y-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <Badge variant="outline" className="text-xs">
                                                        {cell.importedContent.id}
                                                    </Badge>
                                                    {getAlignmentMethodBadge(cell.alignmentMethod)}
                                                    {getConfidenceBadge(cell.confidence)}
                                                    {cell.importedContent.startTime &&
                                                        cell.importedContent.endTime && (
                                                            <Badge
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                {cell.importedContent.startTime}s -{" "}
                                                                {cell.importedContent.endTime}s
                                                            </Badge>
                                                        )}
                                                </div>
                                                <div className="text-sm">
                                                    <p className="font-medium">Imported:</p>
                                                    <p className="pl-2 border-l-2 border-green-200 dark:border-green-800">
                                                        {cell.importedContent.content}
                                                    </p>
                                                </div>
                                                {cell.notebookCell && (
                                                    <div className="text-sm">
                                                        <p className="font-medium">
                                                            Target Cell:{" "}
                                                            {cell.notebookCell.metadata?.id}
                                                        </p>
                                                        <p className="pl-2 border-l-2 border-blue-200 dark:border-blue-800 text-muted-foreground">
                                                            {cell.notebookCell.value || "(empty)"}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                        </div>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="paratext">
                    <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                        <Alert className="mb-4">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                These items couldn't be matched to existing cells and will be added
                                as paratext.
                            </AlertDescription>
                        </Alert>
                        <div className="space-y-2">
                            {alignedCells
                                .filter((cell) => cell.isParatext)
                                .map((cell, index) => (
                                    <Card
                                        key={index}
                                        className="p-3 border-yellow-200 dark:border-yellow-800"
                                    >
                                        <div className="flex items-start gap-3">
                                            <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-1" />
                                            <div className="flex-1 space-y-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <Badge variant="outline" className="text-xs">
                                                        {cell.importedContent.id}
                                                    </Badge>
                                                    {getAlignmentMethodBadge(cell.alignmentMethod)}
                                                    {getConfidenceBadge(cell.confidence)}
                                                </div>
                                                <p className="text-sm">
                                                    {cell.importedContent.content}
                                                </p>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                        </div>
                    </ScrollArea>
                </TabsContent>

                <TabsContent value="all">
                    <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                        <div className="space-y-2">
                            {alignedCells.map((cell, index) => (
                                <Card
                                    key={index}
                                    className={`p-3 ${
                                        cell.isParatext
                                            ? "border-yellow-200 dark:border-yellow-800"
                                            : ""
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        {cell.isParatext ? (
                                            <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-1" />
                                        ) : (
                                            <ArrowRight className="h-4 w-4 text-green-600 dark:text-green-400 mt-1" />
                                        )}
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <Badge variant="outline" className="text-xs">
                                                    {cell.importedContent.id}
                                                </Badge>
                                                {getAlignmentMethodBadge(cell.alignmentMethod)}
                                                {getConfidenceBadge(cell.confidence)}
                                                {cell.isParatext && (
                                                    <Badge
                                                        variant="destructive"
                                                        className="text-xs"
                                                    >
                                                        Paratext
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-sm">
                                                {cell.importedContent.content}
                                            </p>
                                            {cell.notebookCell && !cell.isParatext && (
                                                <p className="text-xs text-muted-foreground">
                                                    → Target: {cell.notebookCell.metadata?.id}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </ScrollArea>
                </TabsContent>
            </Tabs>
        </div>
    );
};
