import React, { useState, useRef, useEffect } from "react";
import { Button } from "../components/ui/button";
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import NotebookMetadataModal from "./NotebookMetadataModal";
import { AutocompleteModal } from "./modals/AutocompleteModal";
import { ChapterSelectorModal } from "./modals/ChapterSelectorModal";
import {
    type QuillCellContent,
    type CustomNotebookMetadata,
    type EditorPostMessages,
} from "../../../../types";
import { EditMapUtils } from "../../../../src/utils/editMapUtils";
import { WebviewApi } from "vscode-webview";
import { type FileStatus, type EditorPosition, type Subsection } from "../lib/types";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Slider } from "../components/ui/slider";

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
    chapterProgress?: Record<
        number,
        { percentTranslationsCompleted: number; percentFullyValidatedTranslations: number }
    >;
    allCellsForChapter?: QuillCellContent[];
    onTempFontSizeChange?: (fontSize: number) => void;
    onFontSizeSave?: (fontSize: number) => void;
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
    chapterProgress,
    allCellsForChapter,
    onTempFontSizeChange,
    onFontSizeSave,
}: // Removed onToggleCorrectionEditor since it will be a VS Code command now
ChapterNavigationHeaderProps) {
    const [showConfirm, setShowConfirm] = useState(false);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
    const [showChapterSelector, setShowChapterSelector] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [isExtraNarrow, setIsExtraNarrow] = useState(false);
    const [isNarrowWithPageField, setIsNarrowWithPageField] = useState(false);
    const [isNarrowWithoutPageField, setIsNarrowWithoutPageField] = useState(false);
    const chapterTitleRef = useRef<HTMLDivElement>(null);

    // Font size state - default to 14 if not set in metadata
    const [fontSize, setFontSize] = useState(metadata?.fontSize || 14);
    const [pendingFontSize, setPendingFontSize] = useState<number | null>(null);

    // Update font size when metadata changes
    useEffect(() => {
        if (metadata?.fontSize !== undefined) {
            setFontSize(metadata.fontSize);
            setPendingFontSize(null); // Clear any pending changes
        }
    }, [metadata?.fontSize]);

    const subsections = getSubsectionsForChapter(chapterNumber);

    // Simple responsive detection - only based on screen width
    useEffect(() => {
        const checkScreenSize = () => {
            setIsMobile(window.innerWidth < 430);
            setIsExtraNarrow(window.innerWidth <= 350);
            setIsNarrowWithPageField(window.innerWidth < 650);
            setIsNarrowWithoutPageField(window.innerWidth < 430);
        };

        checkScreenSize();
        window.addEventListener("resize", checkScreenSize);

        return () => window.removeEventListener("resize", checkScreenSize);
    }, []);

    // Determine layout based on screen width
    const hasPagination = subsections.length > 0;

    // Use 3-row layout if screen is 330px or less AND Page field is present
    const shouldUseThreeRowLayout = isExtraNarrow && hasPagination;

    // Use mobile layout with different breakpoints based on Page field presence
    // When Page field is present: collapse at 700px (2 rows), then 330px (3 rows)
    // When Page field is NOT present: collapse at 420px (2 rows)
    const shouldUseMobileLayout = hasPagination ? isNarrowWithPageField : isNarrowWithoutPageField;

    // Debug logging
    console.log("ChapterNavigationHeader Debug:", {
        windowWidth: window.innerWidth,
        isExtraNarrow,
        hasPagination,
        subsectionsLength: subsections.length,
        shouldUseThreeRowLayout,
        shouldUseMobileLayout,
        isMobile,
        showPageFieldInCenter: subsections.length > 0 && !shouldUseThreeRowLayout,
        showPageFieldInThirdRow: shouldUseThreeRowLayout && subsections.length > 0,
    });

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

    const handleFontSizeChange = (value: number[]) => {
        const newFontSize = value[0];
        setFontSize(newFontSize);
        setPendingFontSize(newFontSize);

        // Update temporary font size for preview
        if (onTempFontSizeChange) {
            onTempFontSizeChange(newFontSize);
        }
    };

    const handleDropdownOpenChange = (open: boolean) => {
        setIsDropdownOpen(open);

        // If dropdown is closing and we have pending font size changes, save them
        if (!open && pendingFontSize !== null) {
            // Save the font size using the new handler
            if (onFontSizeSave) {
                onFontSizeSave(pendingFontSize);
            } else {
                // Fallback to old method if handler not provided
                onMetadataChange("fontSize", pendingFontSize.toString());
                const updatedMetadata = { ...metadata, fontSize: pendingFontSize };
                (window as any).vscodeApi.postMessage({
                    command: "updateNotebookMetadata",
                    content: updatedMetadata,
                });
            }

            setPendingFontSize(null);
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

    // Calculate progress for each subsection/page
    const calculateSubsectionProgress = (subsection: Subsection) => {
        // Use allCellsForChapter if available, otherwise fall back to translationUnitsForSection
        const allChapterCells = allCellsForChapter || translationUnitsForSection;

        // Get cells for this specific subsection from the full chapter data
        const subsectionCells = allChapterCells.slice(subsection.startIndex, subsection.endIndex);

        // Filter out paratext and merged cells for progress calculation
        const validCells = subsectionCells.filter((cell) => {
            const cellId = cell?.cellMarkers?.[0];
            return cellId && !cellId.startsWith("paratext-") && !cell.merged;
        });

        if (validCells.length === 0) {
            return { isFullyTranslated: false, isFullyValidated: false };
        }

        // Check if all cells have content (translated)
        const translatedCells = validCells.filter(
            (cell) =>
                cell.cellContent &&
                cell.cellContent.trim().length > 0 &&
                cell.cellContent !== "<span></span>"
        );
        const isFullyTranslated = translatedCells.length === validCells.length;

        // Check if all cells are validated
        let isFullyValidated = false;
        if (isFullyTranslated) {
            const minimumValidationsRequired = 1; // Can be made configurable later
            const validatedCells = validCells.filter((cell) => {
                const validatedBy =
                    cell.editHistory
                        ?.slice()
                        .reverse()
                        .find(
                            (edit) =>
                                EditMapUtils.isValue(edit.editMap) &&
                                edit.value === cell.cellContent
                        )?.validatedBy || [];
                return validatedBy.filter((v) => !v.isDeleted).length >= minimumValidationsRequired;
            });
            isFullyValidated = validatedCells.length === validCells.length;
        }

        return { isFullyTranslated, isFullyValidated };
    };

    return (
        <div
            className={`flex ${
                shouldUseThreeRowLayout
                    ? "flex-col"
                    : shouldUseMobileLayout
                    ? "flex-col"
                    : "flex-row"
            } p-2 max-w-full overflow-hidden`}
        >
            {/* Mobile Header Row */}
            <div
                className={`flex items-center justify-between ${
                    shouldUseMobileLayout || shouldUseThreeRowLayout ? "mb-2" : "hidden"
                }`}
            >
                <div className="flex items-center space-x-2">
                    {isSourceText ? (
                        <>
                            <Button variant="outline" onClick={toggleScrollSync} size="sm">
                                <i
                                    className={`codicon ${
                                        scrollSyncEnabled ? "codicon-lock" : "codicon-unlock"
                                    }`}
                                />
                            </Button>
                            {isCorrectionEditorMode ? (
                                <span
                                    className="text-xs"
                                    style={{ color: "red", fontWeight: "bold" }}
                                    title="Correction Editor Mode is active"
                                >
                                    Source Editing Mode
                                </span>
                            ) : (
                                <span className="text-xs">Source Text</span>
                            )}
                        </>
                    ) : (
                        <Button
                            variant="outline"
                            onClick={() => openSourceText(chapterNumber)}
                            size="sm"
                        >
                            <i className="codicon codicon-open-preview" />
                        </Button>
                    )}
                </div>

                {/* Mobile Right Side - Autocomplete + Settings */}
                <div className="flex items-center space-x-2">
                    {/* Show autocomplete button on the right side in mobile */}
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
                                    size="sm"
                                >
                                    <i className="codicon codicon-circle-slash" />
                                </Button>
                            ) : (
                                <Button
                                    variant="outline"
                                    onClick={handleAutocompleteClick}
                                    disabled={unsavedChanges}
                                    title="Autocomplete Chapter"
                                    size="sm"
                                >
                                    <i className="codicon codicon-sparkle" />
                                </Button>
                            )}
                        </>
                    )}

                    {/* Mobile Settings Button - Always visible */}
                    <DropdownMenu onOpenChange={handleDropdownOpenChange}>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" title="Advanced Settings" size="sm">
                                <i className="codicon codicon-settings-gear" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            side="bottom"
                            align="end"
                            sideOffset={8}
                            className="w-56"
                            style={{
                                zIndex: 99999,
                            }}
                        >
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

                            <DropdownMenuSeparator />
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
                            <DropdownMenuSeparator />
                            <div className="px-3 py-1">
                                <div className="flex items-center justify-between mb-0.2">
                                    <span className="text-sm text-muted-foreground">
                                        {fontSize}px
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span style={{ fontSize: "10px" }}>A</span>
                                    <div className="px-2 w-full">
                                        <Slider
                                            value={[fontSize]}
                                            onValueChange={handleFontSizeChange}
                                            max={24}
                                            min={8}
                                            step={1}
                                            className="w-full"
                                        />
                                    </div>
                                    <span style={{ fontSize: "20px" }}>A</span>
                                </div>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Desktop Left Section */}
            <div
                className={`${
                    shouldUseMobileLayout || shouldUseThreeRowLayout ? "hidden" : "flex"
                } items-center justify-start`}
            >
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

            {/* Center Navigation Section */}
            <div
                className={`flex items-center justify-center flex-grow-[2] ${
                    shouldUseThreeRowLayout
                        ? "hidden"
                        : shouldUseMobileLayout
                        ? "space-x-1"
                        : "space-x-2"
                } min-w-0`}
            >
                <Button
                    variant="outline"
                    size={shouldUseMobileLayout ? "sm" : "default"}
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
                    className="chapter-title-container flex items-center min-w-0 max-w-xs cursor-pointer"
                    onClick={() => {
                        if (!unsavedChanges) {
                            setShowChapterSelector(!showChapterSelector);
                        }
                    }}
                >
                    <h1
                        className={`${
                            shouldUseMobileLayout ? "text-lg" : "text-2xl"
                        } flex items-center m-0 min-w-0`}
                    >
                        <span className="truncate">
                            {(() => {
                                const fullTitle = getDisplayTitle();
                                const lastSpaceIndex = Math.max(
                                    fullTitle.lastIndexOf("\u00A0"),
                                    fullTitle.lastIndexOf(" ")
                                );
                                return lastSpaceIndex > 0
                                    ? fullTitle.substring(0, lastSpaceIndex)
                                    : fullTitle;
                            })()}
                        </span>
                        <span className="flex-shrink-0 ml-1">
                            {(() => {
                                const fullTitle = getDisplayTitle();
                                const lastSpaceIndex = Math.max(
                                    fullTitle.lastIndexOf("\u00A0"),
                                    fullTitle.lastIndexOf(" ")
                                );
                                return lastSpaceIndex > 0
                                    ? fullTitle.substring(lastSpaceIndex + 1)
                                    : "";
                            })()}
                        </span>
                        {subsections.length > 0 && (
                            <span
                                className={`flex-shrink-0 ml-1 ${
                                    shouldUseMobileLayout ? "text-xs" : ""
                                }`}
                            >
                                ({subsections[currentSubsectionIndex]?.label || ""})
                            </span>
                        )}
                        <i
                            className={`codicon ${
                                showChapterSelector ? "codicon-chevron-up" : "codicon-chevron-down"
                            } ml-1 flex-shrink-0`}
                        />
                    </h1>
                </div>

                <Button
                    variant="outline"
                    size={shouldUseMobileLayout ? "sm" : "default"}
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

                {subsections.length > 0 && !shouldUseThreeRowLayout && (
                    <div
                        className={`flex items-center ${shouldUseMobileLayout ? "ml-2" : "ml-4"}`}
                        data-page-field
                    >
                        <span className={`${shouldUseMobileLayout ? "text-xs mr-1" : "mr-2"}`}>
                            Page:
                        </span>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size={shouldUseMobileLayout ? "sm" : "default"}
                                    className="flex items-center gap-2"
                                >
                                    {(() => {
                                        const currentSection = subsections[currentSubsectionIndex];
                                        const progress =
                                            calculateSubsectionProgress(currentSection);
                                        return (
                                            <>
                                                <span
                                                    className={
                                                        shouldUseMobileLayout ? "text-xs" : ""
                                                    }
                                                >
                                                    {currentSection?.label || ""}
                                                </span>
                                                {progress.isFullyValidated && (
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{
                                                            backgroundColor:
                                                                "var(--vscode-editorWarning-foreground)",
                                                        }}
                                                        title="Page fully validated"
                                                    />
                                                )}
                                                {!progress.isFullyValidated &&
                                                    progress.isFullyTranslated && (
                                                        <div
                                                            className="w-2 h-2 rounded-full"
                                                            style={{
                                                                backgroundColor:
                                                                    "var(--vscode-charts-blue)",
                                                            }}
                                                            title="Page fully translated"
                                                        />
                                                    )}
                                                <i className="codicon codicon-chevron-down" />
                                            </>
                                        );
                                    })()}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                className="w-48"
                                style={{ zIndex: 99999 }}
                            >
                                {subsections.map((section, index) => {
                                    const progress = calculateSubsectionProgress(section);
                                    return (
                                        <DropdownMenuItem
                                            key={section.id}
                                            onClick={() => setCurrentSubsectionIndex(index)}
                                            className="flex items-center justify-between cursor-pointer"
                                        >
                                            <span>{section.label}</span>
                                            <div className="flex items-center gap-1">
                                                {progress.isFullyValidated && (
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{
                                                            backgroundColor:
                                                                "var(--vscode-editorWarning-foreground)",
                                                        }}
                                                        title="Page fully validated"
                                                    />
                                                )}
                                                {currentSubsectionIndex === index && (
                                                    <i
                                                        className="codicon codicon-check"
                                                        style={{ fontSize: "12px" }}
                                                    />
                                                )}
                                                {!progress.isFullyValidated &&
                                                    progress.isFullyTranslated && (
                                                        <div
                                                            className="w-2 h-2 rounded-full"
                                                            style={{
                                                                backgroundColor:
                                                                    "var(--vscode-charts-blue)",
                                                            }}
                                                            title="Page fully translated"
                                                        />
                                                    )}
                                            </div>
                                        </DropdownMenuItem>
                                    );
                                })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>

            {/* Desktop Right Section */}
            <div
                className={`${
                    shouldUseMobileLayout || shouldUseThreeRowLayout ? "hidden" : "flex"
                } items-center justify-end flex-1 space-x-2 min-w-0`}
            >
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
                <DropdownMenu onOpenChange={handleDropdownOpenChange}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" title="Advanced Settings">
                            <i className="codicon codicon-settings-gear" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        side="bottom"
                        align="end"
                        sideOffset={8}
                        className="w-56"
                        style={{
                            zIndex: 99999,
                        }}
                    >
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

                        <DropdownMenuSeparator />
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
                        <DropdownMenuSeparator />
                        <div className="px-3 py-1">
                            <div className="flex items-center justify-between mb-0.2">
                                <span className="text-sm text-muted-foreground">{fontSize}px</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <span style={{ fontSize: "10px" }}>A</span>
                                <div className="px-2 w-full">
                                    <Slider
                                        value={[fontSize]}
                                        onValueChange={handleFontSizeChange}
                                        max={24}
                                        min={8}
                                        step={1}
                                        className="w-full"
                                    />
                                </div>
                                <span style={{ fontSize: "20px" }}>A</span>
                            </div>
                        </div>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Three-Row Layout: Chapter Navigation Row */}
            {shouldUseThreeRowLayout && (
                <div className="flex items-center justify-center space-x-1 mb-2">
                    <Button
                        variant="outline"
                        size="sm"
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
                                    const newChapterSubsections =
                                        getSubsectionsForChapter(newChapter);
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
                        className="chapter-title-container flex items-center min-w-0 max-w-xs cursor-pointer"
                        onClick={() => {
                            if (!unsavedChanges) {
                                setShowChapterSelector(!showChapterSelector);
                            }
                        }}
                    >
                        <h1 className="text-lg flex items-center m-0 min-w-0">
                            <span className="truncate">
                                {(() => {
                                    const fullTitle = getDisplayTitle();
                                    const lastSpaceIndex = Math.max(
                                        fullTitle.lastIndexOf("\u00A0"),
                                        fullTitle.lastIndexOf(" ")
                                    );
                                    return lastSpaceIndex > 0
                                        ? fullTitle.substring(0, lastSpaceIndex)
                                        : fullTitle;
                                })()}
                            </span>
                            <span className="flex-shrink-0 ml-1">
                                {(() => {
                                    const fullTitle = getDisplayTitle();
                                    const lastSpaceIndex = Math.max(
                                        fullTitle.lastIndexOf("\u00A0"),
                                        fullTitle.lastIndexOf(" ")
                                    );
                                    return lastSpaceIndex > 0
                                        ? fullTitle.substring(lastSpaceIndex + 1)
                                        : "";
                                })()}
                            </span>
                            <i
                                className={`codicon ${
                                    showChapterSelector
                                        ? "codicon-chevron-up"
                                        : "codicon-chevron-down"
                                } ml-1 flex-shrink-0`}
                            />
                        </h1>
                    </div>

                    <Button
                        variant="outline"
                        size="sm"
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
                </div>
            )}

            {/* Three-Row Layout: Page Field Row */}
            {shouldUseThreeRowLayout && subsections.length > 0 && (
                <div className="flex items-center justify-center">
                    <div className="flex items-center ml-2" data-page-field>
                        <span className="text-xs mr-1">Page:</span>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex items-center gap-2"
                                >
                                    {(() => {
                                        const currentSection = subsections[currentSubsectionIndex];
                                        const progress =
                                            calculateSubsectionProgress(currentSection);
                                        return (
                                            <>
                                                <span className="text-xs">
                                                    {currentSection?.label || ""}
                                                </span>
                                                {progress.isFullyValidated && (
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{
                                                            backgroundColor:
                                                                "var(--vscode-editorWarning-foreground)",
                                                        }}
                                                        title="Page fully validated"
                                                    />
                                                )}
                                                {!progress.isFullyValidated &&
                                                    progress.isFullyTranslated && (
                                                        <div
                                                            className="w-2 h-2 rounded-full"
                                                            style={{
                                                                backgroundColor:
                                                                    "var(--vscode-charts-blue)",
                                                            }}
                                                            title="Page fully translated"
                                                        />
                                                    )}
                                                <i className="codicon codicon-chevron-down" />
                                            </>
                                        );
                                    })()}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                className="w-48"
                                style={{ zIndex: 99999 }}
                            >
                                {subsections.map((section, index) => {
                                    const progress = calculateSubsectionProgress(section);
                                    return (
                                        <DropdownMenuItem
                                            key={section.id}
                                            onClick={() => setCurrentSubsectionIndex(index)}
                                            className="flex items-center justify-between cursor-pointer"
                                        >
                                            <span>{section.label}</span>
                                            <div className="flex items-center gap-1">
                                                {progress.isFullyValidated && (
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{
                                                            backgroundColor:
                                                                "var(--vscode-editorWarning-foreground)",
                                                        }}
                                                        title="Page fully validated"
                                                    />
                                                )}
                                                {currentSubsectionIndex === index && (
                                                    <i
                                                        className="codicon codicon-check"
                                                        style={{ fontSize: "12px" }}
                                                    />
                                                )}
                                                {!progress.isFullyValidated &&
                                                    progress.isFullyTranslated && (
                                                        <div
                                                            className="w-2 h-2 rounded-full"
                                                            style={{
                                                                backgroundColor:
                                                                    "var(--vscode-charts-blue)",
                                                            }}
                                                            title="Page fully translated"
                                                        />
                                                    )}
                                            </div>
                                        </DropdownMenuItem>
                                    );
                                })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            )}

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
                chapterProgress={chapterProgress}
            />
        </div>
    );
}
