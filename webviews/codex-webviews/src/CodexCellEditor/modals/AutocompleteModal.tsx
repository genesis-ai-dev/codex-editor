"use client";

import React, { useState, useEffect } from "react";
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
    untranslatedCellIds: string[];
    cellsToAutocompleteIds: string[];
    cellsWithCurrentUserOptionIds: string[];
    fullyValidatedByOthersIds?: string[];
    defaultValue?: number;
}

export function AutocompleteModal({
    isOpen,
    onClose,
    onConfirm,
    untranslatedCellIds,
    cellsToAutocompleteIds,
    cellsWithCurrentUserOptionIds,
    fullyValidatedByOthersIds = [],
    defaultValue = 5,
}: AutocompleteModalProps) {
    // Individual states for each cell type
    const [includeEmptyCells, setIncludeEmptyCells] = useState(true);
    const [includeNotValidatedByAnyUser, setIncludeNotValidatedByAnyUser] = useState(false);
    const [includeNotValidatedByCurrentUser, setIncludeNotValidatedByCurrentUser] = useState(false);
    const [includeFullyValidatedByOthers, setIncludeFullyValidatedByOthers] = useState(false);

    const [numberOfCellsToAutocomplete, setNumberOfCellsToAutocomplete] = useState(defaultValue);

    // Calculate effective total cells based on selected options
    const calculateEffectiveTotalCells = () => {
        const uniqueIds = new Set<string>();
        if (includeEmptyCells) untranslatedCellIds.forEach((id) => uniqueIds.add(id));
        if (includeNotValidatedByAnyUser) cellsToAutocompleteIds.forEach((id) => uniqueIds.add(id));
        if (includeNotValidatedByCurrentUser)
            cellsWithCurrentUserOptionIds.forEach((id) => uniqueIds.add(id));
        if (includeFullyValidatedByOthers)
            fullyValidatedByOthersIds.forEach((id) => uniqueIds.add(id));
        return uniqueIds.size;
    };

    const effectiveTotalCells = calculateEffectiveTotalCells();

    // Reset to default when modal opens
    useEffect(() => {
        if (isOpen) {
            setNumberOfCellsToAutocomplete(Math.min(defaultValue, effectiveTotalCells));
        }
    }, [isOpen, defaultValue, effectiveTotalCells]);

    // Ensure numberOfCellsToAutocomplete doesn't exceed effective total
    useEffect(() => {
        if (numberOfCellsToAutocomplete > effectiveTotalCells) {
            setNumberOfCellsToAutocomplete(effectiveTotalCells);
        }
    }, [effectiveTotalCells, numberOfCellsToAutocomplete]);

    if (!isOpen) return null;

    const handleNumberChange = (value: string) => {
        const num = parseInt(value) || 0;
        setNumberOfCellsToAutocomplete(Math.min(num, effectiveTotalCells));
    };

    const isValidSelection = effectiveTotalCells > 0 && numberOfCellsToAutocomplete > 0;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
            <div className="bg-background border border-border rounded-lg p-6 max-w-lg w-full">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-foreground">Autocomplete Cells</h2>
                    <Button onClick={onClose}>
                        <i className="codicon codicon-close" />
                    </Button>
                </div>

                <div className="mb-6">
                    <h3 className="font-semibold mb-3 text-foreground">Cell types to include:</h3>
                    <div className="space-y-2">
                        <label
                            className={`flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-muted ${
                                untranslatedCellIds.length === 0 ? "opacity-50 pointer-events-none" : ""
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={includeEmptyCells}
                                onChange={(e) => setIncludeEmptyCells(e.target.checked)}
                                className="w-4 h-4"
                                disabled={untranslatedCellIds.length === 0}
                            />
                            <div className="flex-1 flex items-center justify-between">
                                <span className="text-sm">Empty cells (no content)</span>
                                <VSCodeTag>{untranslatedCellIds.length} cells</VSCodeTag>
                            </div>
                        </label>

                        <label
                            className={`flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-muted ${
                                cellsToAutocompleteIds.length === 0
                                    ? "opacity-50 pointer-events-none"
                                    : ""
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={includeNotValidatedByAnyUser}
                                onChange={(e) => setIncludeNotValidatedByAnyUser(e.target.checked)}
                                className="w-4 h-4"
                                disabled={cellsToAutocompleteIds.length === 0}
                            />
                            <div className="flex-1 flex items-center justify-between">
                                <span className="text-sm">Not validated by any user</span>
                                <VSCodeTag>{cellsToAutocompleteIds.length} cells</VSCodeTag>
                            </div>
                        </label>

                        <label
                            className={`flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-muted ${
                                cellsWithCurrentUserOptionIds.length === 0
                                    ? "opacity-50 pointer-events-none"
                                    : ""
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={includeNotValidatedByCurrentUser}
                                onChange={(e) =>
                                    setIncludeNotValidatedByCurrentUser(e.target.checked)
                                }
                                className="w-4 h-4"
                                disabled={cellsWithCurrentUserOptionIds.length === 0}
                            />
                            <div className="flex-1 flex items-center justify-between">
                                <span className="text-sm">Not validated by you</span>
                                <VSCodeTag>{cellsWithCurrentUserOptionIds.length} cells</VSCodeTag>
                            </div>
                        </label>

                        <label
                            className={`flex items-center gap-3 cursor-pointer p-2 rounded hover:bg-muted ${
                                fullyValidatedByOthersIds.length === 0
                                    ? "opacity-50 pointer-events-none"
                                    : ""
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={includeFullyValidatedByOthers}
                                onChange={(e) => setIncludeFullyValidatedByOthers(e.target.checked)}
                                className="w-4 h-4"
                                disabled={fullyValidatedByOthersIds.length === 0}
                            />
                            <div className="flex-1 flex items-center justify-between">
                                <span className="text-sm">Fully validated by others</span>
                                <VSCodeTag>{fullyValidatedByOthersIds.length} cells</VSCodeTag>
                            </div>
                        </label>
                    </div>
                </div>

                <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <label className="font-semibold text-foreground">
                            Number of cells to autocomplete:
                        </label>
                        <div className="text-sm text-muted-foreground">
                            {numberOfCellsToAutocomplete} of {effectiveTotalCells} available
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={numberOfCellsToAutocomplete || ""}
                            onChange={(e) => handleNumberChange(e.target.value)}
                            className="flex-1 px-3 py-2 bg-input border border-border rounded text-foreground"
                            placeholder="Enter number of cells"
                            min="1"
                            max={effectiveTotalCells}
                        />
                        {effectiveTotalCells > 0 && (
                            <Button
                                variant="outline"
                                onClick={() => setNumberOfCellsToAutocomplete(effectiveTotalCells)}
                                disabled={effectiveTotalCells === 0}
                            >
                                All
                            </Button>
                        )}
                    </div>

                    {effectiveTotalCells === 0 && (
                        <p className="text-sm text-destructive mt-2">
                            Select at least one cell type to continue
                        </p>
                    )}

                    {numberOfCellsToAutocomplete === 0 && effectiveTotalCells > 0 && (
                        <p className="text-sm text-destructive mt-2">
                            Enter a number greater than 0
                        </p>
                    )}
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
                        disabled={!isValidSelection}
                    >
                        Autocomplete {numberOfCellsToAutocomplete} Cells
                    </Button>
                </div>
            </div>
        </div>
    );
}
