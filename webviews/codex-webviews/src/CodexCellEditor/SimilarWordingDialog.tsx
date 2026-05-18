import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Pin, Search } from "lucide-react";
import { SimilarWordingChunk, SimilarWordingInspectionResult } from "../../../../types";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import { getCellDisplayLabel } from "../utils/cellDisplayUtils";

interface SimilarWordingDialogProps {
    open: boolean;
    loading: boolean;
    error?: string;
    result?: SimilarWordingInspectionResult;
    onOpenChange: (open: boolean) => void;
    onSearchChunk: (query: string) => void;
    onPinCell: (cellId: string) => void;
}

interface TextSegment {
    text: string;
    chunk?: SimilarWordingChunk;
    chunkIndex?: number;
}

function buildTextSegments(result?: SimilarWordingInspectionResult): TextSegment[] {
    if (!result?.plainText) return [];

    const chunks = [...result.chunks].sort((a, b) => a.startOffset - b.startOffset);
    const segments: TextSegment[] = [];
    let cursor = 0;

    chunks.forEach((chunk, index) => {
        if (chunk.startOffset < cursor) return;
        if (chunk.startOffset > cursor) {
            segments.push({ text: result.plainText.slice(cursor, chunk.startOffset) });
        }
        segments.push({
            text: result.plainText.slice(chunk.startOffset, chunk.endOffset),
            chunk,
            chunkIndex: index,
        });
        cursor = chunk.endOffset;
    });

    if (cursor < result.plainText.length) {
        segments.push({ text: result.plainText.slice(cursor) });
    }

    return segments;
}

export function SimilarWordingDialog({
    open,
    loading,
    error,
    result,
    onOpenChange,
    onSearchChunk,
    onPinCell,
}: SimilarWordingDialogProps) {
    const [selectedChunkIndex, setSelectedChunkIndex] = useState<number | null>(null);
    const segments = useMemo(() => buildTextSegments(result), [result]);
    const selectedChunk =
        selectedChunkIndex !== null ? result?.chunks[selectedChunkIndex] : undefined;

    const chunksToShow = selectedChunk ? [selectedChunk] : result?.chunks ?? [];

    useEffect(() => {
        setSelectedChunkIndex(null);
    }, [result?.cellId, open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[86vh] max-w-[860px] overflow-hidden p-0">
                <DialogHeader className="border-b px-6 pb-4 pt-6">
                    <DialogTitle className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                        Why this translation?
                    </DialogTitle>
                    <DialogDescription>
                        If this translation looks off, review matching translated examples that may
                        have influenced AI suggestions.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid max-h-[calc(86vh-96px)] grid-rows-[auto_1fr] overflow-hidden">
                    <div className="border-b px-6 py-4">
                        <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                            Current Translation
                        </div>
                        <div className="max-h-32 overflow-y-auto rounded border bg-muted/20 p-3 text-sm leading-7">
                            {loading ? (
                                <span className="text-muted-foreground">Searching...</span>
                            ) : error ? (
                                <span className="text-destructive">{error}</span>
                            ) : segments.length > 0 ? (
                                segments.map((segment, index) => {
                                    if (!segment.chunk) return <span key={index}>{segment.text}</span>;
                                    const isSelected = selectedChunkIndex === segment.chunkIndex;
                                    return (
                                        <button
                                            key={index}
                                            type="button"
                                            className={`rounded px-1 py-0 text-left transition-colors ${
                                                isSelected
                                                    ? "bg-primary text-primary-foreground"
                                                    : "bg-primary/15 hover:bg-primary/25"
                                            }`}
                                            onClick={() =>
                                                setSelectedChunkIndex(
                                                    isSelected ? null : segment.chunkIndex ?? null
                                                )
                                            }
                                        >
                                            {segment.text}
                                        </button>
                                    );
                                })
                            ) : (
                                <span className="text-muted-foreground">
                                    No translated text to inspect.
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="overflow-y-auto px-6 py-4">
                        {loading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <i className="codicon codicon-loading codicon-modifier-spin" />
                                Checking project translations...
                            </div>
                        ) : error ? (
                            <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                                {error}
                            </div>
                        ) : !result || result.chunks.length === 0 ? (
                            <div className="rounded border p-4 text-sm text-muted-foreground">
                                No matching translated examples were found for this wording.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {selectedChunk && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedChunkIndex(null)}
                                    >
                                        Show all chunks
                                    </Button>
                                )}
                                {chunksToShow.map((chunk) => (
                                    <div
                                        key={`${chunk.startOffset}-${chunk.text}`}
                                        className="rounded border bg-background"
                                    >
                                        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                                            <div className="min-w-0">
                                                <div className="break-words text-sm font-medium">
                                                    {chunk.text}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                    <span>
                                                        {chunk.occurrences.length} matching cell
                                                        {chunk.occurrences.length === 1 ? "" : "s"}
                                                    </span>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 shrink-0 p-0"
                                                title="Search this wording in Parallel Passages"
                                                aria-label="Search this wording in Parallel Passages"
                                                onClick={() => onSearchChunk(chunk.text)}
                                            >
                                                <Search className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        <div className="divide-y">
                                            {chunk.occurrences.map((occurrence) => (
                                                <div
                                                    key={`${chunk.text}-${occurrence.cellId}`}
                                                    className="grid gap-2 px-4 py-3"
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-medium">
                                                                {getCellDisplayLabel({
                                                                    cellId: occurrence.cellId,
                                                                    cellLabel: occurrence.cellLabel,
                                                                })}
                                                            </div>
                                                            {occurrence.isValidated !== undefined && (
                                                                <Badge
                                                                    variant={
                                                                        occurrence.isValidated
                                                                            ? "secondary"
                                                                            : "outline"
                                                                    }
                                                                    className="mt-1"
                                                                >
                                                                    {occurrence.isValidated
                                                                        ? "Validated"
                                                                        : "Not validated"}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 w-8 shrink-0 p-0"
                                                            title="Pin this cell in Parallel Passages"
                                                            aria-label="Pin this cell in Parallel Passages"
                                                            onClick={() => onPinCell(occurrence.cellId)}
                                                        >
                                                            <Pin className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                    <div className="grid gap-1 text-sm">
                                                        <div className="break-words">
                                                            {occurrence.targetSnippet}
                                                        </div>
                                                        {occurrence.sourceSnippet && (
                                                            <div className="break-words text-xs text-muted-foreground">
                                                                {occurrence.sourceSnippet}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
