import React, { useState, useRef, useEffect } from "react";
import { Button } from "../components/ui/button";
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import NotebookMetadataModal from "./NotebookMetadataModal";
import { AutocompleteModal } from "./modals/AutocompleteModal";
import { ChapterSelectorModal } from "./modals/ChapterSelectorModal";
import { MobileHeaderMenu } from "./components/MobileHeaderMenu";
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
    const chapterTitleRef = useRef<HTMLDivElement>(null);
    const [truncatedBookName, setTruncatedBookName] = useState<string | null>(null);

    // Font size state - default to 14 if not set in metadata
    const [fontSize, setFontSize] = useState(metadata?.fontSize || 14);
    const [pendingFontSize, setPendingFontSize] = useState<number | null>(null);

    // Get subsections early so it's available for all hooks
    const subsections = getSubsectionsForChapter(chapterNumber);

    // Update font size when metadata changes
    useEffect(() => {
        if (metadata?.fontSize !== undefined) {
            setFontSize(metadata.fontSize);
            setPendingFontSize(null); // Clear any pending changes
        }
    }, [metadata?.fontSize]);

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

    // Dynamic title truncation based on available space
    useEffect(() => {
        const handleTitleResize = () => {
            const container = chapterTitleRef.current;
            if (!container) return;

            const fullTitle = getDisplayTitle();
            const lastSpaceIndex = Math.max(
                fullTitle.lastIndexOf('\u00A0'), 
                fullTitle.lastIndexOf(' ')
            );
            const bookName = lastSpaceIndex > 0 ? fullTitle.substring(0, lastSpaceIndex) : fullTitle;
            const chapterNum = lastSpaceIndex > 0 ? fullTitle.substring(lastSpaceIndex + 1) : "";

            // Reset to full title first
            setTruncatedBookName(null);

            // Use requestAnimationFrame to ensure DOM has updated
            requestAnimationFrame(() => {
                const containerRect = container.getBoundingClientRect();
                const parentRect = container.parentElement?.getBoundingClientRect();
                
                if (!parentRect) return;

                // Calculate available width (with some buffer for safe spacing)
                const availableWidth = Math.min(
                    containerRect.width,
                    window.innerWidth < 400 ? window.innerWidth * 0.5 : // On very small screens, limit to 50%
                    window.innerWidth < 640 ? window.innerWidth * 0.6 : // On small screens, limit to 60%
                    window.innerWidth * 0.4 // On larger screens, limit to 40%
                );

                // Create temporary element to measure text width including subsection label
                const temp = document.createElement('span');
                temp.style.visibility = 'hidden';
                temp.style.position = 'absolute';
                temp.style.fontSize = window.getComputedStyle(container.querySelector('h1') || container).fontSize;
                temp.style.fontFamily = window.getComputedStyle(container.querySelector('h1') || container).fontFamily;
                
                // Account for subsection label like "(1-50)" if it exists
                const subsectionLabel = subsections.length > 0 && subsections[currentSubsectionIndex]?.label 
                    ? ` (${subsections[currentSubsectionIndex].label})` 
                    : "";
                temp.textContent = fullTitle + subsectionLabel;
                document.body.appendChild(temp);

                const fullWidth = temp.getBoundingClientRect().width;
                document.body.removeChild(temp);

                // If text is too wide, truncate the book name
                if (fullWidth > availableWidth && bookName.length > 3) {
                    // Calculate how many characters we can fit
                    const totalTextLength = fullTitle.length + subsectionLabel.length;
                    const avgCharWidth = fullWidth / totalTextLength;
                    const chapterNumWidth = chapterNum.length * avgCharWidth;
                    const subsectionLabelWidth = subsectionLabel.length * avgCharWidth;
                    const ellipsisWidth = 3 * avgCharWidth; // "..." width
                    const availableForBookName = availableWidth - chapterNumWidth - subsectionLabelWidth - ellipsisWidth;
                    const maxBookNameChars = Math.floor(availableForBookName / avgCharWidth);
                    
                    if (maxBookNameChars > 0) {
                        const truncated = bookName.substring(0, Math.max(1, maxBookNameChars - 1));
                        setTruncatedBookName(truncated);
                    }
                }
            });
        };

        // Initial calculation
        handleTitleResize();

        // Add resize observer for container changes
        let resizeObserver: ResizeObserver | null = null;
        if (window.ResizeObserver && chapterTitleRef.current) {
            resizeObserver = new ResizeObserver(handleTitleResize);
            resizeObserver.observe(chapterTitleRef.current);
        }

        // Add window resize listener as fallback
        window.addEventListener('resize', handleTitleResize);

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            window.removeEventListener('resize', handleTitleResize);
        };
    }, [getDisplayTitle, translationUnitsForSection, subsections, currentSubsectionIndex]);


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

    // Navigation functions for mobile menu
    const handlePreviousChapter = () => {
        if (!unsavedChanges) {
            const newChapter = chapterNumber === 1 ? totalChapters : chapterNumber - 1;
            jumpToChapter(newChapter);
        }
    };

    const handleNextChapter = () => {
        if (!unsavedChanges) {
            const newChapter = chapterNumber === totalChapters ? 1 : chapterNumber + 1;
            jumpToChapter(newChapter);
        }
    };

    // Define responsive layout variables
    const shouldUseMobileLayout = window.innerWidth < 640;
    const shouldUseThreeRowLayout = window.innerWidth < 400;

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
        <div className="relative flex flex-row p-2 max-w-full items-center">
            {/* Mobile hamburger menu - shows when page dropdown is hidden */}
            <div className={`hidden items-center ${subsections.length > 0 ? "max-[639px]:flex" : "max-[399px]:flex"}`}>
                <MobileHeaderMenu
                    isAutocompletingChapter={isAutocompletingChapter}
                    isTranslatingCell={isTranslatingCell}
                    onAutocompleteClick={handleAutocompleteClick}
                    onStopTranslation={handleStopTranslation}
                    unsavedChanges={unsavedChanges}
                    isSourceText={isSourceText}
                    textDirection={textDirection}
                    onSetTextDirection={onSetTextDirection}
                    cellDisplayMode={cellDisplayMode}
                    onSetCellDisplayMode={onSetCellDisplayMode}
                    fontSize={fontSize}
                    onFontSizeChange={handleFontSizeChange}
                    metadata={metadata}
                    onMetadataChange={onMetadataChange}
                    documentHasVideoAvailable={documentHasVideoAvailable}
                    shouldShowVideoPlayer={shouldShowVideoPlayer}
                    onToggleVideoPlayer={handleToggleVideoPlayer}
                    onOpenMetadataModal={handleOpenMetadataModal}
                    subsections={subsections}
                    currentSubsectionIndex={currentSubsectionIndex}
                    setCurrentSubsectionIndex={setCurrentSubsectionIndex}
                    chapterNumber={chapterNumber}
                    totalChapters={totalChapters}
                    jumpToChapter={jumpToChapter}
                    onPreviousChapter={handlePreviousChapter}
                    onNextChapter={handleNextChapter}
                    getDisplayTitle={getDisplayTitle}
                    vscode={vscode}
                />
            </div>

            {/* Desktop left controls */}
            <div className={`${subsections.length > 0 ? "hidden min-[640px]:flex" : "hidden min-[400px]:flex"} items-center justify-start flex-shrink-0`}>
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

            {/* Center navigation - flex centered */}
            <div className="flex-1 flex items-center justify-center space-x-2 min-w-0 mx-2">
                {/* Navigation arrows - hidden on very small screens (< 400px) */}
                <Button
                    className="hidden min-[400px]:inline-flex"
                    variant="outline"
                    size="default"
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
                    className="chapter-title-container flex items-center min-w-0 max-w-[40vw] min-[400px]:max-w-[50vw] sm:max-w-sm cursor-pointer min-[400px]:cursor-pointer"
                    onClick={() => {
                        // Always allow opening the chapter selector when there are no unsaved changes
                        if (!unsavedChanges) {
                            setShowChapterSelector(!showChapterSelector);
                        }
                    }}
                >
                    <h1 className="text-lg min-[400px]:text-2xl flex items-center m-0 min-w-0">
                        <span className="truncate">
                            {(() => {
                                if (truncatedBookName !== null) {
                                    return truncatedBookName + "...";
                                }
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
                        {/* Show page info - hide on narrow screens to prevent collisions */}
                        {subsections.length > 0 && (
                            <span className="flex-shrink-0 ml-1 text-sm md:text-base hidden min-[500px]:inline">
                                ({subsections[currentSubsectionIndex]?.label || ""})
                            </span>
                        )}
                        <i
                            className={`codicon ${
                                showChapterSelector ? "codicon-chevron-up" : "codicon-chevron-down"
                            } ml-1 flex-shrink-0 hidden min-[400px]:inline`}
                        />
                    </h1>
                </div>

                <Button
                    className="hidden min-[400px]:inline-flex"
                    variant="outline"
                    size="default"
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

                {/* Page selector - dynamic threshold: higher for long chapters (50+ verses) */}
                {subsections.length > 0 && (
                    <div className="hidden min-[640px]:flex items-center ml-4">
                        <span className="mr-2">Page:</span>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="default"
                                    className="flex items-center gap-2"
                                >
                                    {(() => {
                                        const currentSection = subsections[currentSubsectionIndex];
                                        const progress =
                                            calculateSubsectionProgress(currentSection);
                                        return (
                                            <>
                                                <span
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

            {/* Desktop right controls */}
            <div className={`${subsections.length > 0 ? "hidden min-[640px]:flex" : "hidden min-[400px]:flex"} items-center justify-end ml-auto space-x-2`}>
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
