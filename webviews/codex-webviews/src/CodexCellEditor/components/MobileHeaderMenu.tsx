"use client";

import React from "react";
import { Button } from "../../components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Slider } from "../../components/ui/slider";
import { CELL_DISPLAY_MODES } from "../CodexCellEditor";
import {
    type CustomNotebookMetadata,
    type QuillCellContent,
    type MilestoneIndex,
} from "../../../../../types";
import { type Subsection } from "../../lib/types";
import { DropdownMenuCheckboxItem } from "../../components/ui/dropdown-menu";
import { deriveSubsectionPercentages } from "../utils/progressUtils";
import { ProgressDots } from "./ProgressDots";

interface MobileHeaderMenuProps {
    // Translation controls
    isAutocompletingChapter: boolean;
    isTranslatingCell: boolean;
    onAutocompleteClick: () => void;
    onStopTranslation: () => void;
    unsavedChanges: boolean;
    isSourceText: boolean;

    // Settings
    textDirection: "ltr" | "rtl";
    onSetTextDirection: (direction: "ltr" | "rtl") => void;
    cellDisplayMode: CELL_DISPLAY_MODES;
    onSetCellDisplayMode: (mode: CELL_DISPLAY_MODES) => void;

    // Font size
    fontSize: number;
    onFontSizeChange: (value: number[]) => void;

    // Metadata and video
    metadata: CustomNotebookMetadata | undefined;
    onMetadataChange: (key: string, value: string) => void;
    documentHasVideoAvailable: boolean;
    shouldShowVideoPlayer: boolean;
    onToggleVideoPlayer: () => void;
    onOpenMetadataModal: () => void;

    // Page/subsection navigation
    subsections: Subsection[];
    currentSubsectionIndex: number;
    setCurrentSubsectionIndex: React.Dispatch<React.SetStateAction<number>>;

    // Left section controls (source text functionality)
    toggleScrollSync?: () => void;
    scrollSyncEnabled?: boolean;
    openSourceText?: (chapterNumber: number) => void;
    chapterNumber?: number;
    isCorrectionEditorMode?: boolean;

    // VS Code integration
    vscode: any;
    autoDownloadAudioOnOpen?: boolean;
    onToggleAutoDownloadAudio?: (value: boolean) => void;

    // Chapter navigation props (for very small screens)
    totalChapters?: number;
    setChapterNumber?: React.Dispatch<React.SetStateAction<number>>;
    jumpToChapter?: (chapterNumber: number) => void;
    showUnsavedWarning?: () => void;
    getSubsectionsForChapter?: (chapterNum: number) => Subsection[];
    shouldHideNavButtons?: boolean;
    allCellsForChapter?: QuillCellContent[];
    calculateSubsectionProgress?: (
        subsection: Subsection,
        forSourceText?: boolean
    ) => {
        isFullyTranslated: boolean;
        isFullyValidated: boolean;
        percentTranslationsCompleted?: number;
        percentTextValidatedTranslations?: number;
        percentAudioTranslationsCompleted?: number;
        percentAudioValidatedTranslations?: number;
    };

    // Milestone-based pagination props (optional - falls back to chapter-based when not provided)
    milestoneIndex?: MilestoneIndex | null;
    currentMilestoneIndex?: number;
    requestCellsForMilestone?: (milestoneIdx: number, subsectionIdx?: number) => void;
}

export function MobileHeaderMenu({
    isAutocompletingChapter,
    isTranslatingCell,
    onAutocompleteClick,
    onStopTranslation,
    unsavedChanges,
    isSourceText,
    textDirection,
    onSetTextDirection,
    cellDisplayMode,
    onSetCellDisplayMode,
    fontSize,
    onFontSizeChange,
    metadata,
    onMetadataChange,
    documentHasVideoAvailable,
    shouldShowVideoPlayer,
    onToggleVideoPlayer,
    onOpenMetadataModal,
    subsections,
    currentSubsectionIndex,
    setCurrentSubsectionIndex,
    toggleScrollSync,
    scrollSyncEnabled,
    openSourceText,
    chapterNumber,
    isCorrectionEditorMode,
    vscode,
    autoDownloadAudioOnOpen,
    onToggleAutoDownloadAudio,
    totalChapters,
    setChapterNumber,
    jumpToChapter,
    showUnsavedWarning,
    getSubsectionsForChapter,
    shouldHideNavButtons,
    allCellsForChapter,
    calculateSubsectionProgress,
    milestoneIndex,
    currentMilestoneIndex,
    requestCellsForMilestone,
}: MobileHeaderMenuProps) {
    const isAnyTranslationInProgress = isAutocompletingChapter || isTranslatingCell;

    // Determine if using milestone-based navigation
    const useMilestoneNavigation = milestoneIndex && milestoneIndex.milestones.length > 0;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" title="Menu" className="inline-flex">
                    <i className="codicon codicon-menu" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="bottom"
                align="end"
                sideOffset={8}
                className="w-64"
                style={{ zIndex: 99999 }}
            >
                {/* Chapter Navigation Controls - only shown when nav buttons are hidden (very small screens) */}
                {shouldHideNavButtons &&
                    chapterNumber &&
                    totalChapters &&
                    jumpToChapter &&
                    getSubsectionsForChapter && (
                        <>
                            <DropdownMenuItem
                                onClick={() => {
                                    if (!unsavedChanges) {
                                        // Check if we're on the first page of the current chapter
                                        if (currentSubsectionIndex > 0) {
                                            // Move to previous page within the same chapter
                                            setCurrentSubsectionIndex(currentSubsectionIndex - 1);
                                        } else {
                                            // Move to previous chapter
                                            const newChapter =
                                                chapterNumber === 1
                                                    ? totalChapters
                                                    : chapterNumber - 1;
                                            jumpToChapter(newChapter);

                                            // When jumping to a new chapter, check if it has subsections
                                            // and if so, jump to the last page
                                            const newChapterSubsections =
                                                getSubsectionsForChapter(newChapter);
                                            if (newChapterSubsections.length > 0) {
                                                setCurrentSubsectionIndex(
                                                    newChapterSubsections.length - 1
                                                );
                                            }
                                        }
                                    } else if (showUnsavedWarning) {
                                        showUnsavedWarning();
                                    }
                                }}
                                className="cursor-pointer"
                            >
                                <i className="codicon codicon-chevron-left mr-2 h-4 w-4" />
                                <span>
                                    {currentSubsectionIndex > 0
                                        ? "Previous Page"
                                        : "Previous Chapter"}
                                </span>
                            </DropdownMenuItem>

                            <DropdownMenuItem
                                onClick={() => {
                                    if (!unsavedChanges) {
                                        // Check if we're on the last page of the current chapter
                                        if (
                                            subsections.length > 0 &&
                                            currentSubsectionIndex < subsections.length - 1
                                        ) {
                                            // Move to next page within the same chapter
                                            setCurrentSubsectionIndex(currentSubsectionIndex + 1);
                                        } else {
                                            // Move to next chapter and reset to first page
                                            const newChapter =
                                                chapterNumber === totalChapters
                                                    ? 1
                                                    : chapterNumber + 1;
                                            jumpToChapter(newChapter);
                                            setCurrentSubsectionIndex(0);
                                        }
                                    } else if (showUnsavedWarning) {
                                        showUnsavedWarning();
                                    }
                                }}
                                className="cursor-pointer"
                            >
                                <i className="codicon codicon-chevron-right mr-2 h-4 w-4" />
                                <span>
                                    {subsections.length > 0 &&
                                    currentSubsectionIndex < subsections.length - 1
                                        ? "Next Page"
                                        : "Next Chapter"}
                                </span>
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />
                        </>
                    )}

                {/* Left Section Controls (Source Text Functionality) */}
                {isSourceText && toggleScrollSync && (
                    <>
                        <DropdownMenuItem onClick={toggleScrollSync} className="cursor-pointer">
                            <i
                                className={`codicon ${
                                    scrollSyncEnabled ? "codicon-lock" : "codicon-unlock"
                                } mr-2 h-4 w-4`}
                            />
                            <span>Scroll Sync ({scrollSyncEnabled ? "Enabled" : "Disabled"})</span>
                        </DropdownMenuItem>
                        {isCorrectionEditorMode && (
                            <div className="px-3 py-1">
                                <span className="text-sm font-bold" style={{ color: "red" }}>
                                    Source Editing Mode
                                </span>
                            </div>
                        )}
                        <DropdownMenuSeparator />
                    </>
                )}

                {!isSourceText && openSourceText && chapterNumber && (
                    <>
                        <DropdownMenuItem
                            onClick={() => openSourceText(chapterNumber)}
                            className="cursor-pointer"
                        >
                            <i className="codicon codicon-open-preview mr-2 h-4 w-4" />
                            <span>Open Source Text</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}

                {/* Translation Controls */}
                {!isSourceText && (
                    <>
                        {isAnyTranslationInProgress ? (
                            <DropdownMenuItem
                                onClick={onStopTranslation}
                                className="cursor-pointer"
                            >
                                <i className="codicon codicon-circle-slash mr-2 h-4 w-4" />
                                <span>
                                    {isAutocompletingChapter
                                        ? "Stop Autocomplete"
                                        : "Stop Translation"}
                                </span>
                            </DropdownMenuItem>
                        ) : (
                            <DropdownMenuItem
                                onClick={onAutocompleteClick}
                                disabled={unsavedChanges}
                                className="cursor-pointer"
                            >
                                <i className="codicon codicon-sparkle mr-2 h-4 w-4" />
                                <span>Autocomplete Chapter</span>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                    </>
                )}

                {/* Text Direction */}
                <DropdownMenuItem
                    onClick={() => onSetTextDirection(textDirection === "ltr" ? "rtl" : "ltr")}
                    disabled={unsavedChanges}
                    className="cursor-pointer"
                >
                    <i className="codicon codicon-arrow-swap mr-2 h-4 w-4" />
                    <span>Text Direction ({textDirection.toUpperCase()})</span>
                </DropdownMenuItem>

                {/* Display Mode */}
                <DropdownMenuItem
                    onClick={() => {
                        const newMode =
                            cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                ? CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
                                : CELL_DISPLAY_MODES.INLINE;
                        onSetCellDisplayMode(newMode);
                        (window as any).vscodeApi.postMessage({
                            command: "updateCellDisplayMode",
                            mode: newMode,
                        });
                    }}
                    disabled={unsavedChanges}
                    className="cursor-pointer"
                >
                    <i
                        className={`codicon ${
                            cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                ? "codicon-symbol-enum"
                                : "codicon-symbol-constant"
                        } mr-2 h-4 w-4`}
                    />
                    <span>
                        Display Mode (
                        {cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? "Inline" : "One Line"})
                    </span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Page Selector - only show on mobile when pages exist */}
                {subsections.length > 0 && (
                    <>
                        <div className="px-3 py-1">
                            <span className="text-sm text-muted-foreground">
                                Current Page: {subsections[currentSubsectionIndex]?.label || ""}
                            </span>
                        </div>
                        {subsections.map((section, index) => {
                            const progress = calculateSubsectionProgress
                                ? calculateSubsectionProgress(section, isSourceText)
                                : { isFullyTranslated: false, isFullyValidated: false };
                            const isActive = currentSubsectionIndex === index;
                            const {
                                textValidatedPercent,
                                textCompletedPercent,
                                audioValidatedPercent,
                                audioCompletedPercent,
                            } = deriveSubsectionPercentages(progress);
                            return (
                                <DropdownMenuItem
                                    key={section.id}
                                    onClick={() => {
                                        if (!unsavedChanges) {
                                            if (
                                                useMilestoneNavigation &&
                                                requestCellsForMilestone &&
                                                currentMilestoneIndex !== undefined
                                            ) {
                                                // Use milestone-based navigation
                                                requestCellsForMilestone(
                                                    currentMilestoneIndex,
                                                    index
                                                );
                                            } else {
                                                // Use traditional chapter-based navigation
                                                setCurrentSubsectionIndex(index);
                                            }
                                        } else if (showUnsavedWarning) {
                                            showUnsavedWarning();
                                        }
                                    }}
                                    className={`cursor-pointer ${
                                        isActive
                                            ? "bg-accent text-accent-foreground font-semibold"
                                            : ""
                                    }`}
                                >
                                    <i className="codicon codicon-location mr-2 h-4 w-4" />
                                    <span>Go to {section.label}</span>
                                    <ProgressDots
                                        className="ml-auto"
                                        audio={{
                                            validatedPercent: audioValidatedPercent,
                                            completedPercent: audioCompletedPercent,
                                        }}
                                        text={{
                                            validatedPercent: textValidatedPercent,
                                            completedPercent: textCompletedPercent,
                                        }}
                                    />
                                </DropdownMenuItem>
                            );
                        })}
                        <DropdownMenuSeparator />
                    </>
                )}

                {/* Line Numbers */}
                <DropdownMenuItem
                    onClick={() => {
                        const currentValue = metadata?.lineNumbersEnabled ?? true;
                        const newValue = !currentValue;
                        onMetadataChange("lineNumbersEnabled", newValue.toString());

                        // Immediately save the metadata change
                        const updatedMetadata = {
                            ...metadata,
                            lineNumbersEnabled: newValue,
                            lineNumbersEnabledSource: "local" as const,
                        };
                        vscode.postMessage({
                            command: "updateNotebookMetadata",
                            content: updatedMetadata,
                        });
                    }}
                    className="cursor-pointer"
                >
                    <i
                        className={`codicon ${
                            metadata?.lineNumbersEnabled ?? true
                                ? "codicon-eye-closed"
                                : "codicon-eye"
                        } mr-2 h-4 w-4`}
                    />
                    <span>
                        {metadata?.lineNumbersEnabled ?? true
                            ? "Hide Line Numbers"
                            : "Show Line Numbers"}
                    </span>
                </DropdownMenuItem>

                {/* Video Player */}
                {documentHasVideoAvailable && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onToggleVideoPlayer} className="cursor-pointer">
                            <i
                                className={`codicon ${
                                    shouldShowVideoPlayer
                                        ? "codicon-close"
                                        : "codicon-device-camera-video"
                                } mr-2 h-4 w-4`}
                            />
                            <span>{shouldShowVideoPlayer ? "Hide Video" : "Show Video"}</span>
                        </DropdownMenuItem>
                    </>
                )}

                {/* Metadata Editor */}
                {metadata && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onOpenMetadataModal} className="cursor-pointer">
                            <i className="codicon codicon-notebook mr-2 h-4 w-4" />
                            <span>Edit Metadata</span>
                        </DropdownMenuItem>
                    </>
                )}

                {/* Auto-download audio toggle */}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() =>
                        onToggleAutoDownloadAudio &&
                        onToggleAutoDownloadAudio(!autoDownloadAudioOnOpen)
                    }
                    className="cursor-pointer"
                >
                    <i className="codicon codicon-cloud-download mr-2 h-4 w-4" />
                    <span className="flex-1">Auto-download audio on open</span>
                    <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                            backgroundColor: autoDownloadAudioOnOpen
                                ? "var(--vscode-charts-blue)"
                                : "var(--vscode-editorHoverWidget-border)",
                            color: autoDownloadAudioOnOpen
                                ? "var(--vscode-editor-background)"
                                : "var(--vscode-foreground)",
                        }}
                    >
                        {autoDownloadAudioOnOpen ? "On" : "Off"}
                    </span>
                </DropdownMenuItem>

                {/* Font Size Slider */}
                <DropdownMenuSeparator />
                <div className="px-3 py-2">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Font Size</span>
                        <span className="text-sm text-muted-foreground">{fontSize}px</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span style={{ fontSize: "10px" }}>A</span>
                        <div className="px-2 flex-1">
                            <Slider
                                value={[fontSize]}
                                onValueChange={onFontSizeChange}
                                max={24}
                                min={8}
                                step={1}
                                className="w-full"
                            />
                        </div>
                        <span style={{ fontSize: "18px" }}>A</span>
                    </div>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
