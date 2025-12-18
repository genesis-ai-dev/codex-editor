"use client";

import React, { useState, useEffect, useRef } from "react";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "../../components/ui/accordion";
import { ProgressDots } from "./ProgressDots";
import { deriveSubsectionPercentages, getProgressColor } from "../utils/progressUtils";
import MicrophoneIcon from "../../components/ui/icons/MicrophoneIcon";
import { Languages } from "lucide-react";
import type { Subsection, ProgressPercentages } from "../../lib/types";
import type { MilestoneIndex, MilestoneInfo } from "../../../../../types";

interface MilestoneAccordionProps {
    isOpen: boolean;
    onClose: () => void;
    milestoneIndex: MilestoneIndex | null;
    currentMilestoneIndex: number;
    currentSubsectionIndex: number;
    getSubsectionsForMilestone: (milestoneIdx: number) => Subsection[];
    requestCellsForMilestone: (milestoneIdx: number, subsectionIdx?: number) => void;
    subsectionProgress?: Record<number, ProgressPercentages>;
    unsavedChanges: boolean;
    anchorRef: React.RefObject<HTMLDivElement>;
    calculateSubsectionProgress: (
        subsection: Subsection,
        subsectionIndex: number
    ) => {
        isFullyTranslated: boolean;
        isFullyValidated: boolean;
        percentTranslationsCompleted?: number;
        percentTextValidatedTranslations?: number;
        percentAudioTranslationsCompleted?: number;
        percentAudioValidatedTranslations?: number;
    };
}

export function MilestoneAccordion({
    isOpen,
    onClose,
    milestoneIndex,
    currentMilestoneIndex,
    currentSubsectionIndex,
    getSubsectionsForMilestone,
    requestCellsForMilestone,
    subsectionProgress,
    unsavedChanges,
    anchorRef,
    calculateSubsectionProgress,
}: MilestoneAccordionProps) {
    const accordionRef = useRef<HTMLDivElement>(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
    const [arrowPosition, setArrowPosition] = useState<"top" | "bottom">("top");

    // Calculate position and dimensions
    const calculatePositionAndDimensions = () => {
        if (isOpen && anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Determine available width
            const idealWidth = 400;
            const availableWidth = Math.min(viewportWidth - 40, idealWidth);

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
            const maxHeight = Math.min(500, viewportHeight - 80);

            let topPosition;
            const arrowPos: "top" | "bottom" =
                spaceBelow >= maxHeight || spaceBelow >= spaceAbove ? "top" : "bottom";

            if (arrowPos === "top") {
                topPosition = rect.bottom + window.scrollY;
            } else {
                topPosition = rect.top + window.scrollY - maxHeight - 16;
            }

            setDropdownPosition({
                top: topPosition,
                left: finalLeft,
                width: availableWidth,
            });

            setArrowPosition(arrowPos);
        }
    };

    // Calculate position and size based on the anchor element and viewport
    useEffect(() => {
        calculatePositionAndDimensions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Focus trap and ESC key handling
    useEffect(() => {
        if (isOpen && accordionRef.current) {
            // Auto-focus the accordion when opened
            accordionRef.current.focus();

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
                    accordionRef.current &&
                    !accordionRef.current.contains(e.target as Node) &&
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
    }, [isOpen, onClose, anchorRef]);

    if (!isOpen || !milestoneIndex) return null;

    // Get milestone progress
    const getMilestoneProgress = (milestoneIdx: number) => {
        // milestoneProgress uses 1-based keys
        const progress = milestoneIndex.milestoneProgress?.[milestoneIdx + 1];
        if (!progress) {
            return {
                textValidatedPercent: 0,
                textCompletedPercent: 0,
                audioValidatedPercent: 0,
                audioCompletedPercent: 0,
            };
        }

        return deriveSubsectionPercentages({
            percentTranslationsCompleted: progress.percentTranslationsCompleted,
            percentTextValidatedTranslations: progress.percentTextValidatedTranslations,
            percentAudioTranslationsCompleted: progress.percentAudioTranslationsCompleted,
            percentAudioValidatedTranslations: progress.percentAudioValidatedTranslations,
            isFullyTranslated: progress.percentTranslationsCompleted === 100,
            isFullyValidated: progress.percentFullyValidatedTranslations === 100,
        });
    };

    // Handle milestone header click - navigate to first subsection
    const handleMilestoneClick = (milestoneIdx: number) => {
        if (!unsavedChanges) {
            requestCellsForMilestone(milestoneIdx, 0);
            onClose();
        }
    };

    // Handle subsection click
    const handleSubsectionClick = (milestoneIdx: number, subsectionIdx: number) => {
        if (!unsavedChanges) {
            requestCellsForMilestone(milestoneIdx, subsectionIdx);
            onClose();
        }
    };

    // Calculate where to display the arrow relative to button center
    const buttonCenterX = anchorRef.current
        ? anchorRef.current.getBoundingClientRect().left +
          anchorRef.current.getBoundingClientRect().width / 2
        : 0;

    const arrowLeft = buttonCenterX - dropdownPosition.left;
    const arrowLeftPercent = Math.min(Math.max((arrowLeft / dropdownPosition.width) * 100, 10), 90);

    return (
        <div
            ref={accordionRef}
            className="milestone-accordion-dropdown focus-visible:outline-none"
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
                <h2 className="text-lg font-semibold m-0">Milestones</h2>
                <div
                    className="flex items-center cursor-pointer hover:bg-secondary rounded-md p-1"
                    onClick={onClose}
                >
                    <i className="codicon codicon-close" />
                </div>
            </div>

            <Accordion
                type="single"
                collapsible
                defaultValue={currentMilestoneIndex.toString()}
                className="w-full"
            >
                {milestoneIndex.milestones.map((milestone: MilestoneInfo, milestoneIdx: number) => {
                    const subsections = getSubsectionsForMilestone(milestoneIdx);
                    const milestoneProgress = getMilestoneProgress(milestoneIdx);
                    const isCurrentMilestone = currentMilestoneIndex === milestoneIdx;

                    // Get progress colors for icons
                    const audioColorClass = getProgressColor(
                        milestoneProgress.audioValidatedPercent,
                        milestoneProgress.audioCompletedPercent
                    );
                    const textColorClass = getProgressColor(
                        milestoneProgress.textValidatedPercent,
                        milestoneProgress.textCompletedPercent
                    );

                    return (
                        <AccordionItem key={milestoneIdx} value={milestoneIdx.toString()}>
                            <AccordionTrigger className={"hover:no-underline px-2"}>
                                <div className="flex items-center justify-between w-full">
                                    <div className="flex justify-between items-center gap-3 flex-1 min-w-0">
                                        <span
                                            className="font-medium truncate cursor-pointer hover:underline milestone-navigate"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleMilestoneClick(milestoneIdx);
                                            }}
                                        >
                                            {milestone.value}
                                        </span>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <div
                                                className={`flex items-center ${audioColorClass}`}
                                                title={`Audio: ${Math.round(
                                                    milestoneProgress.audioCompletedPercent
                                                )}% completed, ${Math.round(
                                                    milestoneProgress.audioValidatedPercent
                                                )}% validated`}
                                            >
                                                <MicrophoneIcon width={14} height={14} />
                                            </div>
                                            <div
                                                className={`flex items-center ${textColorClass}`}
                                                title={`Text: ${Math.round(
                                                    milestoneProgress.textCompletedPercent
                                                )}% completed, ${Math.round(
                                                    milestoneProgress.textValidatedPercent
                                                )}% validated`}
                                            >
                                                <Languages className="h-[14px] w-[14px]" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                {subsections.length > 0 ? (
                                    <div className="space-y-1 pt-2">
                                        {subsections.map((subsection, subsectionIdx) => {
                                            const progress = calculateSubsectionProgress(
                                                subsection,
                                                subsectionIdx
                                            );
                                            const percentages =
                                                deriveSubsectionPercentages(progress);
                                            const isActive =
                                                isCurrentMilestone &&
                                                currentSubsectionIndex === subsectionIdx;

                                            return (
                                                <div
                                                    key={subsection.id}
                                                    onClick={() =>
                                                        handleSubsectionClick(
                                                            milestoneIdx,
                                                            subsectionIdx
                                                        )
                                                    }
                                                    className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors ${
                                                        isActive
                                                            ? "bg-accent text-accent-foreground font-semibold"
                                                            : unsavedChanges
                                                            ? "opacity-60 cursor-not-allowed"
                                                            : "hover:bg-secondary"
                                                    }`}
                                                >
                                                    <span>{subsection.label}</span>
                                                    <ProgressDots
                                                        audio={{
                                                            validatedPercent:
                                                                percentages.audioValidatedPercent,
                                                            completedPercent:
                                                                percentages.audioCompletedPercent,
                                                        }}
                                                        text={{
                                                            validatedPercent:
                                                                percentages.textValidatedPercent,
                                                            completedPercent:
                                                                percentages.textCompletedPercent,
                                                        }}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground py-2 px-3">
                                        No subsections
                                    </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>

            {unsavedChanges && (
                <div className="mt-4 p-2 bg-inputValidation-warningBackground text-inputValidation-warningForeground border border-inputValidation-warningBorder rounded flex items-center gap-2 text-sm">
                    <i className="codicon codicon-warning" />
                    <span>Save changes first to change section</span>
                </div>
            )}
        </div>
    );
}
