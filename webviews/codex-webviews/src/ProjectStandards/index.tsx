import React, { useEffect, useState, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { WebviewHeader } from "../components/WebviewHeader";
import { StandardCard } from "./StandardCard";
import { ViolationList } from "./ViolationList";
import { NewStandardDialog } from "./NewStandardDialog";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import "../tailwind.css";

// Types matching the provider
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

interface StandardViolation {
    cellId: string;
    fileUri: string;
    cellValue: string;
    matchText: string;
    lineNumber?: number;
    globalReferences?: string[];
}

// VS Code API singleton
function getVSCodeAPI() {
    const w = window as any;
    if (w.__vscodeApi) return w.__vscodeApi as any;
    const api = (window as any).acquireVsCodeApi();
    w.__vscodeApi = api;
    return api;
}

function ProjectStandardsApp() {
    const vscode = getVSCodeAPI();

    // State
    const [standards, setStandards] = useState<ProjectStandard[]>([]);
    const [violationCounts, setViolationCounts] = useState<Record<string, number>>({});
    const [focusModeEnabled, setFocusModeEnabled] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState({ progress: 0, total: 0 });

    // Modal states
    const [showNewDialog, setShowNewDialog] = useState(false);
    const [editingStandard, setEditingStandard] = useState<ProjectStandard | null>(null);
    const [selectedStandardForViolations, setSelectedStandardForViolations] = useState<
        string | null
    >(null);
    const [violations, setViolations] = useState<StandardViolation[]>([]);

    // Message handler
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case "standardsLoaded":
                    setStandards(message.standards);
                    break;
                case "scanProgress":
                    setScanProgress({ progress: message.progress, total: message.total });
                    break;
                case "scanComplete":
                    setIsScanning(false);
                    setViolationCounts(message.violationCounts);
                    break;
                case "violationsLoaded":
                    setViolations(message.violations);
                    break;
                case "focusModeChanged":
                    setFocusModeEnabled(message.enabled);
                    break;
                case "regexGenerated":
                    // Handled in NewStandardDialog
                    window.dispatchEvent(new CustomEvent("regexGenerated", { detail: message }));
                    break;
                case "regexTestResult":
                    // Handled in NewStandardDialog
                    window.dispatchEvent(new CustomEvent("regexTestResult", { detail: message }));
                    break;
                case "error":
                    console.error("[ProjectStandards] Error:", message.message);
                    break;
            }
        };

        window.addEventListener("message", handler);

        // Request initial data
        vscode.postMessage({ command: "getStandards" });

        return () => window.removeEventListener("message", handler);
    }, [vscode]);

    // Scan all standards
    const handleScan = useCallback(() => {
        setIsScanning(true);
        setScanProgress({ progress: 0, total: standards.length });
        vscode.postMessage({ command: "scanStandards" });
    }, [vscode, standards.length]);

    // Toggle focus mode
    const handleToggleFocusMode = useCallback(
        (enabled: boolean) => {
            vscode.postMessage({ command: "toggleFocusMode", enabled });
        },
        [vscode]
    );

    // Toggle standard
    const handleToggleStandard = useCallback(
        (standardId: string, enabled: boolean) => {
            vscode.postMessage({ command: "toggleStandard", standardId, enabled });
        },
        [vscode]
    );

    // Delete standard
    const handleDeleteStandard = useCallback(
        (standardId: string) => {
            vscode.postMessage({ command: "deleteStandard", standardId });
        },
        [vscode]
    );

    // View violations
    const handleViewViolations = useCallback(
        (standardId: string) => {
            setSelectedStandardForViolations(standardId);
            vscode.postMessage({ command: "getViolations", standardId });
        },
        [vscode]
    );

    // Jump to cell
    const handleJumpToCell = useCallback(
        (violation: StandardViolation) => {
            vscode.postMessage({ command: "jumpToCell", violation });
        },
        [vscode]
    );

    // Create standard
    const handleCreateStandard = useCallback(
        (standardData: Omit<ProjectStandard, "id" | "createdAt" | "updatedAt">) => {
            vscode.postMessage({ command: "createStandard", standard: standardData });
            setShowNewDialog(false);
        },
        [vscode]
    );

    // Update standard
    const handleUpdateStandard = useCallback(
        (standard: ProjectStandard) => {
            vscode.postMessage({ command: "updateStandard", standard });
            setEditingStandard(null);
        },
        [vscode]
    );

    // Generate regex
    const handleGenerateRegex = useCallback(
        (description: string, examples: string[]) => {
            vscode.postMessage({ command: "generateRegex", description, examples });
        },
        [vscode]
    );

    // Test regex
    const handleTestRegex = useCallback(
        (pattern: string) => {
            vscode.postMessage({ command: "testRegex", pattern });
        },
        [vscode]
    );

    // Split standards by source
    const orgStandards = standards.filter((s) => s.source === "org");
    const projectStandards = standards.filter((s) => s.source !== "org");

    const selectedStandard = selectedStandardForViolations
        ? standards.find((s) => s.id === selectedStandardForViolations)
        : null;

    // Calculate total violations
    const totalViolations = Object.values(violationCounts).reduce((sum, count) => sum + count, 0);
    const standardsWithViolations = Object.values(violationCounts).filter(
        (count) => count > 0
    ).length;
    const enabledStandards = standards.filter((s) => s.enabled).length;
    const hasBeenScanned = Object.keys(violationCounts).length > 0;

    return (
        <div className="p-4 max-w-2xl mx-auto">
            <WebviewHeader title="Project Standards" />

            {/* Violation Summary Banner - only show after scan */}
            {!focusModeEnabled && enabledStandards > 0 && hasBeenScanned && (
                <div
                    className={`mb-4 p-4 rounded-lg border-2 ${
                        totalViolations === 0
                            ? "bg-green-500/10 border-green-500/30"
                            : totalViolations < 10
                            ? "bg-amber-500/10 border-amber-500/30"
                            : "bg-red-500/10 border-red-500/30"
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-3xl font-bold tabular-nums">
                                {totalViolations}
                            </span>
                            <div>
                                <p className="text-sm font-medium">
                                    {totalViolations === 1 ? "violation" : "violations"} found
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    across {standardsWithViolations} of {enabledStandards} active{" "}
                                    {enabledStandards === 1 ? "standard" : "standards"}
                                </p>
                            </div>
                        </div>
                        {totalViolations === 0 && <span className="text-2xl">✓</span>}
                    </div>
                </div>
            )}

            {/* Not scanned yet prompt */}
            {!focusModeEnabled && enabledStandards > 0 && !hasBeenScanned && (
                <div className="mb-4 p-4 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl text-muted-foreground">?</span>
                            <div>
                                <p className="text-sm font-medium">Not scanned yet</p>
                                <p className="text-xs text-muted-foreground">
                                    Click "Scan All" to check for violations
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Actions Bar */}
            <div className="flex items-center justify-between mb-4 p-3 bg-secondary/30 rounded-lg">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={focusModeEnabled}
                            onCheckedChange={handleToggleFocusMode}
                            id="focus-mode"
                        />
                        <label htmlFor="focus-mode" className="text-sm font-medium cursor-pointer">
                            Focus Mode
                        </label>
                    </div>
                    {focusModeEnabled && (
                        <span className="text-xs text-muted-foreground">All checks disabled</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleScan}
                        disabled={isScanning || focusModeEnabled}
                    >
                        {isScanning ? (
                            <>
                                <i className="codicon codicon-sync codicon-modifier-spin mr-2" />
                                Scanning ({scanProgress.progress}/{scanProgress.total})
                            </>
                        ) : (
                            <>
                                <i className="codicon codicon-refresh mr-2" />
                                Scan All
                            </>
                        )}
                    </Button>
                    <Button size="sm" onClick={() => setShowNewDialog(true)}>
                        <i className="codicon codicon-add mr-2" />
                        New Standard
                    </Button>
                </div>
            </div>

            {/* Organization Standards Section */}
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-3 px-2">
                    <span className="text-lg">🏢</span>
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                        Organization Standards
                    </h2>
                    <span
                        className="text-xs text-muted-foreground cursor-help"
                        title="Org standards will sync from your organization's server in a future update"
                    >
                        <i className="codicon codicon-info" />
                    </span>
                </div>
                <div className="space-y-2">
                    {orgStandards.length === 0 ? (
                        <div className="text-sm text-muted-foreground p-4 text-center border border-dashed rounded-lg">
                            No organization standards configured
                        </div>
                    ) : (
                        orgStandards.map((standard) => (
                            <StandardCard
                                key={standard.id}
                                standard={standard}
                                violationCount={violationCounts[standard.id] ?? null}
                                focusModeEnabled={focusModeEnabled}
                                onToggle={handleToggleStandard}
                                onViewViolations={handleViewViolations}
                                isOrgStandard
                            />
                        ))
                    )}
                </div>
            </div>

            {/* Project Standards Section */}
            <div>
                <div className="flex items-center gap-2 mb-3 px-2">
                    <span className="text-lg">📋</span>
                    <h2 className="text-sm font-semibold text-primary uppercase tracking-wide">
                        Project Standards
                    </h2>
                </div>
                <div className="space-y-2">
                    {projectStandards.length === 0 ? (
                        <div className="text-sm text-muted-foreground p-4 text-center border border-dashed rounded-lg">
                            No project standards yet.{" "}
                            <button
                                className="text-primary underline"
                                onClick={() => setShowNewDialog(true)}
                            >
                                Create one
                            </button>
                        </div>
                    ) : (
                        projectStandards.map((standard) => (
                            <StandardCard
                                key={standard.id}
                                standard={standard}
                                violationCount={violationCounts[standard.id] ?? null}
                                focusModeEnabled={focusModeEnabled}
                                onToggle={handleToggleStandard}
                                onEdit={(s) => setEditingStandard(s)}
                                onDelete={handleDeleteStandard}
                                onViewViolations={handleViewViolations}
                            />
                        ))
                    )}
                </div>
            </div>

            {/* New Standard Dialog */}
            {showNewDialog && (
                <NewStandardDialog
                    onClose={() => setShowNewDialog(false)}
                    onSave={handleCreateStandard}
                    onGenerateRegex={handleGenerateRegex}
                    onTestRegex={handleTestRegex}
                />
            )}

            {/* Edit Standard Dialog */}
            {editingStandard && (
                <NewStandardDialog
                    standard={editingStandard}
                    onClose={() => setEditingStandard(null)}
                    onSave={(data) =>
                        handleUpdateStandard({
                            ...editingStandard,
                            ...data,
                        } as ProjectStandard)
                    }
                    onGenerateRegex={handleGenerateRegex}
                    onTestRegex={handleTestRegex}
                />
            )}

            {/* Violation List Modal */}
            {selectedStandardForViolations && selectedStandard && (
                <ViolationList
                    standard={selectedStandard}
                    violations={violations}
                    onClose={() => {
                        setSelectedStandardForViolations(null);
                        setViolations([]);
                    }}
                    onJumpToCell={handleJumpToCell}
                />
            )}
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<ProjectStandardsApp />);
