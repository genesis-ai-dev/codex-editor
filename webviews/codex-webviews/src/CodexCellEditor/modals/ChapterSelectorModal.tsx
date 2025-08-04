"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";

interface ChapterSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectChapter: (chapter: number) => void;
    currentChapter: number;
    totalChapters: number;
    bookTitle: string;
    unsavedChanges: boolean;
    anchorRef: React.RefObject<HTMLDivElement>;
    chapterProgress?: Record<
        number,
        { percentTranslationsCompleted: number; percentFullyValidatedTranslations: number }
    >;
}

export function ChapterSelectorModal({
    isOpen,
    onClose,
    onSelectChapter,
    currentChapter,
    totalChapters,
    bookTitle,
    unsavedChanges,
    anchorRef,
    chapterProgress,
}: ChapterSelectorModalProps) {
    const modalRef = useRef<HTMLDivElement>(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
    const [columns, setColumns] = useState(10);
    const [arrowPosition, setArrowPosition] = useState<"top" | "bottom">("top");

    // Helper function to get chapter background color based on progress
    const getChapterBackgroundColor = (chapter: number, isSelected: boolean) => {
        if (!chapterProgress || !chapterProgress[chapter]) {
            // Default styling when no progress data
            return isSelected
                ? "var(--vscode-button-background)"
                : "var(--vscode-editorWidget-background)";
        }

        const progress = chapterProgress[chapter];
        const { percentTranslationsCompleted, percentFullyValidatedTranslations } = progress;

        // If 100% validated (secondary color)
        if (percentFullyValidatedTranslations >= 100) {
            return "var(--vscode-editorWarning-foreground)";
        }
        // If 100% translated (primary color)
        else if (percentTranslationsCompleted >= 100) {
            return "var(--vscode-charts-blue)";
        }
        // Default styling
        else {
            return isSelected
                ? "var(--vscode-button-background)"
                : "var(--vscode-editorWidget-background)";
        }
    };

    // Helper function to get text color based on background
    const getChapterTextColor = (chapter: number, isSelected: boolean) => {
        if (!chapterProgress || !chapterProgress[chapter]) {
            return isSelected ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)";
        }

        const progress = chapterProgress[chapter];
        const { percentTranslationsCompleted, percentFullyValidatedTranslations } = progress;

        // If progress colors are applied, use contrasting text
        if (percentFullyValidatedTranslations >= 100 || percentTranslationsCompleted >= 100) {
            return "var(--vscode-editor-background)"; // Dark text on colored background
        }

        return isSelected ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)";
    };

    // Calculate position and dimensions
    const calculatePositionAndDimensions = () => {
        if (isOpen && anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Determine available width
            const idealWidth = 600; // Our ideal width
            const availableWidth = Math.min(viewportWidth - 40, idealWidth); // 20px padding on each side

            // Calculate columns based on available width
            // Ensure each cell is at least 32px with 8px gap (40px total per cell)
            const maxColumns = Math.floor(availableWidth / 40);
            setColumns(Math.min(10, Math.max(5, maxColumns))); // Between 5 and 10 columns

            // Calculate centered position
            const left = rect.left + rect.width / 2;
            const centeredLeft = left - availableWidth / 2;

            // Avoid going off screen to the left
            const adjustedLeft = Math.max(20, centeredLeft);

            // Avoid going off screen to the right
            const rightEdge = adjustedLeft + availableWidth;
            const finalLeft =
                rightEdge > viewportWidth - 20 ? viewportWidth - 20 - availableWidth : adjustedLeft;

            // Determine if dropdown should appear above or below
            const spaceBelow = viewportHeight - rect.bottom;
            const spaceAbove = rect.top;
            const maxHeight = Math.min(500, viewportHeight - 80); // Maximum height with 40px padding top and bottom

            let topPosition;
            const arrowPos: "top" | "bottom" =
                spaceBelow >= maxHeight || spaceBelow >= spaceAbove ? "top" : "bottom";

            if (arrowPos === "top") {
                // Place below the button
                topPosition = rect.bottom + window.scrollY;
            } else {
                // Place above the button
                topPosition = rect.top + window.scrollY - maxHeight - 16; // 16px for the arrow
            }

            setDropdownPosition({
                top: topPosition,
                left: finalLeft,
                width: availableWidth,
            });

            // Update arrow position
            setArrowPosition(arrowPos);
        }
    };

    // Calculate position and size based on the anchor element and viewport
    useEffect(() => {
        calculatePositionAndDimensions();
    }, [isOpen]);

    // Add resize listener to handle window size changes while dropdown is open
    useEffect(() => {
        if (isOpen) {
            const handleResize = () => {
                calculatePositionAndDimensions();
            };

            window.addEventListener("resize", handleResize);

            return () => {
                window.removeEventListener("resize", handleResize);
            };
        }
    }, [isOpen]);

    // Focus trap and ESC key handling
    useEffect(() => {
        if (isOpen && modalRef.current) {
            // Auto-focus the modal when opened
            modalRef.current.focus();

            // Handle ESC key press
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === "Escape") {
                    onClose();
                }
            };

            document.addEventListener("keydown", handleKeyDown);

            // Close when clicking outside
            const handleClickOutside = (e: MouseEvent) => {
                if (
                    modalRef.current &&
                    !modalRef.current.contains(e.target as Node) &&
                    anchorRef.current &&
                    !anchorRef.current.contains(e.target as Node)
                ) {
                    onClose();
                }
            };

            document.addEventListener("mousedown", handleClickOutside);

            return () => {
                document.removeEventListener("keydown", handleKeyDown);
                document.removeEventListener("mousedown", handleClickOutside);
            };
        }
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // Calculate where to display the arrow relative to button center
    const buttonCenterX = anchorRef.current
        ? anchorRef.current.getBoundingClientRect().left +
          anchorRef.current.getBoundingClientRect().width / 2
        : 0;

    const arrowLeft = buttonCenterX - dropdownPosition.left;
    const arrowLeftPercent = Math.min(Math.max((arrowLeft / dropdownPosition.width) * 100, 10), 90); // Keep between 10% and 90%

    return (
        <div
            ref={modalRef}
            className="chapter-selector-dropdown"
            tabIndex={-1}
            style={{
                position: "absolute",
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                width: `${dropdownPosition.width}px`,
                backgroundColor: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-widget-border)",
                borderRadius: "6px",
                boxShadow: "0 6px 16px rgba(0, 0, 0, 0.15)",
                padding: "16px",
                zIndex: 9999,
                overflowY: "auto",
                maxHeight: "min(60vh, 500px)",
                marginTop: arrowPosition === "top" ? "8px" : "0",
                marginBottom: arrowPosition === "bottom" ? "8px" : "0",
                transformOrigin: arrowPosition === "top" ? "top center" : "bottom center",
            }}
        >
            {/* Dropdown arrow */}
            {arrowPosition === "top" && (
                <div
                    style={{
                        position: "absolute",
                        top: "-8px",
                        left: `${arrowLeftPercent}%`,
                        transform: "translateX(-50%) rotate(45deg)",
                        width: "16px",
                        height: "16px",
                        backgroundColor: "var(--vscode-editor-background)",
                        border: "1px solid var(--vscode-widget-border)",
                        borderBottom: "none",
                        borderRight: "none",
                        zIndex: 9998,
                    }}
                />
            )}

            {arrowPosition === "bottom" && (
                <div
                    style={{
                        position: "absolute",
                        bottom: "-8px",
                        left: `${arrowLeftPercent}%`,
                        transform: "translateX(-50%) rotate(45deg)",
                        width: "16px",
                        height: "16px",
                        backgroundColor: "var(--vscode-editor-background)",
                        border: "1px solid var(--vscode-widget-border)",
                        borderTop: "none",
                        borderLeft: "none",
                        zIndex: 9998,
                    }}
                />
            )}

            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold m-0">{bookTitle}</h2>
                <Button onClick={onClose}>
                    <i className="codicon codicon-close" />
                </Button>
            </div>

            <div
                className="grid gap-2"
                style={{
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                }}
            >
                {Array.from({ length: totalChapters }, (_, i) => i + 1).map((chapter) => {
                    const isSelected = currentChapter === chapter;
                    const backgroundColor = getChapterBackgroundColor(chapter, isSelected);
                    const textColor = getChapterTextColor(chapter, isSelected);

                    return (
                        <div
                            key={chapter}
                            onClick={() => {
                                if (!unsavedChanges) {
                                    onSelectChapter(chapter);
                                    onClose();
                                }
                            }}
                            className={`aspect-square flex items-center justify-center rounded cursor-pointer transition-all relative overflow-hidden min-w-[32px] min-h-[32px] ${
                                unsavedChanges ? "opacity-60 cursor-not-allowed" : ""
                            } ${isSelected ? "font-semibold" : ""}`}
                            style={{
                                backgroundColor,
                                color: textColor,
                                border: isSelected
                                    ? "2px solid var(--vscode-focusBorder)"
                                    : "1px solid var(--vscode-widget-border)",
                                // Add a subtle shadow for better distinction
                                boxShadow: isSelected
                                    ? "0 0 0 1px var(--vscode-focusBorder)"
                                    : "none",
                            }}
                        >
                            {isSelected && (
                                <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 flex items-center justify-center">
                                    <i
                                        className="codicon codicon-check"
                                        style={{ fontSize: "8px", color: textColor }}
                                    />
                                </div>
                            )}
                            {chapter}
                        </div>
                    );
                })}
            </div>

            {unsavedChanges && (
                <div className="mt-4 p-2 bg-inputValidation-warningBackground text-inputValidation-warningForeground border border-inputValidation-warningBorder rounded flex items-center gap-2 text-sm">
                    <i className="codicon codicon-warning" />
                    <span>Save changes first to change chapter</span>
                </div>
            )}
        </div>
    );
}
