import React from "react";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";

interface ProjectStandard {
    id: string;
    description: string;
    regexPattern: string;
    standardType: string;
    source: "org" | "project" | "imported" | "manual" | "auto-detected";
    enabled: boolean;
    violationCount?: number;
    lastScannedAt?: number;
    examples?: string[];
    createdAt: number;
    updatedAt: number;
    createdBy?: string;
    citation?: string;
}

interface StandardCardProps {
    standard: ProjectStandard;
    violationCount: number;
    focusModeEnabled: boolean;
    onToggle: (standardId: string, enabled: boolean) => void;
    onEdit?: (standard: ProjectStandard) => void;
    onDelete?: (standardId: string) => void;
    onViewViolations: (standardId: string) => void;
    isOrgStandard?: boolean;
}

export const StandardCard: React.FC<StandardCardProps> = ({
    standard,
    violationCount,
    focusModeEnabled,
    onToggle,
    onEdit,
    onDelete,
    onViewViolations,
    isOrgStandard = false,
}) => {
    const isSupported = standard.standardType === "regex-pattern";
    const isEffectivelyDisabled = focusModeEnabled || !standard.enabled;

    // Determine violation badge color
    const getViolationBadge = () => {
        if (focusModeEnabled || !standard.enabled) {
            return (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    —
                </span>
            );
        }

        if (!isSupported) {
            return (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    N/A
                </span>
            );
        }

        if (violationCount === 0) {
            return (
                <button
                    className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-600 dark:text-green-400 hover:bg-green-500/30 transition-colors"
                    onClick={() => onViewViolations(standard.id)}
                >
                    🟢 0
                </button>
            );
        }

        if (violationCount < 10) {
            return (
                <button
                    className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30 transition-colors"
                    onClick={() => onViewViolations(standard.id)}
                >
                    🟡 {violationCount}
                </button>
            );
        }

        return (
            <button
                className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/30 transition-colors"
                onClick={() => onViewViolations(standard.id)}
            >
                🔴 {violationCount}
            </button>
        );
    };

    // Get source badge
    const getSourceBadge = () => {
        switch (standard.source) {
            case "org":
                return (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Org
                    </span>
                );
            case "imported":
                return (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600 dark:text-blue-400">
                        Imported
                    </span>
                );
            case "auto-detected":
                return (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-600 dark:text-purple-400">
                        Auto
                    </span>
                );
            default:
                return (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        Manual
                    </span>
                );
        }
    };

    // Get type badge
    const getTypeBadge = () => {
        if (standard.standardType === "regex-pattern") {
            return (
                <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                    Regex
                </span>
            );
        }

        return (
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-dashed">
                {standard.standardType.replace(/-/g, " ")}
                <span className="ml-1 text-[10px]">(Phase 2+)</span>
            </span>
        );
    };

    return (
        <div
            className={`border rounded-lg p-3 transition-all ${
                isEffectivelyDisabled ? "opacity-60 bg-muted/30" : "bg-card hover:shadow-sm"
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                {/* Main content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium truncate">{standard.description}</p>
                    </div>

                    {/* Badges row */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {getSourceBadge()}
                        {getTypeBadge()}
                        {standard.citation && (
                            <span
                                className="text-xs text-muted-foreground truncate max-w-[150px]"
                                title={standard.citation}
                            >
                                📖 {standard.citation}
                            </span>
                        )}
                    </div>

                    {/* Regex pattern preview (collapsed) */}
                    {standard.regexPattern && isSupported && (
                        <div className="mt-2">
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground truncate block max-w-full">
                                /{standard.regexPattern}/gi
                            </code>
                        </div>
                    )}

                    {/* Not supported message */}
                    {!isSupported && (
                        <div className="mt-2 text-xs text-muted-foreground italic">
                            This standard type is not supported in Phase 1
                        </div>
                    )}
                </div>

                {/* Actions column */}
                <div className="flex items-center gap-2 shrink-0">
                    {/* Violation count */}
                    {getViolationBadge()}

                    {/* Toggle switch */}
                    <Switch
                        checked={standard.enabled}
                        onCheckedChange={(enabled) => onToggle(standard.id, enabled)}
                        disabled={focusModeEnabled}
                    />

                    {/* Edit/Delete buttons (only for non-org standards) */}
                    {!isOrgStandard && (
                        <div className="flex items-center gap-1">
                            {onEdit && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0"
                                    onClick={() => onEdit(standard)}
                                    title="Edit standard"
                                >
                                    <i className="codicon codicon-edit" />
                                </Button>
                            )}
                            {onDelete && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                    onClick={() => {
                                        if (confirm(`Delete standard "${standard.description}"?`)) {
                                            onDelete(standard.id);
                                        }
                                    }}
                                    title="Delete standard"
                                >
                                    <i className="codicon codicon-trash" />
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
