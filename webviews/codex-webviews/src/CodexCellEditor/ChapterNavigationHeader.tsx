"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "../components/ui/button";
import { VSCodeBadge, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import NotebookMetadataModal from "./NotebookMetadataModal";
import { AutocompleteModal } from "./modals/AutocompleteModal";
import { ChapterSelectorModal } from "./modals/ChapterSelectorModal";
import { type QuillCellContent, type CustomNotebookMetadata } from "../../../../types";
import { type FileStatus, type EditorPosition, type Subsection } from "../lib/types";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

interface ChapterNavigationHeaderProps {
    chapterNumber: number;
    setChapterNumber: React.Dispatch<React.SetStateAction<number>>;
    unsavedChanges: boolean;
    onAutocompleteChapter: (
        numberOfCells: number,
        includeEmptyCells: boolean,
        includeNotValidatedByAnyUser: boolean,
        includeNotValidatedByCurrentUser: boolean,
        includeFullyValidatedByOthers: boolean
    ) => void;
    onStopAutocomplete: () => void;
    isAutocompletingChapter: boolean;
    onSetTextDirection: (direction: "ltr" | "rtl") => void;
    textDirection: "ltr" | "rtl";
    onSetCellDisplayMode: (mode: CELL_DISPLAY_MODES) => void;
    cellDisplayMode: CELL_DISPLAY_MODES;
    isSourceText: boolean;
    totalChapters: number;
    totalUntranslatedCells: number;
    totalCellsToAutocomplete: number;
    totalCellsWithCurrentUserOption: number;
    totalFullyValidatedCells: number;
    openSourceText: (chapterNumber: number) => void;
    shouldShowVideoPlayer: boolean;
    setShouldShowVideoPlayer: React.Dispatch<React.SetStateAction<boolean>>;
    documentHasVideoAvailable: boolean;
    metadata: CustomNotebookMetadata | undefined;
    onMetadataChange: (key: string, value: string) => void;
    onSaveMetadata: () => void;
    onPickFile: () => void;
    onUpdateVideoUrl: (url: string) => void;
    tempVideoUrl: string;
    toggleScrollSync: () => void;
    scrollSyncEnabled: boolean;
    translationUnitsForSection: QuillCellContent[];
    isTranslatingCell?: boolean;
    onStopSingleCellTranslation?: () => void;
    currentSubsectionIndex: number;
    setCurrentSubsectionIndex: React.Dispatch<React.SetStateAction<number>>;
    getSubsectionsForChapter: (chapterNum: number) => Subsection[];
    bibleBookMap?: Map<string, { name: string; [key: string]: any }>;
    vscode: any;
    fileStatus?: FileStatus;
    editorPosition: EditorPosition;
    onClose?: () => void;
    onTriggerSync?: () => void;
    isCorrectionEditorMode?: boolean;
}

export function ChapterNavigationHeader({
    chapterNumber,
    setChapterNumber,
    unsavedChanges,
    onAutocompleteChapter,
    onStopAutocomplete,
    isAutocompletingChapter,
    onSetTextDirection,
    textDirection,
    onSetCellDisplayMode,
    cellDisplayMode,
    isSourceText,
    totalChapters,
    totalUntranslatedCells,
    totalCellsToAutocomplete,
    totalCellsWithCurrentUserOption,
    totalFullyValidatedCells,
    openSourceText,
    shouldShowVideoPlayer,
    setShouldShowVideoPlayer,
    documentHasVideoAvailable,
    metadata,
    onMetadataChange,
    onSaveMetadata,
    onPickFile,
    onUpdateVideoUrl,
    tempVideoUrl,
    toggleScrollSync,
    scrollSyncEnabled,
    translationUnitsForSection,
    isTranslatingCell = false,
    onStopSingleCellTranslation,
    currentSubsectionIndex,
    setCurrentSubsectionIndex,
    getSubsectionsForChapter,
    bibleBookMap,
    vscode,
    fileStatus = "none",
    editorPosition,
    onClose,
    onTriggerSync,
    isCorrectionEditorMode,
}: // Removed onToggleCorrectionEditor since it will be a VS Code command now
ChapterNavigationHeaderProps) {
    const [showConfirm, setShowConfirm] = useState(false);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
    const [showChapterSelector, setShowChapterSelector] = useState(false);
    const chapterTitleRef = useRef<HTMLDivElement>(null);

    // Helper to determine if any translation is in progress
    const isAnyTranslationInProgress = isAutocompletingChapter || isTranslatingCell;

    // Common handler for stopping any kind of translation
    const handleStopTranslation = () => {
        if (isAutocompletingChapter) {
            onStopAutocomplete();
        } else if (isTranslatingCell && onStopSingleCellTranslation) {
            onStopSingleCellTranslation();
        }
    };

    const handleAutocompleteClick = () => {
        setShowConfirm(true);
    };

    const handleConfirmAutocomplete = (
        numberOfCells: number,
        includeEmptyCells: boolean,
        includeNotValidatedByAnyUser: boolean,
        includeNotValidatedByCurrentUser: boolean,
        includeFullyValidatedByOthers = false
    ) => {
        onAutocompleteChapter(
            numberOfCells,
            includeEmptyCells,
            includeNotValidatedByAnyUser,
            includeNotValidatedByCurrentUser,
            includeFullyValidatedByOthers
        );
        setShowConfirm(false);
    };

    const handleToggleVideoPlayer = () => {
        setShouldShowVideoPlayer(!shouldShowVideoPlayer);
    };

    const handleOpenMetadataModal = () => {
        setIsMetadataModalOpen(true);
    };

    const handleCloseMetadataModal = () => {
        setIsMetadataModalOpen(false);
    };

    const handleSaveMetadata = () => {
        onSaveMetadata();
        setIsMetadataModalOpen(false);
        if (metadata?.videoUrl) {
            onUpdateVideoUrl(metadata.videoUrl);
        }
    };

    // Determine the display name using the map
    const getDisplayTitle = () => {
        const firstMarker = translationUnitsForSection[0]?.cellMarkers?.[0]?.split(":")[0]; // e.g., "GEN 1"
        if (!firstMarker) return "Chapter"; // Fallback title

        const parts = firstMarker.split(" ");
        const bookAbbr = parts[0]; // e.g., "GEN"
        const chapterNum = parts[1] || ""; // e.g., "1"

        // Look up the localized name
        const localizedName = bibleBookMap?.get(bookAbbr)?.name;

        // Use localized name if found, otherwise use the abbreviation
        const displayBookName = localizedName || bookAbbr;

        return `${displayBookName}\u00A0${chapterNum}`;
    };

    const handleTogglePrimarySidebar = () => {
        if (vscode) {
            vscode.postMessage({ command: "togglePrimarySidebar" });
        }
    };

    const handleToggleSecondarySidebar = () => {
        if (vscode) {
            vscode.postMessage({ command: "toggleSecondarySidebar" });
        }
    };

    // Function to get file status icon and color
    const getFileStatusButton = () => {
        if (fileStatus === "none") return null;

        let icon: string;
        let color: string;
        let title: string;
        let clickHandler: (() => void) | undefined = undefined;

        switch (fileStatus) {
            case "dirty":
                icon = "codicon-cloud";
                color = "var(--vscode-editorWarning-foreground)"; // Yellow warning color
                title = "Unsaved changes - Click to sync";
                clickHandler = onTriggerSync;
                break;
            case "syncing":
                icon = "codicon-sync";
                color = "var(--vscode-descriptionForeground)"; // Gray for syncing
                title = "Syncing changes";
                break;
            case "synced":
                icon = "codicon-check-all";
                color = "var(--vscode-terminal-ansiGreen)"; // Green for synced
                title = "All changes saved";
                break;
            default:
                return null;
        }

        return (
            <Button
                variant="outline"
                title={title}
                style={{ color }}
                onClick={clickHandler}
                disabled={fileStatus === "syncing"}
            >
                <i
                    className={`codicon ${icon}`}
                    style={{
                        animation: fileStatus === "syncing" ? "rotate 2s linear infinite" : "none",
                    }}
                />
            </Button>
        );
    };

    // Add CSS for rotation animation
    useEffect(() => {
        if (!document.getElementById("codex-animation-styles")) {
            const styleElement = document.createElement("style");
            styleElement.id = "codex-animation-styles";
            styleElement.textContent = `
        @keyframes rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
            document.head.appendChild(styleElement);
        }
    }, []);

    // Update the jumpToChapter function to be reusable
    const jumpToChapter = (newChapter: number) => {
        if (!unsavedChanges && newChapter !== chapterNumber) {
            (window as any).vscodeApi.postMessage({
                command: "jumpToChapter",
                chapterNumber: newChapter,
            });
            setChapterNumber(newChapter);
            // Reset to first page when jumping to a different chapter through chapter selector
            setCurrentSubsectionIndex(0);
        }
    };

    const subsections = getSubsectionsForChapter(chapterNumber);

    return (
        <div className="flex flex-row p-2 border-b">
            <div className="flex items-center justify-start">
                {isSourceText ? (
                    <>
                        <Button variant="outline" onClick={toggleScrollSync}>
                            <i
                                className={`codicon ${
                                    scrollSyncEnabled ? "codicon-lock" : "codicon-unlock"
                                }`}
                            />
                        </Button>

                        {isCorrectionEditorMode ? (
                            <span
                                className="ml-2"
                                style={{ color: "red", fontWeight: "bold" }}
                                title="Correction Editor Mode is active"
                            >
                                Source Editing Mode
                            </span>
                        ) : (
                            <span className="ml-2">Source Text</span>
                        )}
                    </>
                ) : (
                    <Button variant="outline" onClick={() => openSourceText(chapterNumber)}>
                        <i className="codicon codicon-open-preview" />
                    </Button>
                )}
            </div>

            <div className="flex items-center justify-center flex-grow-[2] space-x-2">
                <Button
                    variant="outline"
                    onClick={() => {
                        if (!unsavedChanges) {
                            // Check if we're on the first page of the current chapter
                            if (currentSubsectionIndex > 0) {
                                // Move to previous page within the same chapter
                                setCurrentSubsectionIndex(currentSubsectionIndex - 1);
                            } else {
                                // Move to previous chapter
                                const newChapter =
                                    chapterNumber === 1 ? totalChapters : chapterNumber - 1;
                                jumpToChapter(newChapter);

                                // When jumping to a new chapter, check if it has subsections
                                // and if so, jump to the last page
                                const newChapterSubsections = getSubsectionsForChapter(newChapter);
                                if (newChapterSubsections.length > 0) {
                                    setCurrentSubsectionIndex(newChapterSubsections.length - 1);
                                }
                            }
                        }
                    }}
                    title={
                        unsavedChanges
                            ? "Save changes first to change chapter"
                            : currentSubsectionIndex > 0
                            ? "Previous Page"
                            : "Previous Chapter"
                    }
                >
                    <i
                        className={`codicon ${
                            textDirection === "rtl"
                                ? "codicon-chevron-right"
                                : "codicon-chevron-left"
                        }`}
                    />
                </Button>

                <div
                    ref={chapterTitleRef}
                    className="chapter-title-container"
                    onClick={() => {
                        if (!unsavedChanges) {
                            setShowChapterSelector(!showChapterSelector);
                        }
                    }}
                >
                    <h1 className="text-2xl flex items-center m-0">
                        {getDisplayTitle()}
                        {subsections.length > 0 &&
                            ` (${subsections[currentSubsectionIndex]?.label || ""})`}
                        <i
                            className={`codicon ${
                                showChapterSelector ? "codicon-chevron-up" : "codicon-chevron-down"
                            }`}
                        />
                    </h1>
                </div>

                <Button
                    variant="outline"
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
                                    chapterNumber === totalChapters ? 1 : chapterNumber + 1;
                                jumpToChapter(newChapter);
                                setCurrentSubsectionIndex(0);
                            }
                        }
                    }}
                    title={
                        unsavedChanges
                            ? "Save changes first to change chapter"
                            : subsections.length > 0 &&
                              currentSubsectionIndex < subsections.length - 1
                            ? "Next Page"
                            : "Next Chapter"
                    }
                >
                    <i
                        className={`codicon ${
                            textDirection === "rtl"
                                ? "codicon-chevron-left"
                                : "codicon-chevron-right"
                        }`}
                    />
                </Button>

                {subsections.length > 0 && (
                    <div className="flex items-center ml-4">
                        <span className="mr-2">Page:</span>
                        <VSCodeDropdown
                            value={currentSubsectionIndex.toString()}
                            onChange={(e: any) => {
                                const newIndex = parseInt(e.target.value);
                                if (!isNaN(newIndex)) {
                                    setCurrentSubsectionIndex(newIndex);
                                }
                            }}
                        >
                            {subsections.map((section, index) => (
                                <VSCodeOption key={section.id} value={index.toString()}>
                                    {section.label}
                                </VSCodeOption>
                            ))}
                        </VSCodeDropdown>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-end flex-1 space-x-2">
                {/* {getFileStatusButton()} // FIXME: we want to show the file status, but it needs to load immediately, and it needs to be more reliable. - test this and also think through UX */}
                {/* Show left sidebar toggle only when editor is not leftmost
                
                // FIXME: editorPosition is always 'unknown' - this is not the right way to check this
                
                */}
                {/*                 
                {(editorPosition === "rightmost" ||
                    editorPosition === "center" ||
                    editorPosition === "single") && (
                    <Button
                        variant="outline"
                        onClick={handleTogglePrimarySidebar}
                        title="Toggle Primary Sidebar"
                    >
                        <i className="codicon codicon-layout-sidebar-left" />
                    </Button>
                )}
                {/* Show right sidebar toggle only when editor is not rightmost */}
                {/* {(editorPosition === "leftmost" ||
                    editorPosition === "center" ||
                    editorPosition === "single") && (
                    <Button
                        variant="outline"
                        onClick={handleToggleSecondarySidebar}
                        title="Toggle Secondary Sidebar"
                    >
                        <i className="codicon codicon-layout-sidebar-right" />
                    </Button>
                )} */}
                {!isSourceText && (
                    <>
                        {isAnyTranslationInProgress ? (
                            <Button
                                variant="outline"
                                onClick={handleStopTranslation}
                                title={
                                    isAutocompletingChapter
                                        ? "Stop Autocomplete"
                                        : "Stop Translation"
                                }
                                className="bg-editor-findMatchHighlight"
                            >
                                <i className="codicon codicon-circle-slash" />
                            </Button>
                        ) : (
                            <Button
                                variant="outline"
                                onClick={handleAutocompleteClick}
                                disabled={unsavedChanges}
                                title="Autocomplete Chapter"
                            >
                                <i className="codicon codicon-sparkle" />
                            </Button>
                        )}
                    </>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" title="Advanced Settings">
                            <i className="codicon codicon-settings-gear" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                            onClick={() =>
                                onSetTextDirection(textDirection === "ltr" ? "rtl" : "ltr")
                            }
                            disabled={unsavedChanges}
                            className="cursor-pointer"
                        >
                            <i className="codicon codicon-arrow-swap mr-2 h-4 w-4" />
                            <span>Text Direction ({textDirection.toUpperCase()})</span>
                        </DropdownMenuItem>

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
                                {cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                    ? "Inline"
                                    : "One Line"}
                                )
                            </span>
                        </DropdownMenuItem>

                        {documentHasVideoAvailable && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={handleToggleVideoPlayer}
                                    className="cursor-pointer"
                                >
                                    <i
                                        className={`codicon ${
                                            shouldShowVideoPlayer
                                                ? "codicon-close"
                                                : "codicon-device-camera-video"
                                        } mr-2 h-4 w-4`}
                                    />
                                    <span>
                                        {shouldShowVideoPlayer ? "Hide Video" : "Show Video"}
                                    </span>
                                </DropdownMenuItem>
                            </>
                        )}

                        {metadata && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={handleOpenMetadataModal}
                                    className="cursor-pointer"
                                >
                                    <i className="codicon codicon-notebook mr-2 h-4 w-4" />
                                    <span>Edit Metadata</span>
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {metadata && (
                <NotebookMetadataModal
                    isOpen={isMetadataModalOpen}
                    onClose={handleCloseMetadataModal}
                    metadata={metadata}
                    onMetadataChange={onMetadataChange}
                    onSave={handleSaveMetadata}
                    onPickFile={onPickFile}
                    tempVideoUrl={tempVideoUrl}
                />
            )}

            <AutocompleteModal
                isOpen={showConfirm}
                onClose={() => setShowConfirm(false)}
                onConfirm={handleConfirmAutocomplete}
                totalUntranslatedCells={totalUntranslatedCells}
                totalCellsToAutocomplete={totalCellsToAutocomplete}
                totalCellsWithCurrentUserOption={totalCellsWithCurrentUserOption}
                totalFullyValidatedByOthers={totalFullyValidatedCells}
                defaultValue={Math.min(5, totalUntranslatedCells > 0 ? totalUntranslatedCells : 5)}
            />

            <ChapterSelectorModal
                isOpen={showChapterSelector}
                onClose={() => setShowChapterSelector(false)}
                onSelectChapter={jumpToChapter}
                currentChapter={chapterNumber}
                totalChapters={totalChapters}
                bookTitle={getDisplayTitle().split("\u00A0")[0]}
                unsavedChanges={unsavedChanges}
                anchorRef={chapterTitleRef}
            />
        </div>
    );
}
