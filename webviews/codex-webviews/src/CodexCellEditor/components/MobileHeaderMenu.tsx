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
import { type CustomNotebookMetadata } from "../../../../../types";
import { type Subsection } from "../../lib/types";

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
    
    // Chapter navigation (for ultra-small screens)
    chapterNumber: number;
    totalChapters: number;
    jumpToChapter?: (chapterNumber: number) => void;
    onPreviousChapter?: () => void;
    onNextChapter?: () => void;
    getDisplayTitle: () => string;
    
    // VS Code integration
    vscode: any;
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
    chapterNumber,
    totalChapters,
    jumpToChapter,
    onPreviousChapter,
    onNextChapter,
    getDisplayTitle,
    vscode,
}: MobileHeaderMenuProps) {
    const isAnyTranslationInProgress = isAutocompletingChapter || isTranslatingCell;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" title="Menu" className="min-[400px]:hidden">
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
                {/* Chapter Navigation */}
                <div className="px-3 py-1">
                    <span className="text-sm text-muted-foreground">Chapter: {getDisplayTitle()}</span>
                </div>
                {onPreviousChapter && (
                    <DropdownMenuItem onClick={onPreviousChapter} className="cursor-pointer">
                        <i className="codicon codicon-chevron-left mr-2 h-4 w-4" />
                        <span>Previous Chapter</span>
                    </DropdownMenuItem>
                )}
                {onNextChapter && (
                    <DropdownMenuItem onClick={onNextChapter} className="cursor-pointer">
                        <i className="codicon codicon-chevron-right mr-2 h-4 w-4" />
                        <span>Next Chapter</span>
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />

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
                                    {isAutocompletingChapter ? "Stop Autocomplete" : "Stop Translation"}
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
                        Display Mode ({cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? "Inline" : "One Line"})
                    </span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Page Selector - only show on mobile when pages exist */}
                {subsections.length > 0 && (
                    <>
                        <div className="px-3 py-1">
                            <span className="text-sm text-muted-foreground">Current Page: {subsections[currentSubsectionIndex]?.label || ""}</span>
                        </div>
                        {subsections.map((section, index) => (
                            <DropdownMenuItem
                                key={section.id}
                                onClick={() => setCurrentSubsectionIndex(index)}
                                className={`cursor-pointer ${currentSubsectionIndex === index ? 'bg-accent' : ''}`}
                            >
                                <i className="codicon codicon-location mr-2 h-4 w-4" />
                                <span>Go to {section.label}</span>
                                {currentSubsectionIndex === index && (
                                    <i className="codicon codicon-check ml-auto h-4 w-4" />
                                )}
                            </DropdownMenuItem>
                        ))}
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
                        {metadata?.lineNumbersEnabled ?? true ? "Hide Line Numbers" : "Show Line Numbers"}
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