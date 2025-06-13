"use client";

import React, { useState } from "react";
import { Button } from "../../components/ui/button";
import { VSCodeTag } from "@vscode/webview-ui-toolkit/react";

interface AutocompleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (
        numberOfCells: number,
        includeEmptyCells: boolean,
        includeNotValidatedByAnyUser: boolean,
        includeNotValidatedByCurrentUser: boolean,
        includeFullyValidatedByOthers: boolean
    ) => void;
    totalUntranslatedCells: number;
    totalCellsToAutocomplete: number;
    totalCellsWithCurrentUserOption: number;
    totalFullyValidatedByOthers?: number;
    defaultValue?: number;
}

export function AutocompleteModal({
    isOpen,
    onClose,
    onConfirm,
    totalUntranslatedCells,
    totalCellsToAutocomplete,
    totalCellsWithCurrentUserOption,
    totalFullyValidatedByOthers = 0,
    defaultValue = Math.min(5, totalUntranslatedCells > 0 ? totalUntranslatedCells : 5),
}: AutocompleteModalProps) {
    const [numberOfCellsToAutocomplete, setNumberOfCellsToAutocomplete] = useState(0);
    const [customValue, setCustomValue] = useState<number | null>(null);

    // Individual states for each cell type
    const [includeEmptyCells, setIncludeEmptyCells] = useState(true);
    const [includeNotValidatedByAnyUser, setIncludeNotValidatedByAnyUser] = useState(false);
    const [includeNotValidatedByCurrentUser, setIncludeNotValidatedByCurrentUser] = useState(false);
    const [includeFullyValidatedByOthers, setIncludeFullyValidatedByOthers] = useState(false);

    // Show warning dialogs
    const [showValidationWarning, setShowValidationWarning] = useState(false);
    const [showNotValidatedByCurrentUserWarning, setShowNotValidatedByCurrentUserWarning] =
        useState(false);

    // Start with base total - only cells with no content
    const [effectiveTotalCells, setEffectiveTotalCells] = useState(totalUntranslatedCells);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
            <div className="bg-background border border-border rounded-lg p-6 max-w-2xl w-full">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-foreground">Autocomplete Cells</h2>
                    <Button onClick={onClose}>
                        <i className="codicon codicon-close" />
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    {/* Cell type cards */}
                    <div
                        className={`p-4 rounded-lg border ${
                            includeEmptyCells
                                ? "bg-primary text-primary-foreground border-ring"
                                : "border-border"
                        } cursor-pointer`}
                        onClick={() => setIncludeEmptyCells(!includeEmptyCells)}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold">—</span>
                            <span className="font-semibold">Empty Cells</span>
                        </div>
                        <p className="text-sm text-muted-foreground">Cells with no content</p>
                        <div className="mt-2">
                            <VSCodeTag>{totalUntranslatedCells} cells</VSCodeTag>
                        </div>
                    </div>

                    <div
                        className={`p-4 rounded-lg border ${
                            includeNotValidatedByAnyUser
                                ? "bg-primary text-primary-foreground border-ring"
                                : "border-border"
                        } cursor-pointer`}
                        onClick={() =>
                            setIncludeNotValidatedByAnyUser(!includeNotValidatedByAnyUser)
                        }
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold">✓</span>
                            <span className="font-semibold">Not Validated Cells</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Cells not validated by any user (not validated by you or by others)
                        </p>
                        <div className="mt-2">
                            <VSCodeTag>{totalCellsToAutocomplete} cells</VSCodeTag>
                        </div>
                    </div>

                    <div
                        className={`p-4 rounded-lg border ${
                            includeNotValidatedByCurrentUser
                                ? "bg-primary text-primary-foreground border-ring"
                                : "border-border"
                        } cursor-pointer`}
                        onClick={() =>
                            setIncludeNotValidatedByCurrentUser(!includeNotValidatedByCurrentUser)
                        }
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold">👤</span>
                            <span className="font-semibold">Not Validated by You</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Cells you haven't validated yet
                        </p>
                        <div className="mt-2">
                            <VSCodeTag>{totalCellsWithCurrentUserOption} cells</VSCodeTag>
                        </div>
                    </div>

                    <div
                        className={`p-4 rounded-lg border ${
                            includeFullyValidatedByOthers
                                ? "bg-primary text-primary-foreground border-ring"
                                : "border-border"
                        } cursor-pointer`}
                        onClick={() =>
                            setIncludeFullyValidatedByOthers(!includeFullyValidatedByOthers)
                        }
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold">✓✓</span>
                            <span className="font-semibold">Fully Validated</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Cells fully validated by other users
                        </p>
                        <div className="mt-2">
                            <VSCodeTag>{totalFullyValidatedByOthers} cells</VSCodeTag>
                        </div>
                    </div>
                </div>

                <div className="mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <label className="font-semibold text-foreground">
                            Number of cells to autocomplete:
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                value={customValue !== null ? customValue : ""}
                                onChange={(e) => {
                                    const value = parseInt(e.target.value);
                                    setCustomValue(value);
                                    if (value > 0) {
                                        setNumberOfCellsToAutocomplete(
                                            value > effectiveTotalCells
                                                ? effectiveTotalCells
                                                : value
                                        );
                                    }
                                }}
                                className="w-32 px-2 py-1 bg-input border-border rounded"
                                placeholder="Enter value"
                            />
                            {effectiveTotalCells > 0 && (
                                <Button
                                    onClick={() =>
                                        setNumberOfCellsToAutocomplete(effectiveTotalCells)
                                    }
                                >
                                    All ({effectiveTotalCells})
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="p-3 bg-muted rounded">
                        <div className="font-semibold mb-2 text-foreground">
                            Selected cell types:
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {includeEmptyCells && <VSCodeTag>Empty Cells</VSCodeTag>}
                            {includeNotValidatedByAnyUser && <VSCodeTag>No Validator</VSCodeTag>}
                            {includeNotValidatedByCurrentUser && (
                                <VSCodeTag>Not Validated by You</VSCodeTag>
                            )}
                            {includeFullyValidatedByOthers && (
                                <VSCodeTag>Fully Validated</VSCodeTag>
                            )}
                            {!includeEmptyCells &&
                                !includeNotValidatedByAnyUser &&
                                !includeNotValidatedByCurrentUser &&
                                !includeFullyValidatedByOthers && (
                                    <span className="text-destructive text-sm">
                                        No cell types selected
                                    </span>
                                )}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() =>
                            onConfirm(
                                numberOfCellsToAutocomplete,
                                includeEmptyCells,
                                includeNotValidatedByAnyUser,
                                includeNotValidatedByCurrentUser,
                                includeFullyValidatedByOthers
                            )
                        }
                        disabled={
                            (!includeEmptyCells &&
                                !includeNotValidatedByAnyUser &&
                                !includeNotValidatedByCurrentUser &&
                                !includeFullyValidatedByOthers) ||
                            effectiveTotalCells === 0 ||
                            customValue === null ||
                            customValue <= 0 ||
                            (customValue > effectiveTotalCells && effectiveTotalCells > 0)
                        }
                    >
                        Autocomplete {numberOfCellsToAutocomplete} Cells
                    </Button>
                </div>
            </div>
        </div>
    );
}
