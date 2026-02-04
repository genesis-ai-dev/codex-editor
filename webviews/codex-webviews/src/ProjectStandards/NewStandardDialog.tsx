import React, { useState, useEffect, useRef } from "react";
import { Button } from "../components/ui/button";

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

interface NewStandardDialogProps {
    standard?: ProjectStandard;
    onClose: () => void;
    onSave: (standard: Omit<ProjectStandard, "id" | "createdAt" | "updatedAt">) => void;
    onGenerateRegex: (description: string, examples: string[]) => void;
    onTestRegex: (pattern: string) => void;
}

export const NewStandardDialog: React.FC<NewStandardDialogProps> = ({
    standard,
    onClose,
    onSave,
    onGenerateRegex,
    onTestRegex,
}) => {
    const isEditing = !!standard;

    // Form state - simplified
    const [description, setDescription] = useState(standard?.description || "");
    const [examplesText, setExamplesText] = useState(standard?.examples?.join("\n") || "");

    // Advanced state (only shown when editing or via disclosure)
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [regexPattern, setRegexPattern] = useState(standard?.regexPattern || "");
    const [citation, setCitation] = useState(standard?.citation || "");

    // UI state
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Track if we're waiting for regex generation
    const pendingSaveRef = useRef(false);

    // Listen for regex generation results
    useEffect(() => {
        const handleRegexGenerated = (event: CustomEvent) => {
            if (event.detail.error) {
                setError(event.detail.error);
                setIsCreating(false);
                pendingSaveRef.current = false;
            } else {
                // Regex generated successfully, now save
                const generatedPattern = event.detail.pattern;
                if (pendingSaveRef.current) {
                    pendingSaveRef.current = false;
                    saveStandard(generatedPattern);
                }
            }
        };

        window.addEventListener("regexGenerated", handleRegexGenerated as EventListener);

        return () => {
            window.removeEventListener("regexGenerated", handleRegexGenerated as EventListener);
        };
    }, [description, examplesText, citation]);

    // Parse examples from textarea (one per line)
    const parseExamples = (text: string): string[] => {
        return text
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    };

    // Save with a specific regex pattern
    const saveStandard = (pattern: string) => {
        onSave({
            description: description.trim(),
            regexPattern: pattern,
            standardType: "regex-pattern",
            source: standard?.source || "manual",
            enabled: true,
            examples: parseExamples(examplesText),
            citation: citation.trim() || undefined,
        });
        setIsCreating(false);
    };

    // Handle create/update
    const handleSave = () => {
        if (!description.trim()) {
            setError("Please describe what this standard should check");
            return;
        }

        setError(null);
        const examples = parseExamples(examplesText);

        // If editing and regex already exists, or if advanced is shown with a manual regex, use it
        if (regexPattern.trim()) {
            // Validate the regex
            try {
                new RegExp(regexPattern, "gi");
            } catch (e) {
                setError(`Invalid regex pattern: ${(e as Error).message}`);
                return;
            }
            saveStandard(regexPattern.trim());
            return;
        }

        // Need to generate regex from examples
        if (examples.length === 0) {
            setError("Please provide examples of text that breaks this rule");
            return;
        }

        // Start generating regex
        setIsCreating(true);
        pendingSaveRef.current = true;
        onGenerateRegex(description, examples);
    };

    const canSave = description.trim().length > 0;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-background rounded-lg shadow-xl max-w-lg w-full flex flex-col">
                {/* Header */}
                <div className="p-4 border-b flex items-center justify-between">
                    <h2 className="text-lg font-semibold">
                        {isEditing ? "Edit Standard" : "New Standard"}
                    </h2>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        <i className="codicon codicon-close" />
                    </Button>
                </div>

                {/* Form */}
                <div className="flex-1 overflow-auto p-4 space-y-4">
                    {/* What should this check? */}
                    <div>
                        <label className="block text-sm font-medium mb-1.5">
                            What should this check?
                        </label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 border rounded-md bg-background"
                            placeholder="Use 'LORD' (all caps) for YHWH"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            autoFocus
                        />
                    </div>

                    {/* Examples of violations */}
                    <div>
                        <label className="block text-sm font-medium mb-1.5">
                            Examples of violations
                        </label>
                        <textarea
                            className="w-full px-3 py-2 border rounded-md bg-background min-h-[100px] resize-y"
                            placeholder="Paste examples of text that breaks this rule (one per line)"
                            value={examplesText}
                            onChange={(e) => setExamplesText(e.target.value)}
                        />
                    </div>

                    {/* Advanced disclosure */}
                    <div>
                        <button
                            type="button"
                            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                        >
                            <i
                                className={`codicon codicon-chevron-${
                                    showAdvanced ? "down" : "right"
                                } text-xs`}
                            />
                            Advanced
                        </button>

                        {showAdvanced && (
                            <div className="mt-3 space-y-3 pl-4 border-l-2 border-muted">
                                {/* Regex Pattern */}
                                <div>
                                    <label className="block text-xs font-medium mb-1 text-muted-foreground">
                                        Regex Pattern (auto-generated if empty)
                                    </label>
                                    <div className="flex items-center">
                                        <span className="px-2 py-1.5 border border-r-0 rounded-l-md bg-muted text-muted-foreground font-mono text-sm">
                                            /
                                        </span>
                                        <input
                                            type="text"
                                            className="flex-1 px-2 py-1.5 border-y border-r-0 bg-background font-mono text-sm"
                                            placeholder="auto-generated"
                                            value={regexPattern}
                                            onChange={(e) => setRegexPattern(e.target.value)}
                                        />
                                        <span className="px-2 py-1.5 border rounded-r-md bg-muted text-muted-foreground font-mono text-sm">
                                            /gi
                                        </span>
                                    </div>
                                </div>

                                {/* Citation */}
                                <div>
                                    <label className="block text-xs font-medium mb-1 text-muted-foreground">
                                        Citation (optional)
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full px-3 py-1.5 border rounded-md bg-background text-sm"
                                        placeholder="e.g., Style Guide p.4"
                                        value={citation}
                                        onChange={(e) => setCitation(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Error message */}
                    {error && <p className="text-sm text-red-500">{error}</p>}
                </div>

                {/* Footer */}
                <div className="p-4 border-t flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={onClose} disabled={isCreating}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!canSave || isCreating}>
                        {isCreating ? (
                            <>
                                <i className="codicon codicon-sync codicon-modifier-spin mr-2" />
                                Creating...
                            </>
                        ) : (
                            <>{isEditing ? "Update" : "Create"} Standard</>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
};
