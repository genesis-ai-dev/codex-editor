"use client";

import React, { useState, useEffect, useRef } from "react";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "../../components/ui/accordion";
import { ProgressDots } from "./ProgressDots";
import {
    deriveSubsectionPercentages,
    getProgressColor,
    getProgressDisplay,
} from "../utils/progressUtils";
import MicrophoneIcon from "../../components/ui/icons/MicrophoneIcon";
import { Languages } from "lucide-react";
import type { Subsection, ProgressPercentages } from "../../lib/types";
import type { MilestoneIndex, MilestoneInfo } from "../../../../../types";

const MAX_VALIDATION_LEVELS = 15;

interface MilestoneAccordionProps {
    isOpen: boolean;
    onClose: () => void;
    milestoneIndex: MilestoneIndex | null;
    currentMilestoneIndex: number;
    currentSubsectionIndex: number;
    getSubsectionsForMilestone: (milestoneIdx: number) => Subsection[];
    requestCellsForMilestone: (milestoneIdx: number, subsectionIdx?: number) => void;
    allSubsectionProgress?: Record<number, Record<number, ProgressPercentages>>;
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
        textValidationLevels?: number[];
        audioValidationLevels?: number[];
        requiredTextValidations?: number;
        requiredAudioValidations?: number;
    };
    requestSubsectionProgress?: (milestoneIdx: number) => void;
}

export function MilestoneAccordion({
    isOpen,
    onClose,
    milestoneIndex,
    currentMilestoneIndex,
    currentSubsectionIndex,
    getSubsectionsForMilestone,
    requestCellsForMilestone,
    allSubsectionProgress,
    unsavedChanges,
    anchorRef,
    calculateSubsectionProgress,
    requestSubsectionProgress,
}: MilestoneAccordionProps) {
    // Layout constants
    const DROPDOWN_MAX_HEIGHT_VIEWPORT_PERCENT = 60; // 60vh
    const DROPDOWN_MAX_HEIGHT_PIXELS = 500; // px
    const DROPDOWN_HEADER_HEIGHT = 60; // px - approximate height of header with padding
    const DROPDOWN_IDEAL_WIDTH = 400; // px
    const DROPDOWN_EDGE_PADDING = 20; // px - minimum distance from viewport edges
    const DROPDOWN_WIDTH_PADDING = 40; // px - total horizontal padding for width calculation
    const DROPDOWN_ARROW_MARGIN = 8; // px - margin for arrow positioning
    const DROPDOWN_ARROW_SPACING = 16; // px - spacing when positioning above anchor
    const DROPDOWN_VIEWPORT_HEIGHT_OFFSET = 80; // px - reserved space from viewport edges
    const DROPDOWN_BORDER_RADIUS = 6; // px
    const DROPDOWN_Z_INDEX = 9999;

    const accordionRef = useRef<HTMLDivElement>(null);
    const currentMilestoneRef = useRef<HTMLDivElement>(null);
    const currentSubsectionRef = useRef<HTMLDivElement>(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
    const [arrowPosition, setArrowPosition] = useState<"top" | "bottom">("top");
    const [expandedMilestone, setExpandedMilestone] = useState<string | null>(
        currentMilestoneIndex.toString()
    );

    // Calculate position and dimensions
    const calculatePositionAndDimensions = () => {
        if (isOpen && anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Determine available width
            const idealWidth = DROPDOWN_IDEAL_WIDTH;
            const availableWidth = Math.min(viewportWidth - DROPDOWN_WIDTH_PADDING, idealWidth);

            // Calculate centered position
            const left = rect.left + rect.width / 2;
            const centeredLeft = left - availableWidth / 2;

            // Avoid going off screen to the left
            const adjustedLeft = Math.max(DROPDOWN_EDGE_PADDING, centeredLeft);

            // Avoid going off screen to the right
            const rightEdge = adjustedLeft + availableWidth;
            const finalLeft =
                rightEdge > viewportWidth - DROPDOWN_EDGE_PADDING
                    ? viewportWidth - DROPDOWN_EDGE_PADDING - availableWidth
                    : adjustedLeft;

            // Determine if dropdown should appear above or below
            const spaceBelow = viewportHeight - rect.bottom;
            const spaceAbove = rect.top;
            const maxHeight = Math.min(
                DROPDOWN_MAX_HEIGHT_PIXELS,
                viewportHeight - DROPDOWN_VIEWPORT_HEIGHT_OFFSET
            );

            let topPosition;
            const arrowPos: "top" | "bottom" =
                spaceBelow >= maxHeight || spaceBelow >= spaceAbove ? "top" : "bottom";

            if (arrowPos === "top") {
                topPosition = rect.bottom + window.scrollY;
            } else {
                topPosition = rect.top + window.scrollY - maxHeight - DROPDOWN_ARROW_SPACING;
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

    // Sync expanded milestone state when accordion opens
    useEffect(() => {
        if (isOpen) {
            setExpandedMilestone(currentMilestoneIndex.toString());
        }
    }, [isOpen, currentMilestoneIndex]);

    // Request progress when milestone is expanded
    useEffect(() => {
        if (isOpen && expandedMilestone !== null && requestSubsectionProgress) {
            const milestoneIdx = parseInt(expandedMilestone);
            if (!isNaN(milestoneIdx)) {
                // Check if progress exists for this milestone in allSubsectionProgress
                const hasProgress = allSubsectionProgress?.[milestoneIdx] !== undefined;
                if (!hasProgress) {
                    requestSubsectionProgress(milestoneIdx);
                }
            }
        }
    }, [isOpen, expandedMilestone, allSubsectionProgress, requestSubsectionProgress]);

    // Helper function to calculate progress for a specific milestone's subsection
    const calculateSubsectionProgressForMilestone = (
        milestoneIdx: number,
        subsection: Subsection,
        subsectionIndex: number
    ) => {
        // Use progress from allSubsectionProgress if available for this milestone
        if (allSubsectionProgress?.[milestoneIdx]?.[subsectionIndex] !== undefined) {
            const backendProgress = allSubsectionProgress[milestoneIdx][subsectionIndex];
            return {
                isFullyTranslated: backendProgress.percentTranslationsCompleted === 100,
                isFullyValidated: backendProgress.percentFullyValidatedTranslations === 100,
                percentTranslationsCompleted: backendProgress.percentTranslationsCompleted,
                percentAudioTranslationsCompleted:
                    backendProgress.percentAudioTranslationsCompleted,
                percentFullyValidatedTranslations:
                    backendProgress.percentFullyValidatedTranslations,
                percentAudioValidatedTranslations:
                    backendProgress.percentAudioValidatedTranslations,
                percentTextValidatedTranslations: backendProgress.percentTextValidatedTranslations,
                textValidationLevels: backendProgress.textValidationLevels,
                audioValidationLevels: backendProgress.audioValidationLevels,
                requiredTextValidations: backendProgress.requiredTextValidations,
                requiredAudioValidations: backendProgress.requiredAudioValidations,
            };
        }

        // Fall back to calculateSubsectionProgress for current milestone
        if (milestoneIdx === currentMilestoneIndex) {
            return calculateSubsectionProgress(subsection, subsectionIndex);
        }

        // Return default values if progress is not available
        return {
            isFullyTranslated: false,
            isFullyValidated: false,
            percentTranslationsCompleted: 0,
            percentAudioTranslationsCompleted: 0,
            percentFullyValidatedTranslations: 0,
            percentAudioValidatedTranslations: 0,
            percentTextValidatedTranslations: 0,
            textValidationLevels: undefined,
            audioValidationLevels: undefined,
            requiredTextValidations: undefined,
            requiredAudioValidations: undefined,
        };
    };

    // Scroll to current subsection when accordion opens
    useEffect(() => {
        if (isOpen && accordionRef.current) {
            // Wait for accordion animation to complete before scrolling
            const timeoutId = setTimeout(() => {
                // Prefer scrolling to the subsection if available, otherwise fall back to milestone
                const targetElement = currentSubsectionRef.current || currentMilestoneRef.current;
                if (!targetElement) return;

                // Find the scrollable container (the div with overflow-y-auto)
                const scrollContainer = accordionRef.current?.querySelector(
                    '[class*="overflow-y-auto"]'
                ) as HTMLElement;

                // Get the element's position relative to the scroll container
                const elementTop = targetElement.offsetTop;

                // Calculate scroll position to show the element at the top of visible area
                // accounting for the header height.
                const scrollPosition = elementTop - DROPDOWN_HEADER_HEIGHT;

                scrollContainer.scrollTo({
                    top: Math.max(0, scrollPosition),
                    behavior: "smooth",
                });
            }, 200);

            return () => clearTimeout(timeoutId);
        }
    }, [isOpen, currentMilestoneIndex, currentSubsectionIndex]);

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

    // Helper function to aggregate validation levels from all subsections for a milestone
    const getMilestoneValidationLevels = (milestoneIdx: number) => {
        const subsections = getSubsectionsForMilestone(milestoneIdx);
        const subsectionProgressData = allSubsectionProgress?.[milestoneIdx];

        if (!subsectionProgressData || subsections.length === 0) {
            return {
                textValidationLevels: undefined,
                audioValidationLevels: undefined,
                requiredTextValidations: undefined,
                requiredAudioValidations: undefined,
            };
        }

        // Collect validation level arrays from all subsections
        const textValidationLevelsArrays: number[][] = [];
        const audioValidationLevelsArrays: number[][] = [];
        let maxRequiredTextValidations = 0;
        let maxRequiredAudioValidations = 0;

        subsections.forEach((_, subsectionIdx) => {
            const progress = subsectionProgressData[subsectionIdx];
            if (progress) {
                if (progress.textValidationLevels) {
                    textValidationLevelsArrays.push(progress.textValidationLevels);
                }
                if (progress.audioValidationLevels) {
                    audioValidationLevelsArrays.push(progress.audioValidationLevels);
                }
                if (progress.requiredTextValidations) {
                    maxRequiredTextValidations = Math.max(
                        maxRequiredTextValidations,
                        progress.requiredTextValidations
                    );
                }
                if (progress.requiredAudioValidations) {
                    maxRequiredAudioValidations = Math.max(
                        maxRequiredAudioValidations,
                        progress.requiredAudioValidations
                    );
                }
            }
        });

        // Average the validation level percentages across subsections
        const averageLevels = (levelArrays: number[][]): number[] | undefined => {
            if (levelArrays.length === 0) return undefined;

            const maxLength = Math.max(...levelArrays.map((arr) => arr.length));
            if (maxLength === 0) return undefined;

            const averaged: number[] = [];
            for (let i = 0; i < maxLength; i++) {
                let sum = 0;
                let count = 0;
                levelArrays.forEach((arr) => {
                    if (i < arr.length) {
                        sum += arr[i];
                        count++;
                    }
                });
                averaged.push(count > 0 ? sum / count : 0);
            }
            return averaged;
        };

        return {
            textValidationLevels: averageLevels(textValidationLevelsArrays),
            audioValidationLevels: averageLevels(audioValidationLevelsArrays),
            requiredTextValidations:
                maxRequiredTextValidations > 0 ? maxRequiredTextValidations : undefined,
            requiredAudioValidations:
                maxRequiredAudioValidations > 0 ? maxRequiredAudioValidations : undefined,
        };
    };

    // Handle subsection click
    const handleSubsectionClick = (milestoneIdx: number, subsectionIdx: number) => {
        if (!unsavedChanges) {
            requestCellsForMilestone(milestoneIdx, subsectionIdx);
            onClose();
        }
    };

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
                borderRadius: `${DROPDOWN_BORDER_RADIUS}px`,
                boxShadow: "0 6px 16px rgba(0, 0, 0, 0.15)",
                padding: "0",
                zIndex: DROPDOWN_Z_INDEX,
                display: "flex",
                flexDirection: "column",
                maxHeight: `min(${DROPDOWN_MAX_HEIGHT_VIEWPORT_PERCENT}vh, ${DROPDOWN_MAX_HEIGHT_PIXELS}px)`,
                marginTop: arrowPosition === "top" ? `${DROPDOWN_ARROW_MARGIN}px` : "0",
                marginBottom: arrowPosition === "bottom" ? `${DROPDOWN_ARROW_MARGIN}px` : "0",
                transformOrigin: arrowPosition === "top" ? "top center" : "bottom center",
            }}
        >
            <div className="flex items-center justify-between px-4 pt-4 pb-2 mb-2 border-b border-[var(--vscode-widget-border)] flex-shrink-0">
                <h2 className="text-lg font-semibold m-0">
                    {expandedMilestone !== null &&
                    milestoneIndex.milestones[parseInt(expandedMilestone)]
                        ? milestoneIndex.milestones[parseInt(expandedMilestone)].value
                        : milestoneIndex.milestones[currentMilestoneIndex]?.value}
                </h2>
                <div
                    className="flex items-center cursor-pointer hover:bg-secondary rounded-md p-1"
                    onClick={onClose}
                >
                    <i className="codicon codicon-close" />
                </div>
            </div>
            <div
                className="px-4 pb-4 overflow-y-auto overflow-x-hidden flex-1 min-h-0"
                style={{
                    maxHeight: `calc(min(${DROPDOWN_MAX_HEIGHT_VIEWPORT_PERCENT}vh, ${DROPDOWN_MAX_HEIGHT_PIXELS}px) - ${DROPDOWN_HEADER_HEIGHT}px)`,
                }}
            >
                <Accordion
                    type="single"
                    collapsible
                    value={expandedMilestone ?? undefined}
                    onValueChange={(value) => setExpandedMilestone(value ?? null)}
                    className="w-full"
                >
                    {milestoneIndex.milestones.map(
                        (milestone: MilestoneInfo, milestoneIdx: number) => {
                            const subsections = getSubsectionsForMilestone(milestoneIdx);
                            const milestoneProgress = getMilestoneProgress(milestoneIdx);
                            const isCurrentMilestone = currentMilestoneIndex === milestoneIdx;

                            // Get validation level data for this milestone
                            const validationLevels = getMilestoneValidationLevels(milestoneIdx);

                            // Get progress display info using getProgressDisplay (like ProgressDots)
                            const audioDisplay = getProgressDisplay(
                                milestoneProgress.audioValidatedPercent,
                                milestoneProgress.audioCompletedPercent,
                                "Audio",
                                validationLevels.audioValidationLevels,
                                validationLevels.requiredAudioValidations
                            );
                            const textDisplay = getProgressDisplay(
                                milestoneProgress.textValidatedPercent,
                                milestoneProgress.textCompletedPercent,
                                "Text",
                                validationLevels.textValidationLevels,
                                validationLevels.requiredTextValidations
                            );

                            // Helper function to get icon style (similar to getDotStyle in ProgressDots)
                            const getIconStyle = (
                                colorClass: string,
                                completedLevels: number,
                                isTextCompleted: boolean,
                                requiredValidations?: number
                            ) => {
                                // Only apply progressive darkness when text is fully translated
                                if (isTextCompleted && colorClass === "text-charts-blue-dark") {
                                    const maxLevels = Math.min(
                                        requiredValidations || 1,
                                        MAX_VALIDATION_LEVELS
                                    );
                                    const brightnessRange = 0.55; // 0.95 to 0.4
                                    const baseBrightness = 0.95;
                                    const brightness = Math.max(
                                        0.4, // Minimum darkness (for 15 levels)
                                        baseBrightness -
                                            brightnessRange * (completedLevels / maxLevels)
                                    );

                                    return {
                                        filter: `brightness(${brightness})`,
                                    };
                                }
                                return {};
                            };

                            // Determine if text is fully translated
                            const isTextFullyTranslated =
                                milestoneProgress.textCompletedPercent >= 100;

                            return (
                                <div
                                    key={milestoneIdx}
                                    ref={isCurrentMilestone ? currentMilestoneRef : undefined}
                                >
                                    <AccordionItem
                                        value={milestoneIdx.toString()}
                                        className="border-accent"
                                    >
                                        <AccordionTrigger
                                            className={`hover:no-underline p-2 cursor-pointer [&>svg]:hidden ${
                                                isCurrentMilestone
                                                    ? "bg-accent font-semibold"
                                                    : ""
                                            }`}
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex justify-between items-center gap-3 flex-1 min-w-0">
                                                    <span className="font-medium truncate hover:underline milestone-navigate">
                                                        {milestone.value}
                                                    </span>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <div
                                                            className={`flex items-center ${audioDisplay.colorClass}`}
                                                            style={getIconStyle(
                                                                audioDisplay.colorClass,
                                                                audioDisplay.completedValidationLevels ||
                                                                    0,
                                                                isTextFullyTranslated,
                                                                validationLevels.requiredAudioValidations
                                                            )}
                                                            title={audioDisplay.title}
                                                        >
                                                            <MicrophoneIcon
                                                                width={14}
                                                                height={14}
                                                            />
                                                        </div>
                                                        <div
                                                            className={`flex items-center ${textDisplay.colorClass}`}
                                                            style={getIconStyle(
                                                                textDisplay.colorClass,
                                                                textDisplay.completedValidationLevels ||
                                                                    0,
                                                                isTextFullyTranslated,
                                                                validationLevels.requiredTextValidations
                                                            )}
                                                            title={textDisplay.title}
                                                        >
                                                            <Languages className="h-[14px] w-[14px]" />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="pb-2">
                                            <div className="space-y-1 pt-2">
                                                {subsections.map((subsection, subsectionIdx) => {
                                                    const progress =
                                                        calculateSubsectionProgressForMilestone(
                                                            milestoneIdx,
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
                                                            ref={
                                                                isActive
                                                                    ? currentSubsectionRef
                                                                    : undefined
                                                            }
                                                            onClick={() =>
                                                                handleSubsectionClick(
                                                                    milestoneIdx,
                                                                    subsectionIdx
                                                                )
                                                            }
                                                            className={`flex items-center justify-between pr-3 pl-6 py-2 rounded-md cursor-pointer transition-colors ${
                                                                isActive
                                                                    ? "bg-accent font-semibold"
                                                                    : unsavedChanges
                                                                    ? "opacity-60 cursor-not-allowed"
                                                                    : "hover:bg-secondary"
                                                            }`}
                                                        >
                                                            <span>{subsection.label}</span>
                                                            <ProgressDots
                                                                className="gap-x-[14px]"
                                                                audio={{
                                                                    validatedPercent:
                                                                        percentages.audioValidatedPercent,
                                                                    completedPercent:
                                                                        percentages.audioCompletedPercent,
                                                                    validationLevels:
                                                                        progress.audioValidationLevels,
                                                                    requiredValidations:
                                                                        progress.requiredAudioValidations,
                                                                }}
                                                                text={{
                                                                    validatedPercent:
                                                                        percentages.textValidatedPercent,
                                                                    completedPercent:
                                                                        percentages.textCompletedPercent,
                                                                    validationLevels:
                                                                        progress.textValidationLevels,
                                                                    requiredValidations:
                                                                        progress.requiredTextValidations,
                                                                }}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                </div>
                            );
                        }
                    )}
                </Accordion>

                {unsavedChanges && (
                    <div className="mt-4 p-2 bg-inputValidation-warningBackground text-inputValidation-warningForeground border border-inputValidation-warningBorder rounded flex items-center gap-2 text-sm">
                        <i className="codicon codicon-warning" />
                        <span>Save changes first to change section</span>
                    </div>
                )}
            </div>
        </div>
    );
}
