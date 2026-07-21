"use client";

import React, { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { VSCodeTag } from "@vscode/webview-ui-toolkit/react";

interface ResolveAllModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (numberOfCells: number) => void;
    mismatchedCellIds: string[];
    defaultValue?: number;
}

export function ResolveAllModal({
    isOpen,
    onClose,
    onConfirm,
    mismatchedCellIds,
    defaultValue = 5,
}: ResolveAllModalProps) {
    const totalAvailable = mismatchedCellIds.length;
    const [numberOfCellsToResolve, setNumberOfCellsToResolve] = useState(
        Math.min(defaultValue, totalAvailable)
    );

    useEffect(() => {
        if (isOpen) {
            setNumberOfCellsToResolve(Math.min(defaultValue, totalAvailable));
        }
    }, [isOpen, defaultValue, totalAvailable]);

    useEffect(() => {
        if (numberOfCellsToResolve > totalAvailable) {
            setNumberOfCellsToResolve(totalAvailable);
        }
    }, [totalAvailable, numberOfCellsToResolve]);

    if (!isOpen) return null;

    const handleNumberChange = (value: string) => {
        const num = parseInt(value, 10) || 0;
        setNumberOfCellsToResolve(Math.min(num, totalAvailable));
    };

    const isValidSelection = totalAvailable > 0 && numberOfCellsToResolve > 0;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
            <div className="bg-background border border-border rounded-lg p-6 max-w-lg w-full">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-foreground">Resolve Structure Mismatches</h2>
                    <Button onClick={onClose}>
                        <i className="codicon codicon-close" />
                    </Button>
                </div>

                <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-muted-foreground">
                            Cells with structure mismatches in this section
                        </span>
                        <VSCodeTag>{totalAvailable} cells</VSCodeTag>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Structural differences (tags, markers, line breaks) are corrected to match
                        the source without changing translated text. Simple cases are fixed
                        instantly; the rest are resolved with AI and verified before saving.
                    </p>
                </div>

                <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <label className="font-semibold text-foreground">
                            Number of cells to resolve:
                        </label>
                        <div className="text-sm text-muted-foreground">
                            {numberOfCellsToResolve} of {totalAvailable} available
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={numberOfCellsToResolve || ""}
                            onChange={(e) => handleNumberChange(e.target.value)}
                            className="flex-1 px-3 py-2 bg-input border border-border rounded text-foreground"
                            placeholder="Enter number of cells"
                            min="1"
                            max={totalAvailable}
                        />
                        {totalAvailable > 0 && (
                            <Button
                                variant="outline"
                                onClick={() => setNumberOfCellsToResolve(totalAvailable)}
                            >
                                All
                            </Button>
                        )}
                    </div>

                    {totalAvailable === 0 && (
                        <p className="text-sm text-muted-foreground mt-2">
                            No structure mismatches found in this section.
                        </p>
                    )}

                    {numberOfCellsToResolve === 0 && totalAvailable > 0 && (
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
                        onClick={() => onConfirm(numberOfCellsToResolve)}
                        disabled={!isValidSelection}
                    >
                        Resolve {numberOfCellsToResolve} Cells
                    </Button>
                </div>
            </div>
        </div>
    );
}
