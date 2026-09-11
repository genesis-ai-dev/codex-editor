import React, { useMemo, useState } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { AlertTriangle, Copy, FilePlus2, RefreshCw } from "lucide-react";
import type {
    ReimportCandidate,
    ReimportCellChange,
    ReimportDecision,
    ReimportMode,
} from "types";
import { cn } from "../../lib/utils";

interface ReimportReviewStepProps {
    candidates: ReimportCandidate[];
    onConfirm: (decisions: ReimportDecision[]) => void;
    onCancel: () => void;
}

interface ModeOption {
    mode: ReimportMode;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string; }>;
}

const MODE_OPTIONS: ModeOption[] = [
    {
        mode: "copy",
        label: "Create new updated file",
        description:
            "Keep the existing file untouched and add a new copy that carries your translations and the changes below. The safest option.",
        icon: Copy,
    },
    {
        mode: "overwrite",
        label: "Rewrite the existing file",
        description:
            "Apply the changes to the existing file in place. Translations are kept, but the file's cells are rebuilt from this import.",
        icon: RefreshCw,
    },
    {
        mode: "new",
        label: "Import as a new file",
        description:
            "Ignore the existing file and import this as a separate, untranslated document.",
        icon: FilePlus2,
    },
];

const CHANGE_GROUPS: Array<{
    kind: ReimportCellChange["kind"];
    title: string;
    explanation: string;
}> = [
        {
            kind: "inserted",
            title: "New cells",
            explanation:
                "Added in place. Surrounding cells shift to make room; their translations are untouched.",
        },
        {
            kind: "updated",
            title: "Changed cells needing review",
            explanation:
                "The source content changed, so the existing translation may no longer line up. These are flagged in the editor and in milestone navigation until you resolve them.",
        },
        {
            kind: "removed",
            title: "Cells no longer in the document",
            explanation:
                "Hidden from the editor and from exports. Their content and history stay in the file, so nothing is lost permanently.",
        },
    ];

/** Compact "N cells" phrasing without the awkward "1 cells". */
const pluralizeCells = (count: number): string => `${count} cell${count === 1 ? "" : "s"}`;

/**
 * An update can touch thousands of cells. Rendering a row per cell locks the
 * webview up, so each pane renders a bounded window and says how many more
 * there are — the list is for judging the shape of the change, not for
 * reading every entry.
 */
const MAX_VISIBLE_ROWS = 150;

/**
 * A fixed-height scrolling list of changed cells. Always open: the counts are
 * the point of this step, and hiding them behind a disclosure made the step
 * feel empty and pushed the list over the whole screen when opened.
 */
const ChangePane: React.FC<{
    title: string;
    explanation: string;
    changes: ReimportCellChange[];
    tone: "warning" | "neutral";
}> = ({ title, explanation, changes, tone }) => {
    const translationCount = changes.filter((change) => change.hasTranslation).length;
    const visible = changes.slice(0, MAX_VISIBLE_ROWS);
    const hiddenCount = changes.length - visible.length;

    return (
        <div className="border rounded-md flex flex-col min-w-0">
            <div className="p-3 border-b">
                <div className="flex items-center gap-2 flex-wrap">
                    {tone === "warning" && (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--vscode-editorWarning-foreground)]" />
                    )}
                    <span className="font-medium text-sm">{title}</span>
                    <Badge variant={tone === "warning" ? "default" : "secondary"}>
                        {changes.length}
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{explanation}</p>
                {translationCount > 0 && (
                    <p className="text-xs mt-1 text-[var(--vscode-editorWarning-foreground)]">
                        {translationCount} already translated — verify {translationCount === 1 ? "it" : "them"} after importing.
                    </p>
                )}
            </div>

            {/* Plain overflow container rather than a ScrollArea: this needs a
                hard height so the pane scrolls instead of growing the page. */}
            <div className="h-56 overflow-y-auto">
                {changes.length === 0 ? (
                    <p className="p-3 text-xs text-muted-foreground">None.</p>
                ) : (
                    <ul className="divide-y">
                        {visible.map((change, index) => (
                            <li
                                key={`${change.cellId}-${index}`}
                                className="px-3 py-2 flex items-start gap-2 text-xs"
                            >
                                {change.milestone && (
                                    <Badge variant="outline" className="shrink-0 font-mono text-xs">
                                        {change.milestone}
                                    </Badge>
                                )}
                                <span className="flex-1 min-w-0 break-words text-muted-foreground">
                                    {change.preview || <em>(empty)</em>}
                                </span>
                                {change.hasTranslation && (
                                    <Badge variant="secondary" className="shrink-0 text-xs">
                                        translated
                                    </Badge>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {hiddenCount > 0 && (
                <p className="px-3 py-2 border-t text-xs text-muted-foreground">
                    Showing the first {visible.length} of {changes.length}.
                </p>
            )}
        </div>
    );
};

const CandidateCard: React.FC<{
    candidate: ReimportCandidate;
    decision: ReimportDecision;
    onChange: (decision: ReimportDecision) => void;
}> = ({ candidate, decision, onChange }) => {
    const { options } = candidate;
    const selectedOption =
        options.find((option) => option.notebookBaseName === decision.notebookBaseName) ?? options[0];
    const stats = selectedOption?.stats ?? candidate.stats;
    const changes = selectedOption?.changes ?? candidate.changes;

    const grouped = useMemo(() => {
        const byKind = new Map<ReimportCellChange["kind"], ReimportCellChange[]>();
        for (const change of changes) {
            const list = byKind.get(change.kind);
            if (list) {
                list.push(change);
            } else {
                byKind.set(change.kind, [change]);
            }
        }
        return CHANGE_GROUPS.map((group) => ({
            ...group,
            changes: byKind.get(group.kind) ?? [],
        }));
    }, [changes]);
    const [inserted, updated, removed] = grouped;

    const matchDescription =
        options.length > 1
            ? `"${candidate.fileName}" is already in the project more than once. Pick which import to use as the base — the updated copy will take its translations.`
            : candidate.matchedBy === "content"
                ? `"${candidate.fileName}" was already imported as "${selectedOption.displayName}".`
                : `"${candidate.fileName}" looks like a newer version of "${selectedOption.displayName}" — its content has changed since it was imported.`;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{candidate.fileName}</CardTitle>
                <CardDescription>{matchDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {options.length > 1 && (
                    <div className="space-y-2">
                        <h4 className="text-sm font-medium">
                            Which existing import should we copy from?
                        </h4>
                        <p className="text-xs text-muted-foreground">
                            Choose by the name you see in the project. The copy keeps that file&apos;s translations and adds any new cells as blanks.
                        </p>
                        {options.map((option) => {
                            const isSelected =
                                option.notebookBaseName === selectedOption.notebookBaseName;
                            return (
                                <button
                                    key={option.notebookBaseName}
                                    type="button"
                                    onClick={() =>
                                        onChange({
                                            ...decision,
                                            notebookBaseName: option.notebookBaseName,
                                        })
                                    }
                                    className={cn(
                                        "w-full flex items-center justify-between gap-3 p-3 rounded-md border text-left transition-colors",
                                        isSelected
                                            ? "border-primary bg-primary/5"
                                            : "hover:bg-muted/50",
                                    )}
                                    aria-pressed={isSelected}
                                >
                                    <span className="font-medium text-sm min-w-0 break-words">
                                        {option.displayName}
                                    </span>
                                    <Badge
                                        variant={option.translationCount > 0 ? "default" : "secondary"}
                                        className="shrink-0"
                                    >
                                        {option.translationCount} translated
                                    </Badge>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* What the update would do, so the choice below is informed. */}
                <div className="space-y-2">
                    <h4 className="text-sm font-medium">What this import changes</h4>
                    <p className="text-sm text-muted-foreground">
                        {pluralizeCells(stats.matchedCells)} matched the existing file and{" "}
                        {stats.translationsCarried} translation
                        {stats.translationsCarried === 1 ? "" : "s"} carry over.
                    </p>
                    {changes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Nothing changes — the cells in this file already match the import.
                        </p>
                    ) : (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <ChangePane
                                    title={inserted.title}
                                    explanation={inserted.explanation}
                                    changes={inserted.changes}
                                    tone="neutral"
                                />
                                <ChangePane
                                    title={updated.title}
                                    explanation={updated.explanation}
                                    changes={updated.changes}
                                    tone="warning"
                                />
                            </div>
                            {removed.changes.length > 0 && (
                                <ChangePane
                                    title={removed.title}
                                    explanation={removed.explanation}
                                    changes={removed.changes}
                                    tone="neutral"
                                />
                            )}
                        </>
                    )}
                    {stats.droppedTranslations > 0 && (
                        <p className="text-sm text-[var(--vscode-editorWarning-foreground)] flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                            <span>
                                {pluralizeCells(stats.droppedTranslations)} that hold a translation
                                are no longer in the document. Choosing "Create new updated file"
                                leaves the current file untouched so you can still get to them.
                            </span>
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <h4 className="text-sm font-medium">How should we import it?</h4>
                    {MODE_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const isSelected = decision.mode === option.mode;
                        return (
                            <button
                                key={option.mode}
                                type="button"
                                onClick={() => onChange({ ...decision, mode: option.mode })}
                                className={cn(
                                    "w-full flex items-start gap-3 p-3 rounded-md border text-left transition-colors",
                                    isSelected
                                        ? "border-primary bg-primary/5"
                                        : "hover:bg-muted/50",
                                )}
                                aria-pressed={isSelected}
                            >
                                <Icon
                                    className={cn(
                                        "h-5 w-5 mt-0.5 shrink-0",
                                        isSelected ? "text-primary" : "text-muted-foreground",
                                    )}
                                />
                                <div className="min-w-0">
                                    <div className="font-medium text-sm">{option.label}</div>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {option.description}
                                    </p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
};

/**
 * Review step for files that are already in the project. Shows what an update
 * would do to each one, then lets the user pick between updating a copy,
 * rewriting the existing file, or importing separately.
 */
export const ReimportReviewStep: React.FC<ReimportReviewStepProps> = ({
    candidates,
    onConfirm,
    onCancel,
}) => {
    // Default to the non-destructive option for every candidate.
    const [decisions, setDecisions] = useState<Record<number, ReimportDecision>>(() =>
        Object.fromEntries(
            candidates.map((candidate) => [
                candidate.pairIdx,
                {
                    pairIdx: candidate.pairIdx,
                    mode: "copy" as ReimportMode,
                    notebookBaseName: candidate.options[0]?.notebookBaseName,
                },
            ]),
        ),
    );

    const totalFlagged = candidates.reduce((total, candidate) => {
        const decision = decisions[candidate.pairIdx];
        if (!decision || decision.mode === "new") return total;
        const selected =
            candidate.options.find(
                (option) => option.notebookBaseName === decision.notebookBaseName,
            ) ?? candidate.options[0];
        return total + (selected?.stats.flaggedCells ?? candidate.stats.flaggedCells);
    }, 0);

    return (
        <div className="container mx-auto p-6 max-w-5xl">
            <div className="text-center space-y-2 mb-8">
                <h1 className="text-3xl font-bold">Already imported</h1>
                <p className="text-lg text-muted-foreground">
                    {candidates.length === 1
                        ? "This file is already in your project. Choose what to do with it."
                        : `${candidates.length} of these files are already in your project. Choose what to do with each.`}
                </p>
            </div>

            <div className="space-y-6">
                {candidates.map((candidate) => (
                    <CandidateCard
                        key={candidate.pairIdx}
                        candidate={candidate}
                        decision={decisions[candidate.pairIdx]}
                        onChange={(decision) =>
                            setDecisions((previous) => ({
                                ...previous,
                                [candidate.pairIdx]: decision,
                            }))
                        }
                    />
                ))}
            </div>

            {totalFlagged > 0 && (
                <p className="mt-6 text-sm text-muted-foreground flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--vscode-editorWarning-foreground)]" />
                    <span>
                        {pluralizeCells(totalFlagged)} will be flagged for review. Milestone
                        navigation marks the sections that contain them so you can find them.
                    </span>
                </p>
            )}

            <div className="flex justify-end gap-2 mt-8">
                <Button variant="ghost" onClick={onCancel}>
                    Cancel import
                </Button>
                <Button onClick={() => onConfirm(Object.values(decisions))}>Continue</Button>
            </div>
        </div>
    );
};
