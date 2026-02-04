import React, { useState, useMemo } from "react";
import { Button } from "../components/ui/button";

interface ProjectStandard {
    id: string;
    description: string;
    regexPattern: string;
    standardType: string;
    source: string;
    enabled: boolean;
}

interface StandardViolation {
    cellId: string;
    fileUri: string;
    cellValue: string;
    matchText: string;
    lineNumber?: number;
    globalReferences?: string[];
}

interface ViolationListProps {
    standard: ProjectStandard;
    violations: StandardViolation[];
    onClose: () => void;
    onJumpToCell: (violation: StandardViolation) => void;
}

const ITEMS_PER_PAGE = 50;

export const ViolationList: React.FC<ViolationListProps> = ({
    standard,
    violations,
    onClose,
    onJumpToCell,
}) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [searchTerm, setSearchTerm] = useState("");

    // Filter violations by search term
    const filteredViolations = useMemo(() => {
        if (!searchTerm.trim()) return violations;

        const term = searchTerm.toLowerCase();
        return violations.filter(
            (v) =>
                v.matchText.toLowerCase().includes(term) ||
                v.cellValue.toLowerCase().includes(term) ||
                v.fileUri.toLowerCase().includes(term) ||
                v.globalReferences?.some((ref) => ref.toLowerCase().includes(term))
        );
    }, [violations, searchTerm]);

    // Paginate
    const totalPages = Math.ceil(filteredViolations.length / ITEMS_PER_PAGE);
    const paginatedViolations = filteredViolations.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    // Extract filename from path
    const getFileName = (fileUri: string): string => {
        const parts = fileUri.split(/[/\\]/);
        return parts[parts.length - 1] || fileUri;
    };

    // Highlight match in text
    const highlightMatch = (text: string, match: string): React.ReactNode => {
        if (!match) return text;

        const index = text.toLowerCase().indexOf(match.toLowerCase());
        if (index === -1) return text;

        const before = text.slice(0, index);
        const matched = text.slice(index, index + match.length);
        const after = text.slice(index + match.length);

        return (
            <>
                {before}
                <mark className="bg-yellow-300 dark:bg-yellow-600 px-0.5 rounded">{matched}</mark>
                {after}
            </>
        );
    };

    // Truncate text with ellipsis
    const truncateText = (text: string, maxLength: number): string => {
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + "...";
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-background rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="p-4 border-b flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">Violations</h2>
                        <p className="text-sm text-muted-foreground truncate max-w-md">
                            {standard.description}
                        </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        <i className="codicon codicon-close" />
                    </Button>
                </div>

                {/* Search and stats */}
                <div className="p-4 border-b flex items-center gap-4">
                    <div className="relative flex-1">
                        <i className="codicon codicon-search absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search violations..."
                            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background"
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setCurrentPage(1);
                            }}
                        />
                    </div>
                    <div className="text-sm text-muted-foreground whitespace-nowrap">
                        {filteredViolations.length} violation
                        {filteredViolations.length !== 1 ? "s" : ""}
                        {searchTerm && filteredViolations.length !== violations.length && (
                            <span> (filtered from {violations.length})</span>
                        )}
                    </div>
                </div>

                {/* Violation list */}
                <div className="flex-1 overflow-auto p-2">
                    {paginatedViolations.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                            {violations.length === 0
                                ? "No violations found"
                                : "No violations match your search"}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {paginatedViolations.map((violation, index) => (
                                <div
                                    key={`${violation.cellId}-${index}`}
                                    className="border rounded-md p-3 hover:bg-muted/50 transition-colors cursor-pointer group"
                                    onClick={() => onJumpToCell(violation)}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            {/* File info */}
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                                <i className="codicon codicon-file" />
                                                <span className="truncate">
                                                    {getFileName(violation.fileUri)}
                                                </span>
                                                {violation.lineNumber !== undefined && (
                                                    <>
                                                        <span>•</span>
                                                        <span>Line {violation.lineNumber}</span>
                                                    </>
                                                )}
                                                {violation.globalReferences &&
                                                    violation.globalReferences.length > 0 && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="text-primary">
                                                                {violation.globalReferences[0]}
                                                            </span>
                                                        </>
                                                    )}
                                            </div>

                                            {/* Match text */}
                                            <div className="text-sm font-medium mb-1">
                                                Match:{" "}
                                                <code className="bg-red-500/10 text-red-600 dark:text-red-400 px-1 py-0.5 rounded text-xs">
                                                    {violation.matchText}
                                                </code>
                                            </div>

                                            {/* Cell value preview */}
                                            <p className="text-sm text-muted-foreground line-clamp-2">
                                                {highlightMatch(
                                                    truncateText(
                                                        violation.cellValue.replace(/<[^>]*>/g, ""),
                                                        200
                                                    ),
                                                    violation.matchText
                                                )}
                                            </p>
                                        </div>

                                        {/* Jump button */}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onJumpToCell(violation);
                                            }}
                                        >
                                            <i className="codicon codicon-go-to-file mr-1" />
                                            Go to cell
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="p-4 border-t flex items-center justify-between">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                        >
                            <i className="codicon codicon-chevron-left mr-1" />
                            Previous
                        </Button>
                        <span className="text-sm text-muted-foreground">
                            Page {currentPage} of {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                        >
                            Next
                            <i className="codicon codicon-chevron-right ml-1" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
