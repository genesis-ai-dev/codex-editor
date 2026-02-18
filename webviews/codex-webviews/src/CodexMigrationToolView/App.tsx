import React, { useEffect, useMemo, useState } from "react";
import {
    VSCodeButton,
    VSCodeCheckbox,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeProgressRing,
} from "@vscode/webview-ui-toolkit/react";
import type { CodexMigrationMatchMode, MigrationMatchResult } from "types";

declare const vscode: {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
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
    results: MigrationMatchResult[];
    summary: MigrationSummary | null;
    isLoading: boolean;
    errorMessage: string | null;
};

const MATCH_MODE_LABELS: Record<CodexMigrationMatchMode, string> = {
    globalReferences: "Match Global References",
    timestamps: "Match Timestamps",
    sequential: "Match Sequential Source Lines",
};

const App: React.FC = () => {
    const [state, setState] = useState<AppState>(() => {
        const persisted = vscode.getState();
        return {
            targetFiles: persisted?.targetFiles || [],
            fromFilePath: persisted?.fromFilePath || "",
            toFilePath: persisted?.toFilePath || "",
            matchMode: persisted?.matchMode || "globalReferences",
            forceOverride: persisted?.forceOverride || false,
            results: persisted?.results || [],
            summary: persisted?.summary || null,
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

    const canRunMigration = useMemo(() => {
        return Boolean(state.fromFilePath && state.toFilePath && !state.isLoading);
    }, [state.fromFilePath, state.toFilePath, state.isLoading]);

    const handleRunMigration = () => {
        vscode.postMessage({
            command: "runMigration",
            data: {
                fromFilePath: state.fromFilePath,
                toFilePath: state.toFilePath,
                matchMode: state.matchMode,
                forceOverride: state.forceOverride,
            },
        });
    };

    const visibleResults = state.results.slice(0, 200);

    return (
        <div className="migration-container">
            <header className="migration-header">
                <h1>Codex Migration Tool</h1>
                <p>
                    Migrate edits, validations, and values from one codex file to another
                    using the selected matching mode.
                </p>
            </header>

            <section className="migration-panel">
                <label className="field-label">From Codex File</label>
                <VSCodeDropdown
                    value={state.fromFilePath}
                    onChange={(event: any) =>
                        setState((prev) => ({
                            ...prev,
                            fromFilePath: event.target.value,
                        }))
                    }
                >
                    <VSCodeOption value="">Select source codex file</VSCodeOption>
                    {state.targetFiles.map((file) => (
                        <VSCodeOption key={file.path} value={file.path}>
                            {file.name}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>

                <label className="field-label">To Codex File</label>
                <VSCodeDropdown
                    value={state.toFilePath}
                    onChange={(event: any) =>
                        setState((prev) => ({
                            ...prev,
                            toFilePath: event.target.value,
                        }))
                    }
                >
                    <VSCodeOption value="">Select target codex file</VSCodeOption>
                    {state.targetFiles.map((file) => (
                        <VSCodeOption key={file.path} value={file.path}>
                            {file.name}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>

                <label className="field-label">Matching Mode</label>
                <VSCodeDropdown
                    value={state.matchMode}
                    onChange={(event: any) =>
                        setState((prev) => ({
                            ...prev,
                            matchMode: event.target.value as CodexMigrationMatchMode,
                        }))
                    }
                >
                    {Object.entries(MATCH_MODE_LABELS).map(([mode, label]) => (
                        <VSCodeOption key={mode} value={mode}>
                            {label}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>

                <div className="checkbox-row">
                    <VSCodeCheckbox
                        checked={state.forceOverride}
                        onChange={(event: any) =>
                            setState((prev) => ({
                                ...prev,
                                forceOverride: event.target.checked,
                            }))
                        }
                    >
                        Force migrated edits to supersede existing content
                    </VSCodeCheckbox>
                </div>

                <div className="action-row">
                    <VSCodeButton
                        appearance="primary"
                        onClick={handleRunMigration}
                        disabled={!canRunMigration}
                    >
                        Run Migration
                    </VSCodeButton>
                    {state.isLoading && <VSCodeProgressRing />}
                </div>

                {state.errorMessage && (
                    <div className="error-banner">{state.errorMessage}</div>
                )}
            </section>

            <VSCodeDivider />

            <section className="results-panel">
                <h2>Migration Results</h2>
                {state.summary ? (
                    <div className="summary-row">
                        <span>Matched: {state.summary.matched}</span>
                        <span>Skipped: {state.summary.skipped}</span>
                        <span>Total matches: {state.results.length}</span>
                    </div>
                ) : (
                    <p className="muted">No migration run yet.</p>
                )}

                {visibleResults.length > 0 && (
                    <div className="results-table">
                        <div className="results-header">
                            <span>From Cell</span>
                            <span>To Cell</span>
                            <span>Source Line</span>
                        </div>
                        {visibleResults.map((result) => (
                            <div
                                className="results-row"
                                key={`${result.fromCellId}-${result.toCellId}`}
                            >
                                <span>{result.fromCellId}</span>
                                <span>{result.toCellId}</span>
                                <span className="result-text">
                                    {result.fromSourceValue || ""}
                                </span>
                            </div>
                        ))}
                        {state.results.length > visibleResults.length && (
                            <p className="muted">
                                Showing first {visibleResults.length} results.
                            </p>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
};

export default App;
