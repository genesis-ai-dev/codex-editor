import React, { useState } from "react";
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
    violationCount: number | null; // null = not scanned yet
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
    const [isExpanded, setIsExpanded] = useState(false);
    const isEffectivelyDisabled = focusModeEnabled || !standard.enabled;
    const hasBeenScanned = violationCount !== null;
    const hasViolations = !isEffectivelyDisabled && hasBeenScanned && violationCount > 0;

    // Get source label
    const getSourceLabel = () => {
        switch (standard.source) {
            case "org":
                return "Org";
            case "imported":
                return "Imported";
            case "auto-detected":
                return "Auto";
            default:
                return "Project";
        }
    };

    // Handle card click to expand/collapse
    const handleCardClick = (e: React.MouseEvent) => {
        // Don't expand if clicking on interactive elements
        if ((e.target as HTMLElement).closest("button, [role='switch'], a")) {
            return;
        }
        setIsExpanded(!isExpanded);
    };

    // Handle view violations click
    const handleViewViolations = (e: React.MouseEvent) => {
        e.stopPropagation();
        onViewViolations(standard.id);
    };

    // Get card border/background classes based on violation state
    const getCardClasses = () => {
        if (isEffectivelyDisabled) {
            return "opacity-60 bg-muted/30 border";
        }
        if (hasViolations) {
            return violationCount >= 10
                ? "border-2 border-red-500/50 bg-red-500/5"
                : "border-2 border-amber-500/50 bg-amber-500/5";
        }
        return "border bg-card hover:shadow-sm";
    };

    return (
        <div className={`rounded-lg transition-all ${getCardClasses()}`}>
            {/* Main card content - always visible */}
            <div className="p-3 cursor-pointer" onClick={handleCardClick}>
                <div className="flex items-center justify-between gap-3">
                    {/* Left side: description and metadata */}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{standard.description}</p>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                            <span>{getSourceLabel()}</span>
                            {isEffectivelyDisabled ? (
                                <>
                                    <span>•</span>
                                    <span className="italic">paused</span>
                                </>
                            ) : null}
                        </div>
                    </div>

                    {/* Right side: violation badge + toggle */}
                    <div className="flex items-center gap-3 shrink-0">
                        {/* Violation badge - only show when scanned */}
                        {!isEffectivelyDisabled && hasBeenScanned && (
                            <button
                                onClick={handleViewViolations}
                                className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                                    violationCount === 0
                                        ? "bg-green-500/20 text-green-700 dark:text-green-400 hover:bg-green-500/30"
                                        : violationCount < 10
                                        ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-500/30"
                                        : "bg-red-500/20 text-red-700 dark:text-red-400 hover:bg-red-500/30"
                                }`}
                            >
                                {violationCount}
                            </button>
                        )}
                        {/* Show dash when not scanned yet */}
                        {!isEffectivelyDisabled && !hasBeenScanned && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                                —
                            </span>
                        )}
                        <Switch
                            checked={standard.enabled}
                            onCheckedChange={(enabled) => {
                                onToggle(standard.id, enabled);
                            }}
                            disabled={focusModeEnabled}
                        />
                    </div>
                </div>
            </div>

            {/* Expandable details section */}
            {isExpanded && (
                <div className="px-3 pb-3 pt-0 border-t mt-0">
                    <div className="pt-3 space-y-3">
                        {/* Regex pattern */}
                        {standard.regexPattern && (
                            <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                    Pattern
                                </p>
                                <code className="text-xs bg-muted px-2 py-1 rounded font-mono block overflow-x-auto">
                                    /{standard.regexPattern}/gi
                                </code>
                            </div>
                        )}

                        {/* Citation */}
                        {standard.citation && (
                            <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                    Citation
                                </p>
                                <p className="text-sm">{standard.citation}</p>
                            </div>
                        )}

                        {/* Actions */}
                        {!isOrgStandard && (onEdit || onDelete) && (
                            <div className="flex items-center gap-2 pt-2">
                                {onEdit && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onEdit(standard);
                                        }}
                                    >
                                        <i className="codicon codicon-edit mr-1" />
                                        Edit
                                    </Button>
                                )}
                                {onDelete && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-destructive hover:text-destructive"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (
                                                confirm(
                                                    `Delete standard "${standard.description}"?`
                                                )
                                            ) {
                                                onDelete(standard.id);
                                            }
                                        }}
                                    >
                                        <i className="codicon codicon-trash mr-1" />
                                        Delete
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
