"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";
import { ProgressPercentages } from "../../lib/types";

interface ChapterSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectChapter: (chapter: number) => void;
    currentChapter: number;
    totalChapters: number;
    bookTitle: string;
    unsavedChanges: boolean;
    anchorRef: React.RefObject<HTMLDivElement>;
    chapterProgress?: Record<number, ProgressPercentages>;
}

interface ChapterColor {
    audioBackgroundColor: string;
    textBackgroundColor: string;
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

    const getProgressColor = (validatedPercent: number, completedPercent: number): string => {
        if (validatedPercent >= 100) return "text-editor-warning-foreground";
        if (completedPercent >= 100) return "text-charts-blue";
        if (validatedPercent > 0 && validatedPercent < 100) return "text-muted-foreground/80";
        return "text-muted-foreground/25";
    };

    const getChapterColor = (chapter: number): ChapterColor => {
        if (!chapterProgress || !chapterProgress[chapter]) {
            return {
                audioBackgroundColor: "text-muted-foreground/25",
                textBackgroundColor: "text-muted-foreground/25",
            };
        }

        const {
            percentAudioValidatedTranslations,
            percentTextValidatedTranslations,
            percentTranslationsCompleted,
            percentAudioTranslationsCompleted,
        } = chapterProgress[chapter];

        const textBackgroundColor = getProgressColor(
            percentTextValidatedTranslations,
            percentTranslationsCompleted
        );
        const audioBackgroundColor = getProgressColor(
            percentAudioValidatedTranslations,
            percentAudioTranslationsCompleted
        );

        return {
            audioBackgroundColor: audioBackgroundColor,
            textBackgroundColor: textBackgroundColor,
        };
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
            className="chapter-selector-dropdown focus-visible:outline-none"
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
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold m-0">{bookTitle}</h2>
                <div
                    className="flex items-center cursor-pointer hover:bg-secondary rounded-md p-1"
                    onClick={onClose}
                >
                    <i className="codicon codicon-close" />
                </div>
            </div>

            <div
                className="grid gap-2"
                style={{
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                }}
            >
                {Array.from({ length: totalChapters }, (_, i) => i + 1).map((chapter) => {
                    const isSelected = currentChapter === chapter;
                    const { textBackgroundColor, audioBackgroundColor } = getChapterColor(chapter);

                    return (
                        <div
                            key={chapter}
                            onClick={() => {
                                if (!unsavedChanges) {
                                    onSelectChapter(chapter);
                                    onClose();
                                }
                            }}
                            className={`aspect-[3/4] flex items-center justify-center rounded cursor-pointer transition-all relative overflow-hidden min-w-[40px] min-h-[40px] bg-gray-50 ${
                                unsavedChanges ? "opacity-60 cursor-not-allowed" : ""
                            } ${isSelected ? "font-semibold" : ""}`}
                            style={{
                                color: "var(--vscode-foreground)",
                                border: isSelected
                                    ? "2px solid var(--vscode-focusBorder)"
                                    : "1px solid var(--vscode-widget-border)",
                                // Add a subtle shadow for better distinction
                                boxShadow: isSelected
                                    ? "0 0 0 1px var(--vscode-focusBorder)"
                                    : "none",
                            }}
                        >
                            <div className="flex flex-col items-center justify-center w-full h-full">
                                <div className="flex w-full h-full justify-center items-center bg-[var(--background)] shadow-sm">
                                    {chapter}
                                </div>
                                <div className="flex w-full items-center justify-center p-[4px] border-t border-[var(--vscode-widget-border)]">
                                    <div
                                        className={`flex w-full justify-center items-center ${audioBackgroundColor}`}
                                    >
                                        <svg
                                            viewBox="0 0 64 64"
                                            width="14"
                                            height="14"
                                            aria-hidden="true"
                                        >
                                            <path
                                                fill="currentColor"
                                                d="M32,44c6.629,0,12-5.371,12-12V12c0-6.629-5.371-12-12-12S20,5.371,20,12v20C20,38.629,25.371,44,32,44z"
                                            />
                                            <path
                                                fill="currentColor"
                                                d="M52,28c-2.211,0-4,1.789-4,4c0,8.836-7.164,16-16,16s-16-7.164-16-16c0-2.211-1.789-4-4-4s-4,1.789-4,4
                                                    c0,11.887,8.656,21.73,20,23.641V60c0,2.211,1.789,4,4,4s4-1.789,4-4v-4.359C47.344,53.73,56,43.887,56,32
                                                    C56,29.789,54.211,28,52,28z"
                                            />
                                        </svg>
                                    </div>
                                    <div
                                        className={`flex w-full justify-center items-center ${textBackgroundColor}`}
                                    >
                                        <svg
                                            viewBox="0 0 512 512"
                                            width="14"
                                            height="14"
                                            aria-hidden="true"
                                        >
                                            <path
                                                fill="currentColor"
                                                d="M478.33,433.6l-90-218a22,22,0,0,0-40.67,0l-90,218a22,22,0,1,0,40.67,16.79L316.66,406H419.33l18.33,44.39A22,22,0,0,0,458,464a22,22,0,0,0,20.32-30.4ZM334.83,362,368,281.65,401.17,362Z"
                                            />
                                            <path
                                                fill="currentColor"
                                                d="M267.84,342.92a22,22,0,0,0-4.89-30.7c-.2-.15-15-11.13-36.49-34.73,39.65-53.68,62.11-114.75,71.27-143.49H330a22,22,0,0,0,0-44H214V70a22,22,0,0,0-44,0V90H54a22,22,0,0,0,0,44H251.25c-9.52,26.95-27.05,69.5-53.79,108.36-31.41-41.68-43.08-68.65-43.17-68.87a22,22,0,0,0-40.58,17c.58,1.38,14.55,34.23,52.86,83.93.92,1.19,1.83,2.35,2.74,3.51-39.24,44.35-77.74,71.86-93.85,80.74a22,22,0,1,0,21.07,38.63c2.16-1.18,48.6-26.89,101.63-85.59,22.52,24.08,38,35.44,38.93,36.1a22,22,0,0,0,30.75-4.9Z"
                                            />
                                        </svg>
                                    </div>
                                </div>
                            </div>
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
