import React, { useState, useEffect, useCallback } from "react";
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

    // Form state
    const [description, setDescription] = useState(standard?.description || "");
    const [regexPattern, setRegexPattern] = useState(standard?.regexPattern || "");
    const [standardType, setStandardType] = useState(standard?.standardType || "regex-pattern");
    const [examples, setExamples] = useState<string[]>(standard?.examples || [""]);
    const [citation, setCitation] = useState(standard?.citation || "");
    const [enabled, setEnabled] = useState(standard?.enabled ?? true);

    // UI state
    const [isGenerating, setIsGenerating] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<{ matches: string[]; count: number } | null>(
        null
    );
    const [regexError, setRegexError] = useState<string | null>(null);

    // Listen for regex generation and test results
    useEffect(() => {
        const handleRegexGenerated = (event: CustomEvent) => {
            setIsGenerating(false);
            if (event.detail.error) {
                setGenerationError(event.detail.error);
            } else {
                setRegexPattern(event.detail.pattern);
                setGenerationError(null);
            }
        };

        const handleTestResult = (event: CustomEvent) => {
            setIsTesting(false);
            setTestResults({
                matches: event.detail.matches,
                count: event.detail.matchCount,
            });
        };

        window.addEventListener("regexGenerated", handleRegexGenerated as EventListener);
        window.addEventListener("regexTestResult", handleTestResult as EventListener);

        return () => {
            window.removeEventListener("regexGenerated", handleRegexGenerated as EventListener);
            window.removeEventListener("regexTestResult", handleTestResult as EventListener);
        };
    }, []);

    // Validate regex pattern
    const validateRegex = useCallback((pattern: string): boolean => {
        if (!pattern.trim()) {
            setRegexError(null);
            return false;
        }

        try {
            new RegExp(pattern, "gi");
            setRegexError(null);
            return true;
        } catch (error) {
            setRegexError((error as Error).message);
            return false;
        }
    }, []);

    // Handle regex pattern change
    const handleRegexChange = (value: string) => {
        setRegexPattern(value);
        validateRegex(value);
        setTestResults(null);
    };

    // Add example
    const addExample = () => {
        setExamples([...examples, ""]);
    };

    // Remove example
    const removeExample = (index: number) => {
        if (examples.length > 1) {
            setExamples(examples.filter((_, i) => i !== index));
        }
    };

    // Update example
    const updateExample = (index: number, value: string) => {
        const newExamples = [...examples];
        newExamples[index] = value;
        setExamples(newExamples);
    };

    // Generate regex from examples
    const handleGenerate = () => {
        const validExamples = examples.filter((e) => e.trim());
        if (!description.trim()) {
            setGenerationError("Please enter a description first");
            return;
        }
        if (validExamples.length === 0) {
            setGenerationError("Please add at least one example");
            return;
        }

        setIsGenerating(true);
        setGenerationError(null);
        onGenerateRegex(description, validExamples);
    };

    // Test regex pattern
    const handleTest = () => {
        if (!regexPattern.trim() || !validateRegex(regexPattern)) {
            return;
        }

        setIsTesting(true);
        setTestResults(null);
        onTestRegex(regexPattern);
    };

    // Handle save
    const handleSave = () => {
        if (!description.trim()) {
            return;
        }

        if (standardType === "regex-pattern" && !regexPattern.trim()) {
            return;
        }

        if (regexError) {
            return;
        }

        onSave({
            description: description.trim(),
            regexPattern: regexPattern.trim(),
            standardType,
            source: standard?.source || "manual",
            enabled,
            examples: examples.filter((e) => e.trim()),
            citation: citation.trim() || undefined,
        });
    };

    const canSave =
        description.trim() &&
        (standardType !== "regex-pattern" || (regexPattern.trim() && !regexError));

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
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
                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Description <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 border rounded-md bg-background"
                            placeholder="e.g., Use 'LORD' (all caps) for YHWH"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                            A clear description of what this standard checks
                        </p>
                    </div>

                    {/* Standard Type */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Standard Type</label>
                        <select
                            className="w-full px-3 py-2 border rounded-md bg-background"
                            value={standardType}
                            onChange={(e) => setStandardType(e.target.value)}
                        >
                            <option value="regex-pattern">Regex Pattern (Phase 1)</option>
                            <option value="key-term-consistency" disabled>
                                Key Term Consistency (Phase 2)
                            </option>
                            <option value="context-aware" disabled>
                                Context Aware (Phase 2)
                            </option>
                            <option value="semantic" disabled>
                                Semantic (Phase 3+)
                            </option>
                            <option value="back-translation" disabled>
                                Back-translation (Phase 3+)
                            </option>
                        </select>
                        {standardType !== "regex-pattern" && (
                            <p className="text-xs text-amber-500 mt-1">
                                This standard type is not supported yet
                            </p>
                        )}
                    </div>

                    {/* Examples */}
                    {standardType === "regex-pattern" && (
                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Examples (for AI-assisted regex generation)
                            </label>
                            <div className="space-y-2">
                                {examples.map((example, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            className="flex-1 px-3 py-1.5 border rounded-md bg-background text-sm"
                                            placeholder={`Example ${index + 1}...`}
                                            value={example}
                                            onChange={(e) => updateExample(index, e.target.value)}
                                        />
                                        {examples.length > 1 && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0"
                                                onClick={() => removeExample(index)}
                                            >
                                                <i className="codicon codicon-close" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={addExample}
                                    disabled={examples.length >= 5}
                                >
                                    <i className="codicon codicon-add mr-1" />
                                    Add Example
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleGenerate}
                                    disabled={isGenerating}
                                >
                                    {isGenerating ? (
                                        <>
                                            <i className="codicon codicon-sync codicon-modifier-spin mr-1" />
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            <i className="codicon codicon-sparkle mr-1" />
                                            Generate Regex
                                        </>
                                    )}
                                </Button>
                            </div>
                            {generationError && (
                                <p className="text-xs text-red-500 mt-1">{generationError}</p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                                Add 2-5 examples of text that should be flagged, then click
                                "Generate Regex"
                            </p>
                        </div>
                    )}

                    {/* Regex Pattern */}
                    {standardType === "regex-pattern" && (
                        <div>
                            <label className="block text-sm font-medium mb-1">
                                Regex Pattern <span className="text-red-500">*</span>
                            </label>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">
                                        /
                                    </span>
                                    <input
                                        type="text"
                                        className={`w-full pl-6 pr-12 py-2 border rounded-md bg-background font-mono text-sm ${
                                            regexError ? "border-red-500" : ""
                                        }`}
                                        placeholder="\\bexample\\b"
                                        value={regexPattern}
                                        onChange={(e) => handleRegexChange(e.target.value)}
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">
                                        /gi
                                    </span>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleTest}
                                    disabled={isTesting || !regexPattern.trim() || !!regexError}
                                >
                                    {isTesting ? (
                                        <i className="codicon codicon-sync codicon-modifier-spin" />
                                    ) : (
                                        <>
                                            <i className="codicon codicon-beaker mr-1" />
                                            Test
                                        </>
                                    )}
                                </Button>
                            </div>
                            {regexError && (
                                <p className="text-xs text-red-500 mt-1">
                                    Invalid regex: {regexError}
                                </p>
                            )}
                            {testResults && (
                                <div className="mt-2 p-2 bg-muted rounded-md">
                                    <p className="text-xs font-medium mb-1">
                                        Found {testResults.count} match
                                        {testResults.count !== 1 ? "es" : ""}
                                    </p>
                                    {testResults.matches.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {testResults.matches.slice(0, 10).map((match, i) => (
                                                <code
                                                    key={i}
                                                    className="text-xs bg-background px-1.5 py-0.5 rounded"
                                                >
                                                    {match}
                                                </code>
                                            ))}
                                            {testResults.count > 10 && (
                                                <span className="text-xs text-muted-foreground">
                                                    ...and {testResults.count - 10} more
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Citation (optional) */}
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Citation{" "}
                            <span className="text-xs text-muted-foreground">(optional)</span>
                        </label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 border rounded-md bg-background"
                            placeholder="e.g., Style Guide p.4"
                            value={citation}
                            onChange={(e) => setCitation(e.target.value)}
                        />
                    </div>

                    {/* Enabled toggle */}
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-medium">Enabled</label>
                            <p className="text-xs text-muted-foreground">
                                Start checking for violations immediately
                            </p>
                        </div>
                        <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={enabled}
                            onChange={(e) => setEnabled(e.target.checked)}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!canSave}>
                        {isEditing ? "Update" : "Create"} Standard
                    </Button>
                </div>
            </div>
        </div>
    );
};
