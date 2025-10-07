import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
    VSCodeButton,
    VSCodeCheckbox,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeTextField,
    VSCodeProgressRing,
} from "@vscode/webview-ui-toolkit/react";

// Assuming vscode is declared globally by index.tsx
declare const vscode: {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
};

// --- Data Interfaces (mirroring original)
interface CellLabelData {
    cellId: string;
    startTime: string;
    endTime: string;
    character?: string;
    dialogue?: string;
    newLabel: string;
    currentLabel?: string;
    matched: boolean;
    sourceFileUri?: string; // Track which file this label belongs to
}

interface ImportedRow {
    [key: string]: any; // Dynamic column names
}

interface SourceFileUIData {
    path: string;
    id: string;
    name: string;
}

// --- State Interface
interface AppState {
    view: "initial" | "columnSelection" | "tableView";
    labels: CellLabelData[];
    selectedIds: string[];
    currentPage: number;
    itemsPerPage: number;
    // totalPages will be derived
    importData: ImportedRow[] | null;
    headers: string[];
    selectedColumn: string | null;
    selectedColumns?: string[];
    useMultiColumns?: boolean;
    importSource: string; // Filename(s) of the imported file(s)
    availableSourceFiles: SourceFileUIData[];
    selectedTargetFilePath: string | null; // Single file to import into
    isLoading: boolean; // For loading indicators
    errorMessage: string | null; // For displaying errors in column selection
}

const ITEMS_PER_PAGE = 50;

const App: React.FC = () => {
    const [state, setState] = useState<AppState>(() => {
        const persistedState = vscode.getState();
        return {
            view: persistedState?.view || "initial",
            labels: persistedState?.labels || [],
            selectedIds: persistedState?.selectedIds || [],
            currentPage: persistedState?.currentPage || 1,
            itemsPerPage: persistedState?.itemsPerPage || ITEMS_PER_PAGE,
            importData: persistedState?.importData || null,
            headers: persistedState?.headers || [],
            selectedColumn: persistedState?.selectedColumn || null,
            selectedColumns: persistedState?.selectedColumns || [],
            useMultiColumns: persistedState?.useMultiColumns || false,
            importSource: persistedState?.importSource || "",
            availableSourceFiles: persistedState?.availableSourceFiles || [],
            selectedTargetFilePath: persistedState?.selectedTargetFilePath || null,
            isLoading: false,
            errorMessage: null,
        };
    });

    // Persist state whenever it changes
    useEffect(() => {
        vscode.setState(state);
    }, [state]);

    const totalPages = useMemo(() => {
        if (!state.labels || state.labels.length === 0) return 0;
        return Math.ceil(state.labels.length / state.itemsPerPage);
    }, [state.labels, state.itemsPerPage]);

    // --- Memoized values for views ---
    const CONCAT_OPTION = "__CHARACTER_LABELS_CONCAT__";

    const getCharacterLabelHeaders = useCallback((): string[] => {
        const headers = state.headers || [];
        const charHeaders = headers.filter((h) => h.toUpperCase().startsWith("CHARACTER LABEL"));
        return charHeaders.sort((a, b) => {
            const na = parseInt((a.match(/CHARACTER LABEL\s*(\d+)/i) || ["", "0"])[1]);
            const nb = parseInt((b.match(/CHARACTER LABEL\s*(\d+)/i) || ["", "0"])[1]);
            return na - nb;
        });
    }, [state.headers]);

    const columnPreview = useMemo(() => {
        if (!state.importData) return "<em>No preview available</em>";
        if (state.useMultiColumns && state.selectedColumns && state.selectedColumns.length > 0) {
            const cols = state.selectedColumns;
            return (
                state.importData
                    .slice(0, 5)
                    .map((row) =>
                        cols
                            .map((h) =>
                                row[h] !== undefined && row[h] !== null ? String(row[h]).trim() : ""
                            )
                            .filter((v) => v)
                            .join(", ")
                    )
                    .map((val, idx) => (
                        <div key={idx}>
                            {String(val).replace(/</g, "&lt;").replace(/>/g, "&gt;")}
                        </div>
                    ))
                    .join("") || "<em>No data in selected columns for preview</em>"
            );
        }
        if (!state.selectedColumn) return "<em>No preview available</em>";
        if (state.selectedColumn === CONCAT_OPTION) {
            const charHeaders = getCharacterLabelHeaders();
            return (
                state.importData
                    .slice(0, 5)
                    .map((row) =>
                        charHeaders
                            .map((h) =>
                                row[h] !== undefined && row[h] !== null ? String(row[h]).trim() : ""
                            )
                            .filter((v) => v)
                            .join(", ")
                    )
                    .map((val, idx) => (
                        <div key={idx}>
                            {String(val).replace(/</g, "&lt;").replace(/>/g, "&gt;")}
                        </div>
                    ))
                    .join("") || "<em>No data in these columns for preview</em>"
            );
        }
        return (
            state.importData
                .slice(0, 5)
                .map((row) => row[state.selectedColumn!])
                .filter((val) => val !== undefined && val !== null && val !== "")
                .map((val, idx) => (
                    <div key={idx}>{String(val).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
                ))
                .join("") || "<em>No data in this column for preview</em>"
        );
    }, [
        state.selectedColumn,
        state.selectedColumns,
        state.useMultiColumns,
        state.importData,
        getCharacterLabelHeaders,
    ]);

    const paginatedLabels = useMemo(() => {
        if (!state.labels) return [];
        const start = (state.currentPage - 1) * state.itemsPerPage;
        return state.labels.slice(start, start + state.itemsPerPage);
    }, [state.labels, state.currentPage, state.itemsPerPage]);

    // --- Message Handling from Extension ---
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case "updateHeaders": // Sent after file is chosen, before processing
                    setState((prev) => ({
                        ...prev,
                        view: "columnSelection",
                        headers: message.headers || [],
                        importSource: message.importSource || "",
                        availableSourceFiles:
                            message.availableSourceFiles || prev.availableSourceFiles, // Extension should send these
                        selectedColumn:
                            message.headers && message.headers.includes(prev.selectedColumn)
                                ? prev.selectedColumn
                                : null, // Preserve if valid
                        isLoading: false,
                        errorMessage: null,
                    }));
                    break;
                case "storeImportData": // Sent along with or after updateHeaders
                    setState((prev) => ({
                        ...prev,
                        importData: message.data,
                        isLoading: false,
                    }));
                    break;
                case "displayLabels": // Sent after processing is done
                    setState((prev) => ({
                        ...prev,
                        view: "tableView",
                        labels: message.labels || [],
                        selectedIds: (message.labels || [])
                            .filter((l: CellLabelData) => l.matched)
                            .map((l: CellLabelData) => l.cellId),
                        currentPage: 1, // Reset to first page
                        isLoading: false,
                        importData: null, // Clear data from the imported spreadsheet file
                        availableSourceFiles: [], // Clear source files list, not used in table view
                        // and will be re-populated if a new import occurs.
                    }));
                    break;
                case "showError": // Generic error display
                    setState((prev) => ({
                        ...prev,
                        isLoading: false,
                        errorMessage: message.error,
                    }));
                    vscode.postMessage({
                        command: "logError",
                        message: "Error displayed in webview: " + message.error,
                    });
                    break;
                case "setLoading":
                    setState((prev) => ({ ...prev, isLoading: message.isLoading }));
                    break;
            }
        };

        window.addEventListener("message", handleMessage);
        // Request initial state or data if needed (e.g. if webview can be restored)
        // vscode.postMessage({ command: 'webviewReady' }); // Example

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    // --- Event Handlers (posting messages to Extension) ---
    const handleImportFile = useCallback(() => {
        vscode.postMessage({ command: "importFile" });
        setState((prev) => ({ ...prev, isLoading: true, errorMessage: null }));
    }, []);

    const handleProcessLabels = useCallback(() => {
        const usingMulti = !!(
            state.useMultiColumns &&
            state.selectedColumns &&
            state.selectedColumns.length > 0
        );
        if (!usingMulti && !state.selectedColumn) {
            setState((prev) => ({
                ...prev,
                errorMessage: "Please select a column to use for labels.",
            }));
            return;
        }
        if (!state.importData) {
            setState((prev) => ({ ...prev, errorMessage: "No data available to process." }));
            vscode.postMessage({
                command: "logError",
                message: "ProcessLabels called without importData.",
            });
            return;
        }
        vscode.postMessage({
            command: "processLabels",
            data: state.importData,
            selectedColumn: usingMulti ? undefined : state.selectedColumn,
            selectedColumns: usingMulti ? state.selectedColumns : undefined,
            selectedTargetFilePath: state.selectedTargetFilePath, // Send selected file path
        });
        setState((prev) => ({ ...prev, isLoading: true, errorMessage: null }));
    }, [
        state.importData,
        state.selectedColumn,
        state.selectedColumns,
        state.useMultiColumns,
        state.selectedTargetFilePath,
    ]);

    const handleSave = useCallback(() => {
        vscode.postMessage({
            command: "save",
            labels: state.labels,
            selectedIds: state.selectedIds,
        });
    }, [state.labels, state.selectedIds]);

    const handleCancelImport = useCallback(() => {
        // Reset to initial import screen, clearing intermediate states
        setState((prev) => ({
            ...prev,
            view: "initial",
            importData: null,
            headers: [],
            selectedColumn: null,
            importSource: "",
            labels: [], // Clear processed labels if any
            isLoading: false,
            errorMessage: null,
        }));
        // Tell extension to clean up temp files for the cancelled import session
        vscode.postMessage({ command: "cancelImportCleanup" });
    }, []);

    const handleFullCancel = useCallback(() => {
        vscode.postMessage({ command: "cancel" }); // Closes the webview panel
    }, []);

    // --- UI Rendering Logic Helpers ---

    const renderInitialImportView = () => (
        <div className="initial-import-view empty-state">
            <p>No cell labels loaded yet.</p>
            <VSCodeButton onClick={handleImportFile} disabled={state.isLoading}>
                Import From File
            </VSCodeButton>
            {state.isLoading && <VSCodeProgressRing />}
        </div>
    );

    const renderColumnSelectorView = () => {
        if (!state.importData && state.headers.length === 0) {
            // Should not happen if view is columnSelection
            return <p>Waiting for file data and headers...</p>;
        }

        const handleColumnChange = (e: any) => {
            const value = e.target.value;
            setState((prev) => ({
                ...prev,
                selectedColumn: value,
                useMultiColumns: false,
                errorMessage: null,
            }));
        };

        const toggleUseMultiColumns = (checked: boolean) => {
            setState((prev) => ({
                ...prev,
                useMultiColumns: checked,
                selectedColumn: checked ? null : prev.selectedColumn,
            }));
        };

        const handleMultiColumnChange = (header: string, isChecked: boolean) => {
            setState((prev) => {
                const set = new Set(prev.selectedColumns || []);
                if (isChecked) set.add(header);
                else set.delete(header);
                return { ...prev, selectedColumns: Array.from(set) };
            });
        };

        const handleTargetFileChange = (e: any) => {
            const filePath = e.target.value;
            setState((prev) => ({
                ...prev,
                selectedTargetFilePath: filePath || null,
            }));
        };

        return (
            <div className="column-selector-container">
                {state.isLoading && <VSCodeProgressRing />}
                <div className="import-info">
                    Imported from: <span>{state.importSource}</span>
                </div>
                <div className="column-selector-form">
                    <h3>Select Column(s) to Use as Cell Label</h3>
                    <p>Choose one column or enable multi-select to concatenate multiple columns:</p>
                    <div style={{ marginBottom: "8px" }}>
                        <VSCodeCheckbox
                            checked={!!state.useMultiColumns}
                            onChange={(e: any) => toggleUseMultiColumns(e.target.checked)}
                        >
                            Use multiple columns (concatenate)
                        </VSCodeCheckbox>
                    </div>
                    {!state.useMultiColumns ? (
                        <VSCodeDropdown
                            value={state.selectedColumn || ""}
                            onChange={handleColumnChange}
                            style={{ maxWidth: "400px" }}
                        >
                            <VSCodeOption value="">-- Select a column --</VSCodeOption>
                            {state.headers.map((header) => (
                                <VSCodeOption key={header} value={header}>
                                    {header}
                                </VSCodeOption>
                            ))}
                        </VSCodeDropdown>
                    ) : (
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                                gap: "6px",
                                maxWidth: "640px",
                                marginBottom: "8px",
                            }}
                        >
                            {state.headers.map((header) => (
                                <VSCodeCheckbox
                                    key={header}
                                    checked={!!state.selectedColumns?.includes(header)}
                                    onChange={(e: any) =>
                                        handleMultiColumnChange(header, e.target.checked)
                                    }
                                >
                                    {header}
                                </VSCodeCheckbox>
                            ))}
                        </div>
                    )}
                    {state.errorMessage && <p className="error-message">{state.errorMessage}</p>}
                    <p>Preview of selected column:</p>
                    <div id="columnPreview" className="column-preview">
                        {state.selectedColumn && !state.useMultiColumns && state.importData ? (
                            state.importData
                                .slice(0, 5)
                                .some(
                                    (row) =>
                                        row[state.selectedColumn!] !== undefined &&
                                        row[state.selectedColumn!] !== null &&
                                        row[state.selectedColumn!] !== ""
                                ) ? (
                                state.importData.slice(0, 5).map(
                                    (row, idx) =>
                                        row[state.selectedColumn!] !== undefined &&
                                        row[state.selectedColumn!] !== null &&
                                        row[state.selectedColumn!] !== "" && (
                                            <div key={idx} className="preview-item">
                                                {String(row[state.selectedColumn!])}
                                            </div>
                                        )
                                )
                            ) : (
                                <em>No data in this column for preview</em>
                            )
                        ) : state.useMultiColumns &&
                          state.selectedColumns &&
                          state.selectedColumns.length > 0 &&
                          state.importData ? (
                            state.importData.slice(0, 5).map((row, idx) => (
                                <div key={idx} className="preview-item">
                                    {state
                                        .selectedColumns!.map((h) =>
                                            row[h] !== undefined && row[h] !== null
                                                ? String(row[h]).trim()
                                                : ""
                                        )
                                        .filter((v) => v)
                                        .join(", ")}
                                </div>
                            ))
                        ) : (
                            <em>No preview available</em>
                        )}
                    </div>

                    <h4>Select Target File</h4>
                    <p>Choose which file to import the labels into:</p>
                    <VSCodeDropdown
                        value={state.selectedTargetFilePath || ""}
                        onChange={handleTargetFileChange}
                        style={{ maxWidth: "500px", marginBottom: "12px" }}
                    >
                        <VSCodeOption value="">-- Select a file --</VSCodeOption>
                        {state.availableSourceFiles.map((file) => (
                            <VSCodeOption key={file.id} value={file.path}>
                                {file.name}
                            </VSCodeOption>
                        ))}
                    </VSCodeDropdown>
                    <VSCodeButton
                        onClick={handleProcessLabels}
                        disabled={
                            state.isLoading ||
                            !state.selectedTargetFilePath ||
                            (!state.useMultiColumns
                                ? !state.selectedColumn
                                : !(state.selectedColumns && state.selectedColumns.length > 0))
                        }
                    >
                        Process Labels
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="secondary"
                        onClick={handleCancelImport}
                        disabled={state.isLoading}
                        style={{ marginLeft: "8px" }}
                    >
                        Cancel Import
                    </VSCodeButton>
                </div>
            </div>
        );
    };

    const renderTableView = () => {
        const handleSelectAllChange = (e: any) => {
            const isChecked = e.target.checked;
            setState((prev) => ({
                ...prev,
                selectedIds: isChecked
                    ? prev.labels.filter((l) => l.matched).map((l) => l.cellId)
                    : [],
            }));
        };

        const handleRowCheckboxChange = (cellId: string, isChecked: boolean) => {
            setState((prev) => {
                const newSelectedIds = new Set(prev.selectedIds);
                if (isChecked) {
                    newSelectedIds.add(cellId);
                } else {
                    newSelectedIds.delete(cellId);
                }
                return { ...prev, selectedIds: Array.from(newSelectedIds) };
            });
        };

        const goToPage = (page: number) => {
            setState((prev) => ({ ...prev, currentPage: page }));
        };

        if (state.labels.length === 0 && !state.isLoading) {
            return (
                <div className="empty-state">
                    <p>No labels to display. Try importing a new file.</p>
                    <VSCodeButton onClick={handleImportFile}>Import New File</VSCodeButton>
                </div>
            );
        }

        return (
            <div className="table-view-container">
                {state.isLoading && <VSCodeProgressRing />}
                {state.importSource && (
                    <div className="import-info">
                        Labels based on import from: {state.importSource}
                    </div>
                )}
                <div className="summary">
                    <div>
                        Total imported rows (matched/unmatched for this view):{" "}
                        <strong>{state.labels.length}</strong>
                    </div>
                    <div>
                        Matched cells for update:{" "}
                        <strong>{state.labels.filter((l) => l.matched).length}</strong>
                    </div>
                    <div>
                        Unmatched cells (not updatable):{" "}
                        <strong>{state.labels.filter((l) => !l.matched).length}</strong>
                    </div>
                </div>

                {state.labels.filter((l) => l.matched).length > 0 && (
                    <div className="checkbox-container">
                        <VSCodeCheckbox
                            checked={
                                state.selectedIds.length ===
                                    state.labels.filter((l) => l.matched).length &&
                                state.labels.filter((l) => l.matched).length > 0
                            }
                            onChange={handleSelectAllChange}
                        >
                            Select all matched cells for update
                        </VSCodeCheckbox>
                    </div>
                )}

                {/* Pagination - Top */}
                <Pagination
                    currentPage={state.currentPage}
                    totalPages={totalPages}
                    onPageChange={goToPage}
                />

                <table>
                    <thead>
                        <tr>
                            <th>Select</th>
                            <th>Cell ID</th>
                            <th>Time Range</th>
                            <th>New Label</th>
                            <th>Current Label</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedLabels.map((label) => (
                            <tr
                                key={label.cellId || label.newLabel + label.startTime}
                                className={label.matched ? "matched" : "unmatched"}
                            >
                                <td>
                                    {label.matched && (
                                        <VSCodeCheckbox
                                            checked={state.selectedIds.includes(label.cellId)}
                                            onChange={(e: any) =>
                                                handleRowCheckboxChange(
                                                    label.cellId,
                                                    e.target.checked
                                                )
                                            }
                                        />
                                    )}
                                </td>
                                <td>{label.cellId || "(No match)"}</td>
                                <td>
                                    {label.startTime} → {label.endTime}
                                </td>
                                <td className="new-label">{label.newLabel || "(Empty)"}</td>
                                <td className="current-label">{label.currentLabel || "(None)"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Pagination - Bottom */}
                <Pagination
                    currentPage={state.currentPage}
                    totalPages={totalPages}
                    onPageChange={goToPage}
                />

                <div className="actions">
                    <div className="left-actions">
                        <VSCodeButton onClick={handleImportFile} disabled={state.isLoading}>
                            Import New File
                        </VSCodeButton>
                    </div>
                    <div className="right-actions">
                        <VSCodeButton
                            appearance="secondary"
                            onClick={handleFullCancel}
                            disabled={state.isLoading}
                        >
                            Cancel
                        </VSCodeButton>
                        <VSCodeButton
                            onClick={handleSave}
                            disabled={state.isLoading || state.selectedIds.length === 0}
                        >
                            Save Selected
                        </VSCodeButton>
                    </div>
                </div>
            </div>
        );
    };

    // --- Main View Router ---
    const renderCurrentView = () => {
        switch (state.view) {
            case "initial":
                return renderInitialImportView();
            case "columnSelection":
                return renderColumnSelectorView();
            case "tableView":
                return renderTableView();
            default:
                return <p>Unknown view state</p>;
        }
    };

    return (
        <div>
            <h1>Cell Label Importer</h1>
            <VSCodeDivider />
            {renderCurrentView()}
        </div>
    );
};

// --- Pagination Component (simple version) ---
interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}
const Pagination: React.FC<PaginationProps> = ({ currentPage, totalPages, onPageChange }) => {
    if (totalPages <= 1) return null;

    const pageNumbers: (number | string)[] = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
        for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
    } else {
        pageNumbers.push(1);
        let start = Math.max(2, currentPage - Math.floor((maxVisiblePages - 3) / 2));
        let end = Math.min(totalPages - 1, currentPage + Math.floor((maxVisiblePages - 2) / 2));

        if (currentPage < maxVisiblePages - 2) end = maxVisiblePages - 2;
        if (currentPage > totalPages - (maxVisiblePages - 3))
            start = totalPages - (maxVisiblePages - 2);

        if (start > 2) pageNumbers.push("...");
        for (let i = start; i <= end; i++) pageNumbers.push(i);
        if (end < totalPages - 1) pageNumbers.push("...");
        pageNumbers.push(totalPages);
    }

    return (
        <div className="pagination">
            <VSCodeButton
                appearance="icon"
                disabled={currentPage === 1}
                onClick={() => onPageChange(currentPage - 1)}
                aria-label="Previous Page"
            >
                <span>←</span>
            </VSCodeButton>
            {pageNumbers.map((num, idx) =>
                typeof num === "number" ? (
                    <VSCodeButton
                        key={idx}
                        appearance={num === currentPage ? "primary" : "secondary"}
                        onClick={() => onPageChange(num)}
                        className={num === currentPage ? "current-page" : ""}
                    >
                        {num}
                    </VSCodeButton>
                ) : (
                    <span key={idx} style={{ padding: "0 8px" }}>
                        {num}
                    </span>
                )
            )}
            <VSCodeButton
                appearance="icon"
                disabled={currentPage === totalPages}
                onClick={() => onPageChange(currentPage + 1)}
                aria-label="Next Page"
            >
                <span>→</span>
            </VSCodeButton>
        </div>
    );
};

export default App;
