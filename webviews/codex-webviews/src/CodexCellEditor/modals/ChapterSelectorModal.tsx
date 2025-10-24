"use client";

import React, { useState, useEffect, useRef } from "react";
import { ProgressPercentages } from "../../lib/types";
import { getProgressColor } from "../utils/progressUtils";
import MicrophoneIcon from "../../components/ui/icons/MicrophoneIcon";
import LanguageIcon from "webviews/components/ui/icons/LanguageIcon";

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
                    const cp = chapterProgress?.[chapter];
                    const audioCompletedPercent = Math.round(
                        cp?.percentAudioTranslationsCompleted ?? 0
                    );
                    const audioValidatedPercent = Math.round(
                        cp?.percentAudioValidatedTranslations ?? 0
                    );
                    const textCompletedPercent = Math.round(cp?.percentTranslationsCompleted ?? 0);
                    const textValidatedPercent = Math.round(
                        cp?.percentTextValidatedTranslations ?? 0
                    );
                    const audioTitle = `Audio: ${audioCompletedPercent}% completed, ${audioValidatedPercent}% validated`;
                    const textTitle = `Text: ${textCompletedPercent}% completed, ${textValidatedPercent}% validated`;

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
                                        title={audioTitle}
                                    >
                                        <MicrophoneIcon width={14} height={14} />
                                    </div>
                                    <div
                                        className={`flex w-full justify-center items-center ${textBackgroundColor}`}
                                        title={textTitle}
                                    >
                                        <LanguageIcon width={14} height={14} />
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
