import React, { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Badge } from "../components/ui/badge";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../components/ui/select";
import { Check, ChevronsUpDown, Loader2, AlertCircle } from "lucide-react";
import { cn } from "../lib/utils";
import type { CodexMigrationMatchMode, MigrationMatchResult } from "types";

declare const vscode: {
    postMessage: (message: unknown) => void;
    getState: () => Record<string, unknown> | undefined;
    setState: (state: unknown) => void;
};

type SourceFileUIData = {
    path: string;
    id: string;
    name: string;
};

type MigrationSummary = {
    matched: number;
    skipped: number;
};

type AppState = {
    targetFiles: SourceFileUIData[];
    fromFilePath: string;
    toFilePath: string;
    matchMode: CodexMigrationMatchMode;
    forceOverride: boolean;
    fromStartLine: number;
    toStartLine: number;
    maxCells: string;
    results: MigrationMatchResult[];
    summary: MigrationSummary | null;
    isLoading: boolean;
    errorMessage: string | null;
};

const MATCH_MODE_LABELS: Record<CodexMigrationMatchMode, string> = {
    globalReferences: "Match Global References",
    timestamps: "Match Timestamps",
    sequential: "Match Sequential Source Lines",
    lineNumber: "Match Line Numbers (Skip Child/Paratext)",
};

/** Searchable file combobox using shadcn Popover + Button + Input. */
const FileCombobox: React.FC<{
    files: SourceFileUIData[];
    value: string;
    onChange: (path: string) => void;
    placeholder: string;
}> = ({ files, value, onChange, placeholder }) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        const sortedFiles = files.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
        if (!search.trim()) return sortedFiles;
        const lower = search.toLowerCase();
        return files.filter(
            (f) => f.name.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower)
        );
    }, [files, search]);

    const selectedFile = useMemo(() => files.find((f) => f.path === value), [files, value]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={files.length === 0}
                    className="w-full justify-between font-normal"
                >
                    <span className={cn("truncate", !selectedFile && "text-muted-foreground")}>
                        {selectedFile ? selectedFile.name : placeholder}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <div className="p-2 border-b">
                    <Input
                        placeholder="Search files..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8"
                        autoFocus
                    />
                </div>
                <div className="max-h-60 overflow-y-auto py-1">
                    {filtered.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                            No files found
                        </div>
                    ) : (
                        filtered.map((f) => (
                            <div
                                key={f.path}
                                onClick={() => {
                                    onChange(f.path);
                                    setOpen(false);
                                    setSearch("");
                                }}
                                className={cn(
                                    "flex items-center px-3 py-1.5 text-sm cursor-pointer transition-colors",
                                    value === f.path
                                        ? "bg-accent text-accent-foreground"
                                        : "hover:bg-accent/50"
                                )}
                            >
                                <Check
                                    className={cn(
                                        "mr-2 h-4 w-4 shrink-0",
                                        value === f.path ? "opacity-100" : "opacity-0"
                                    )}
                                />
                                <span className="truncate">{f.name}</span>
                            </div>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};

const App: React.FC = () => {
    const [state, setState] = useState<AppState>(() => {
        const persisted = vscode.getState();
        return {
            targetFiles: (persisted?.targetFiles as SourceFileUIData[]) || [],
            fromFilePath: (persisted?.fromFilePath as string) || "",
            toFilePath: (persisted?.toFilePath as string) || "",
            matchMode: (persisted?.matchMode as CodexMigrationMatchMode) || "globalReferences",
            forceOverride: (persisted?.forceOverride as boolean) || false,
            fromStartLine: (persisted?.fromStartLine as number) || 1,
            toStartLine: (persisted?.toStartLine as number) || 1,
            maxCells: (persisted?.maxCells as string) || "",
            results: (persisted?.results as MigrationMatchResult[]) || [],
            summary: (persisted?.summary as MigrationSummary) || null,
            isLoading: false,
            errorMessage: null,
        };
    });

    useEffect(() => {
        vscode.setState(state);
    }, [state]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "initialData":
                    setState((prev) => ({
                        ...prev,
                        targetFiles: message.targetFiles || [],
                    }));
                    break;
                case "setLoading":
                    setState((prev) => ({
                        ...prev,
                        isLoading: Boolean(message.isLoading),
                    }));
                    break;
                case "showError":
                    setState((prev) => ({
                        ...prev,
                        errorMessage: message.error || "Unknown error",
                    }));
                    break;
                case "migrationResults":
                    setState((prev) => ({
                        ...prev,
                        results: message.results || [],
                        summary: message.summary || null,
                        errorMessage: null,
                    }));
                    break;
            }
        };
        window.addEventListener("message", handleMessage);
        vscode.postMessage({ command: "requestInitialData" });
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const canRunMigration = useMemo(
        () => Boolean(state.fromFilePath && state.toFilePath && !state.isLoading),
        [state.fromFilePath, state.toFilePath, state.isLoading]
    );

    const handleRunMigration = () => {
        const data: Record<string, unknown> = {
            fromFilePath: state.fromFilePath,
            toFilePath: state.toFilePath,
            matchMode: state.matchMode,
            forceOverride: state.forceOverride,
        };
        if (state.matchMode === "lineNumber") {
            data.fromStartLine = state.fromStartLine;
            data.toStartLine = state.toStartLine;
            const parsedMax = parseInt(state.maxCells, 10);
            if (Number.isFinite(parsedMax) && parsedMax > 0) {
                data.maxCells = parsedMax;
            }
        }
        vscode.postMessage({ command: "runMigration", data });
    };

    const visibleResults = state.results.slice(0, 200);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="max-w-3xl mx-auto p-6 flex flex-col gap-6">
                {/* Header */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-xl">Codex Migration Tool</CardTitle>
                        <CardDescription>
                            Migrate edits, validations, and values from one codex file to another
                            using the selected matching mode.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        {/* From file */}
                        <div className="space-y-1.5">
                            <Label htmlFor="fromFile">From Codex File</Label>
                            <FileCombobox
                                files={state.targetFiles}
                                value={state.fromFilePath}
                                onChange={(path) =>
                                    setState((prev) => ({ ...prev, fromFilePath: path }))
                                }
                                placeholder="Select source codex file..."
                            />
                        </div>

                        {/* To file */}
                        <div className="space-y-1.5">
                            <Label htmlFor="toFile">To Codex File</Label>
                            <FileCombobox
                                files={state.targetFiles}
                                value={state.toFilePath}
                                onChange={(path) =>
                                    setState((prev) => ({ ...prev, toFilePath: path }))
                                }
                                placeholder="Select target codex file..."
                            />
                        </div>

                        {/* Matching mode */}
                        <div className="space-y-1.5">
                            <Label htmlFor="matchMode">Matching Mode</Label>
                            <Select
                                value={state.matchMode}
                                onValueChange={(val) =>
                                    setState((prev) => ({
                                        ...prev,
                                        matchMode: val as CodexMigrationMatchMode,
                                    }))
                                }
                            >
                                <SelectTrigger className="w-full" id="matchMode">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(MATCH_MODE_LABELS).map(([mode, label]) => (
                                        <SelectItem key={mode} value={mode}>
                                            {label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Start-line fields (lineNumber mode only) */}
                        {state.matchMode === "lineNumber" && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="fromStartLine">From Start Line</Label>
                                    <Input
                                        id="fromStartLine"
                                        type="number"
                                        min={1}
                                        value={state.fromStartLine}
                                        onChange={(e) => {
                                            const parsed = parseInt(e.target.value, 10);
                                            setState((prev) => ({
                                                ...prev,
                                                fromStartLine:
                                                    Number.isFinite(parsed) && parsed >= 1
                                                        ? parsed
                                                        : 1,
                                            }));
                                        }}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Line in source file to start migrating from
                                    </p>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="toStartLine">To Start Line</Label>
                                    <Input
                                        id="toStartLine"
                                        type="number"
                                        min={1}
                                        value={state.toStartLine}
                                        onChange={(e) => {
                                            const parsed = parseInt(e.target.value, 10);
                                            setState((prev) => ({
                                                ...prev,
                                                toStartLine:
                                                    Number.isFinite(parsed) && parsed >= 1
                                                        ? parsed
                                                        : 1,
                                            }));
                                        }}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Line in target file to start migrating into
                                    </p>
                                </div>
                            </div>
                        )}

                        {state.matchMode === "lineNumber" && (
                            <div className="space-y-1.5">
                                <Label htmlFor="maxCells">Max Cells to Migrate</Label>
                                <Input
                                    id="maxCells"
                                    type="number"
                                    min={1}
                                    placeholder="No limit"
                                    value={state.maxCells}
                                    onChange={(e) =>
                                        setState((prev) => ({
                                            ...prev,
                                            maxCells: e.target.value,
                                        }))
                                    }
                                />
                                <p className="text-xs text-muted-foreground">
                                    Leave empty to migrate all matching cells, or set a number to
                                    cap how many cells are migrated
                                </p>
                            </div>
                        )}

                        {/* Force override checkbox */}
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="forceOverride"
                                checked={state.forceOverride}
                                onCheckedChange={(checked) =>
                                    setState((prev) => ({
                                        ...prev,
                                        forceOverride: checked === true,
                                    }))
                                }
                            />
                            <Label htmlFor="forceOverride" className="cursor-pointer">
                                Force migrated edits to supersede existing content
                            </Label>
                        </div>

                        {/* Action row */}
                        <div className="flex items-center gap-3 pt-1">
                            <Button onClick={handleRunMigration} disabled={!canRunMigration}>
                                {state.isLoading && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Run Migration
                            </Button>
                        </div>

                        {/* Error banner */}
                        {state.errorMessage && (
                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>{state.errorMessage}</AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>

                <Separator />

                {/* Results panel */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Migration Results</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        {state.summary ? (
                            <div className="flex flex-wrap gap-2">
                                <Badge variant="secondary">Matched: {state.summary.matched}</Badge>
                                <Badge variant="outline">Skipped: {state.summary.skipped}</Badge>
                                <Badge variant="outline">Total: {state.results.length}</Badge>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">No migration run yet.</p>
                        )}

                        {visibleResults.length > 0 && (
                            <div className="max-h-96 overflow-y-auto">
                                <div className="flex flex-col gap-1">
                                    <div className="grid grid-cols-[1fr_1fr_2fr] gap-3 text-xs text-muted-foreground uppercase font-semibold sticky top-0 bg-card py-1">
                                        <span>From Cell</span>
                                        <span>To Cell</span>
                                        <span>Source Line</span>
                                    </div>
                                    {visibleResults.map((result) => (
                                        <div
                                            className="grid grid-cols-[1fr_1fr_2fr] gap-3 text-xs"
                                            key={`${result.fromCellId}-${result.toCellId}`}
                                        >
                                            <span className="truncate">{result.fromCellId}</span>
                                            <span className="truncate">{result.toCellId}</span>
                                            <span className="truncate text-muted-foreground">
                                                {result.reason || ""}
                                            </span>
                                        </div>
                                    ))}
                                    {state.results.length > visibleResults.length && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Showing first {visibleResults.length} results.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default App;
