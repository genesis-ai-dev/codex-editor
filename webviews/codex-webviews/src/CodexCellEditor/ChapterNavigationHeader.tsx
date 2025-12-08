import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "../components/ui/button";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import NotebookMetadataModal from "./NotebookMetadataModal";
import { AutocompleteModal } from "./modals/AutocompleteModal";
import { ChapterSelectorModal } from "./modals/ChapterSelectorModal";
import { MobileHeaderMenu } from "./components/MobileHeaderMenu";
import {
    type QuillCellContent,
    type CustomNotebookMetadata,
    type MilestoneIndex,
} from "../../../../types";
import { EditMapUtils } from "../../../../src/utils/editMapUtils";
import {
    getCellValueData,
    cellHasAudioUsingAttachments,
    computeValidationStats,
    computeProgressPercents,
} from "@sharedUtils";
import {
    type FileStatus,
    type EditorPosition,
    type Subsection,
    type ProgressPercentages,
} from "../lib/types";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Slider } from "../components/ui/slider";
import { Alert, AlertDescription } from "../components/ui/alert";
import { deriveSubsectionPercentages } from "./utils/progressUtils";
import { ProgressDots } from "./components/ProgressDots";

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
    chapterProgress?: Record<number, ProgressPercentages>;
    allCellsForChapter?: QuillCellContent[];
    onTempFontSizeChange?: (fontSize: number) => void;
    onFontSizeSave?: (fontSize: number) => void;
    requiredValidations?: number | null;
    requiredAudioValidations?: number | null;
    showInlineBacktranslations?: boolean;
    onToggleInlineBacktranslations?: () => void;

    // Milestone-based pagination props (optional - falls back to chapter-based when not provided)
    milestoneIndex?: MilestoneIndex | null;
    currentMilestoneIndex?: number;
    setCurrentMilestoneIndex?: React.Dispatch<React.SetStateAction<number>>;
    getSubsectionsForMilestone?: (milestoneIdx: number) => Subsection[];
    requestCellsForMilestone?: (milestoneIdx: number, subsectionIdx?: number) => void;
    isLoadingCells?: boolean;
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
    requiredValidations,
    requiredAudioValidations,
    showInlineBacktranslations = false,
    onToggleInlineBacktranslations,
    // Milestone-based pagination props
    milestoneIndex,
    currentMilestoneIndex = 0,
    setCurrentMilestoneIndex,
    getSubsectionsForMilestone,
    requestCellsForMilestone,
    isLoadingCells = false,
}: // Removed onToggleCorrectionEditor since it will be a VS Code command now
ChapterNavigationHeaderProps) {
    const [showConfirm, setShowConfirm] = useState(false);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
    const [autoDownloadAudioOnOpen, setAutoDownloadAudioOnOpenState] = useState<boolean>(false);
    const [showChapterSelector, setShowChapterSelector] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const chapterTitleRef = useRef<HTMLDivElement>(null);
    const headerContainerRef = useRef<HTMLDivElement>(null);
    const [truncatedBookName, setTruncatedBookName] = useState<string | null>(null);
    const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

    // Responsive breakpoint state with hysteresis to prevent flickering
    const [shouldShowHamburger, setShouldShowHamburger] = useState(window.innerWidth < 635);
    const [isVerySmallScreen, setIsVerySmallScreen] = useState(window.innerWidth < 395);

    // Font size state - default to 14 if not set in metadata
    const [fontSize, setFontSize] = useState(metadata?.fontSize || 14);
    const [pendingFontSize, setPendingFontSize] = useState<number | null>(null);

    // Determine if using milestone-based navigation
    const useMilestoneNavigation = milestoneIndex && milestoneIndex.milestones.length > 0;

    // Get subsections - use milestone-based when available, otherwise chapter-based
    const subsections = useMemo(() => {
        if (useMilestoneNavigation && getSubsectionsForMilestone) {
            return getSubsectionsForMilestone(currentMilestoneIndex);
        }
        return getSubsectionsForChapter(chapterNumber);
    }, [
        useMilestoneNavigation,
        getSubsectionsForMilestone,
        currentMilestoneIndex,
        getSubsectionsForChapter,
        chapterNumber,
    ]);

    // Get current milestone value for display
    const currentMilestoneValue = useMemo(() => {
        if (useMilestoneNavigation && milestoneIndex) {
            return milestoneIndex.milestones[currentMilestoneIndex]?.value || "1";
        }
        return null;
    }, [useMilestoneNavigation, milestoneIndex, currentMilestoneIndex]);

    // Total navigation units (milestones or chapters)
    const totalNavigationUnits = useMilestoneNavigation
        ? milestoneIndex!.milestones.length
        : totalChapters;

    // Current navigation index (milestone or chapter)
    const currentNavigationIndex = useMilestoneNavigation
        ? currentMilestoneIndex
        : chapterNumber - 1; // Convert 1-based chapter to 0-based index

    // Helper to determine if any translation is in progress
    const isAnyTranslationInProgress = isAutocompletingChapter || isTranslatingCell;

    // Update font size when metadata changes
    useEffect(() => {
        if (metadata?.fontSize !== undefined) {
            setFontSize(metadata.fontSize);
            setPendingFontSize(null); // Clear any pending changes
        }
    }, [metadata?.fontSize]);

    // Keep autoDownloadAudioOnOpen in sync when provider broadcasts metadata updates
    useEffect(() => {
        if (typeof metadata?.autoDownloadAudioOnOpen === "boolean") {
            setAutoDownloadAudioOnOpenState(!!metadata.autoDownloadAudioOnOpen);
        }
    }, [metadata?.autoDownloadAudioOnOpen]);

    // Memoized dropdown item row to reduce re-renders
    const MemoDropdownRow = useCallback(
        ({
            label,
            isActive,
            progress,
            onClick,
        }: {
            label: string;
            isActive: boolean;
            progress: {
                isFullyTranslated: boolean;
                isFullyValidated: boolean;
                percentTranslationsCompleted?: number;
                percentTextValidatedTranslations?: number;
                percentAudioTranslationsCompleted?: number;
                percentAudioValidatedTranslations?: number;
            };
            onClick: () => void;
        }) => {
            const progressPercentages = deriveSubsectionPercentages(progress);
            return (
                <DropdownMenuItem
                    onClick={onClick}
                    className={`flex items-center justify-between cursor-pointer ${
                        isActive ? "bg-accent text-accent-foreground font-semibold" : ""
                    }`}
                    role="menuitem"
                >
                    <span>{label}</span>
                    <ProgressDots
                        audio={{
                            validatedPercent: progressPercentages.audioValidatedPercent,
                            completedPercent: progressPercentages.audioCompletedPercent,
                        }}
                        text={{
                            validatedPercent: progressPercentages.textValidatedPercent,
                            completedPercent: progressPercentages.textCompletedPercent,
                        }}
                    />
                </DropdownMenuItem>
            );
        },
        []
    );

    // Determine the display name using the map
    const getDisplayTitle = useCallback(() => {
        // When using milestone navigation, show milestone value
        if (useMilestoneNavigation && currentMilestoneValue) {
            const firstMarker = translationUnitsForSection[0]?.cellMarkers?.[0]?.split(":")[0];
            if (firstMarker) {
                const parts = firstMarker.split(" ");
                const bookAbbr = parts[0];
                const localizedName = bibleBookMap?.get(bookAbbr)?.name;
                const displayBookName = localizedName || bookAbbr;
                return `${displayBookName}\u00A0${currentMilestoneValue}`;
            }
            return `Section\u00A0${currentMilestoneValue}`;
        }

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
    }, [translationUnitsForSection, bibleBookMap, useMilestoneNavigation, currentMilestoneValue]);

    // Centralized title measurement logic
    const measureAndTruncateTitle = useCallback(() => {
        const container = chapterTitleRef.current;
        if (!container) return;

        const fullTitle = getDisplayTitle();
        const lastSpaceIndex = Math.max(
            fullTitle.lastIndexOf("\u00A0"),
            fullTitle.lastIndexOf(" ")
        );
        const bookName = lastSpaceIndex > 0 ? fullTitle.substring(0, lastSpaceIndex) : fullTitle;
        const chapterNum = lastSpaceIndex > 0 ? fullTitle.substring(lastSpaceIndex + 1) : "";

        requestAnimationFrame(() => {
            const parentRect = container.parentElement?.getBoundingClientRect();
            if (!parentRect) return;

            const availableWidth = Math.min(
                parentRect.width,
                isVerySmallScreen
                    ? window.innerWidth * 0.5
                    : shouldShowHamburger
                    ? window.innerWidth * 0.6
                    : window.innerWidth * 0.4
            );

            const temp = document.createElement("span");
            const h1 = container.querySelector("h1") as HTMLElement | null;
            temp.style.visibility = "hidden";
            temp.style.position = "absolute";
            temp.style.fontSize = window.getComputedStyle(h1 || container).fontSize;
            temp.style.fontFamily = window.getComputedStyle(h1 || container).fontFamily;

            const subsectionLabel =
                !shouldShowHamburger &&
                subsections.length > 0 &&
                subsections[currentSubsectionIndex]?.label
                    ? ` (${subsections[currentSubsectionIndex].label})`
                    : "";
            temp.textContent = fullTitle + subsectionLabel;
            document.body.appendChild(temp);

            const fullWidth = temp.getBoundingClientRect().width;
            document.body.removeChild(temp);

            if (fullWidth > availableWidth && bookName.length > 3) {
                const totalTextLength = fullTitle.length + subsectionLabel.length;
                const avgCharWidth = fullWidth / totalTextLength;
                const chapterNumWidth = chapterNum.length * avgCharWidth;
                const subsectionLabelWidth = subsectionLabel.length * avgCharWidth;
                const ellipsisWidth = 3 * avgCharWidth;
                const availableForBookName =
                    availableWidth - chapterNumWidth - subsectionLabelWidth - ellipsisWidth;
                const maxBookNameChars = Math.floor(availableForBookName / avgCharWidth);

                if (maxBookNameChars > 0) {
                    const truncated = bookName.substring(0, Math.max(1, maxBookNameChars - 1));
                    setTruncatedBookName((prev) => (prev !== truncated ? truncated : prev));
                }
            } else {
                setTruncatedBookName((prev) => (prev !== null ? null : prev));
            }
        });
    }, [
        getDisplayTitle,
        isVerySmallScreen,
        shouldShowHamburger,
        subsections,
        currentSubsectionIndex,
    ]);

    // Unified resize handling with RAF throttling
    useEffect(() => {
        let ticking = false;
        const onResize = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                const width = window.innerWidth;

                if (!shouldShowHamburger && width < 635) {
                    setShouldShowHamburger(true);
                } else if (shouldShowHamburger && width > 645) {
                    setShouldShowHamburger(false);
                }

                if (!isVerySmallScreen && width < 395) {
                    setIsVerySmallScreen(true);
                } else if (isVerySmallScreen && width > 405) {
                    setIsVerySmallScreen(false);
                }

                measureAndTruncateTitle();
            });
        };

        // Initial run
        onResize();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [measureAndTruncateTitle, shouldShowHamburger, isVerySmallScreen]);

    // Observe container size changes that may affect title truncation
    useEffect(() => {
        if (!window.ResizeObserver) return;
        const obs = new ResizeObserver(() => {
            requestAnimationFrame(() => measureAndTruncateTitle());
        });
        if (headerContainerRef.current) obs.observe(headerContainerRef.current);
        if (chapterTitleRef.current) obs.observe(chapterTitleRef.current);
        return () => obs.disconnect();
    }, [measureAndTruncateTitle]);

    // Debounced resize handler to prevent excessive re-renders
    const debouncedResizeHandler = useMemo(() => {
        let timeoutId: ReturnType<typeof setTimeout>;
        return (callback: () => void) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                requestAnimationFrame(callback);
            }, 150);
        };
    }, []);

    // Responsive breakpoint management with hysteresis
    useEffect(() => {
        const handleBreakpointResize = () => {
            const width = window.innerWidth;

            // Hamburger menu breakpoint with 5px buffer zone
            if (!shouldShowHamburger && width < 635) {
                setShouldShowHamburger(true);
            } else if (shouldShowHamburger && width > 645) {
                setShouldShowHamburger(false);
            }

            // Very small screen breakpoint with 5px buffer zone
            if (!isVerySmallScreen && width < 395) {
                setIsVerySmallScreen(true);
            } else if (isVerySmallScreen && width > 405) {
                setIsVerySmallScreen(false);
            }
        };

        // Run initial check
        handleBreakpointResize();

        const debouncedBreakpointHandler = () => {
            debouncedResizeHandler(handleBreakpointResize);
        };

        window.addEventListener("resize", debouncedBreakpointHandler);
        return () => window.removeEventListener("resize", debouncedBreakpointHandler);
    }, [shouldShowHamburger, isVerySmallScreen, debouncedResizeHandler]);

    // Dynamic title truncation based on available space - now universal (not screen-size dependent)
    useEffect(() => {
        const handleTitleResize = () => {
            const container = chapterTitleRef.current;
            if (!container) return;

            const fullTitle = getDisplayTitle();
            const lastSpaceIndex = Math.max(
                fullTitle.lastIndexOf("\u00A0"),
                fullTitle.lastIndexOf(" ")
            );
            const bookName =
                lastSpaceIndex > 0 ? fullTitle.substring(0, lastSpaceIndex) : fullTitle;
            const chapterNum = lastSpaceIndex > 0 ? fullTitle.substring(lastSpaceIndex + 1) : "";

            // Use requestAnimationFrame to ensure DOM has updated
            requestAnimationFrame(() => {
                const parentRect = container.parentElement?.getBoundingClientRect();

                if (!parentRect) return;

                // Calculate available width based on responsive states
                const availableWidth = Math.min(
                    parentRect.width,
                    isVerySmallScreen
                        ? window.innerWidth * 0.5 // On very small screens, limit to 50%
                        : shouldShowHamburger
                        ? window.innerWidth * 0.6 // On mobile layout, limit to 60%
                        : window.innerWidth * 0.4 // On larger screens, limit to 40%
                );

                // Create temporary element to measure text width including subsection label
                const temp = document.createElement("span");
                temp.style.visibility = "hidden";
                temp.style.position = "absolute";
                temp.style.fontSize = window.getComputedStyle(
                    container.querySelector("h1") || container
                ).fontSize;
                temp.style.fontFamily = window.getComputedStyle(
                    container.querySelector("h1") || container
                ).fontFamily;

                // Account for subsection label like "(1-50)" only when it should be visible
                const subsectionLabel =
                    !shouldShowHamburger && // Use responsive state - show subsection label when not using hamburger menu
                    subsections.length > 0 &&
                    subsections[currentSubsectionIndex]?.label
                        ? ` (${subsections[currentSubsectionIndex].label})`
                        : "";
                temp.textContent = fullTitle + subsectionLabel;
                document.body.appendChild(temp);

                const fullWidth = temp.getBoundingClientRect().width;
                document.body.removeChild(temp);

                // If text is too wide, truncate the book name (now universal, not screen-size dependent)
                if (fullWidth > availableWidth && bookName.length > 3) {
                    // Calculate how many characters we can fit
                    const totalTextLength = fullTitle.length + subsectionLabel.length;
                    const avgCharWidth = fullWidth / totalTextLength;
                    const chapterNumWidth = chapterNum.length * avgCharWidth;
                    const subsectionLabelWidth = subsectionLabel.length * avgCharWidth;
                    const ellipsisWidth = 3 * avgCharWidth; // "..." width
                    const availableForBookName =
                        availableWidth - chapterNumWidth - subsectionLabelWidth - ellipsisWidth;
                    const maxBookNameChars = Math.floor(availableForBookName / avgCharWidth);

                    if (maxBookNameChars > 0) {
                        const truncated = bookName.substring(0, Math.max(1, maxBookNameChars - 1));
                        setTruncatedBookName((prev) => (prev !== truncated ? truncated : prev));
                    }
                } else {
                    // Ensure we clear truncation only when needed to avoid extra renders
                    setTruncatedBookName((prev) => (prev !== null ? null : prev));
                }
            });
        };

        const debouncedTitleHandler = () => {
            debouncedResizeHandler(handleTitleResize);
        };

        // Initial calculation
        handleTitleResize();

        // Add resize observer for container changes
        let resizeObserver: ResizeObserver | null = null;
        if (window.ResizeObserver && chapterTitleRef.current) {
            resizeObserver = new ResizeObserver(() => {
                debouncedResizeHandler(handleTitleResize);
            });
            resizeObserver.observe(chapterTitleRef.current);
        }

        // Add window resize listener as fallback
        window.addEventListener("resize", debouncedTitleHandler);

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            window.removeEventListener("resize", debouncedTitleHandler);
        };
    }, [
        getDisplayTitle,
        translationUnitsForSection,
        subsections,
        currentSubsectionIndex,
        shouldShowHamburger,
        isVerySmallScreen,
        debouncedResizeHandler,
    ]);

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
                vscode.postMessage({
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

    // Removed unused getFileStatusButton to reduce dead code

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
            vscode.postMessage({
                command: "jumpToChapter",
                chapterNumber: newChapter,
            });
            setChapterNumber(newChapter);
            // Reset to first page when jumping to a different chapter through chapter selector
            setCurrentSubsectionIndex(0);
        }
    };

    // Navigation function for milestone-based navigation
    const jumpToMilestone = useCallback(
        (newMilestoneIdx: number, newSubsectionIdx: number = 0) => {
            if (
                !unsavedChanges &&
                (newMilestoneIdx !== currentMilestoneIndex ||
                    newSubsectionIdx !== currentSubsectionIndex)
            ) {
                // requestCellsForMilestone handles state updates internally
                // (both for cached pages and when loading new pages)
                if (requestCellsForMilestone) {
                    requestCellsForMilestone(newMilestoneIdx, newSubsectionIdx);
                } else {
                    // Fallback if requestCellsForMilestone is not provided
                    if (setCurrentMilestoneIndex) {
                        setCurrentMilestoneIndex(newMilestoneIdx);
                    }
                    setCurrentSubsectionIndex(newSubsectionIdx);
                }
            }
        },
        [
            unsavedChanges,
            currentMilestoneIndex,
            currentSubsectionIndex,
            requestCellsForMilestone,
            setCurrentMilestoneIndex,
            setCurrentSubsectionIndex,
        ]
    );

    // Unified navigation function that uses milestone or chapter navigation based on mode
    const navigateTo = useCallback(
        (index: number, subsectionIdx: number = 0) => {
            if (useMilestoneNavigation) {
                jumpToMilestone(index, subsectionIdx);
            } else {
                jumpToChapter(index + 1); // Convert 0-based to 1-based chapter
                setCurrentSubsectionIndex(subsectionIdx);
            }
        },
        [useMilestoneNavigation, jumpToMilestone, jumpToChapter, setCurrentSubsectionIndex]
    );

    // Removed unused handlePreviousChapter/handleNextChapter to reduce dead code

    // Use dynamic responsive state variables based on content overflow
    const shouldUseMinimalLayout = isVerySmallScreen; // Use minimal layout for very small screens only
    const shouldHideNavButtons = isVerySmallScreen; // Hide nav buttons on very small screens

    // Calculate progress for each subsection/page
    const calculateSubsectionProgress = (
        subsection: Subsection,
        forSourceText: boolean = isSourceText
    ) => {
        // Use allCellsForChapter if available, otherwise fall back to translationUnitsForSection
        const allChapterCells = allCellsForChapter || translationUnitsForSection;

        // Get cells for this specific subsection from the full chapter data
        const subsectionCells = allChapterCells.slice(subsection.startIndex, subsection.endIndex);

        // Filter out paratext and merged cells for progress calculation
        const validCells = subsectionCells.filter((cell) => {
            const cellId = cell?.cellMarkers?.[0];
            return cellId && !cellId.startsWith("paratext-") && !cell.merged;
        });

        const totalCells = validCells.length;
        if (totalCells === 0) {
            return {
                isFullyTranslated: false,
                isFullyValidated: false,
                percentTranslationsCompleted: 0,
                percentAudioTranslationsCompleted: 0,
                percentFullyValidatedTranslations: 0,
                percentAudioValidatedTranslations: 0,
                percentTextValidatedTranslations: 0,
            };
        }

        // Check if all cells have content (translated for target, existing for source)
        const completedCells = validCells.filter((cell) => {
            const hasContent =
                cell.cellContent &&
                cell.cellContent.trim().length > 0 &&
                cell.cellContent !== "<span></span>";

            if (forSourceText) {
                // For source text, we just check if content exists
                return hasContent;
            } else {
                // For target text, we check if it's been translated (has content)
                return hasContent;
            }
        });
        const isFullyTranslated = completedCells.length === totalCells;

        // Calculate audio presence for subsection (mirrors chapter calculation)
        const cellsWithAudioValues = validCells.filter((cell) =>
            cellHasAudioUsingAttachments(
                (cell as any).attachments,
                (cell as any).metadata?.selectedAudioId
            )
        ).length;

        // Check if all cells are validated
        let isFullyValidated = false;
        const minimumValidationsRequired =
            (requiredValidations ?? undefined) !== undefined
                ? (requiredValidations as number) ?? 1
                : (window as any)?.initialData?.validationCount ?? 1;
        const minimumAudioValidationsRequired =
            (requiredAudioValidations ?? undefined) !== undefined
                ? (requiredAudioValidations as number) ?? 1
                : (window as any)?.initialData?.validationCountAudio ?? 1;

        // Calculate validation data using shared utils
        const cellWithValidatedData = validCells.map((cell) => getCellValueData(cell));

        const { validatedCells, audioValidatedCells, fullyValidatedCells } = computeValidationStats(
            cellWithValidatedData,
            minimumValidationsRequired,
            minimumAudioValidationsRequired
        );

        const {
            percentTranslationsCompleted,
            percentAudioTranslationsCompleted,
            percentAudioValidatedTranslations,
            percentTextValidatedTranslations,
            percentFullyValidatedTranslations,
        } = computeProgressPercents(
            totalCells,
            completedCells.length,
            cellsWithAudioValues,
            validatedCells,
            audioValidatedCells,
            fullyValidatedCells
        );

        if (isFullyTranslated) {
            // Maintain existing gating for the boolean display in this header
            isFullyValidated = fullyValidatedCells === totalCells;
        }

        return {
            isFullyTranslated,
            isFullyValidated,
            percentTranslationsCompleted,
            percentAudioTranslationsCompleted,
            percentFullyValidatedTranslations,
            percentAudioValidatedTranslations,
            percentTextValidatedTranslations,
        };
    };

    return (
        <div
            className={`relative flex flex-row ${
                shouldUseMinimalLayout ? "p-1" : "p-2"
            } max-w-full items-center transition-all duration-200 ease-in-out`}
            ref={headerContainerRef}
        >
            {/* Hamburger menu positioned on the left when space is insufficient */}
            {shouldShowHamburger && (
                <div className="flex items-center">
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
                        vscode={vscode}
                        toggleScrollSync={toggleScrollSync}
                        scrollSyncEnabled={scrollSyncEnabled}
                        openSourceText={openSourceText}
                        chapterNumber={chapterNumber}
                        isCorrectionEditorMode={isCorrectionEditorMode}
                        totalChapters={totalChapters}
                        setChapterNumber={setChapterNumber}
                        jumpToChapter={jumpToChapter}
                        showUnsavedWarning={() => {
                            setShowUnsavedWarning(true);
                            setTimeout(() => setShowUnsavedWarning(false), 3000);
                        }}
                        getSubsectionsForChapter={getSubsectionsForChapter}
                        shouldHideNavButtons={shouldHideNavButtons}
                        allCellsForChapter={allCellsForChapter}
                        calculateSubsectionProgress={calculateSubsectionProgress}
                        autoDownloadAudioOnOpen={autoDownloadAudioOnOpen}
                        onToggleAutoDownloadAudio={(val) => {
                            setAutoDownloadAudioOnOpenState(!!val);
                            try {
                                vscode.postMessage({
                                    command: "setAutoDownloadAudioOnOpen",
                                    content: { value: !!val },
                                });
                            } catch (error) {
                                console.error("Error setting auto download audio on open", error);
                            }
                        }}
                    />
                </div>
            )}

            {/* Desktop left controls - hidden when hamburger is active */}
            <div
                className={`${
                    shouldShowHamburger ? "hidden" : "flex"
                } items-center justify-start flex-shrink-0 transition-all duration-200 ease-in-out`}
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

            {/* Center navigation - always visible, scales down when space is limited */}
            <div
                className={`flex-1 flex items-center justify-center space-x-2 min-w-0 mx-2 transition-all duration-200 ease-in-out`}
            >
                {/* Navigation arrows - hidden on very small screens */}
                {!shouldHideNavButtons && (
                    <Button
                        className="inline-flex transition-all duration-200 ease-in-out"
                        variant="outline"
                        size="default"
                        disabled={isLoadingCells}
                        onClick={() => {
                            if (!unsavedChanges) {
                                // Check if we're on the first page of the current section
                                if (currentSubsectionIndex > 0) {
                                    // Move to previous page within the same section
                                    if (useMilestoneNavigation) {
                                        jumpToMilestone(
                                            currentMilestoneIndex,
                                            currentSubsectionIndex - 1
                                        );
                                    } else {
                                        setCurrentSubsectionIndex(currentSubsectionIndex - 1);
                                    }
                                } else {
                                    // Move to previous milestone/chapter
                                    if (useMilestoneNavigation) {
                                        const newMilestoneIdx =
                                            currentMilestoneIndex === 0
                                                ? totalNavigationUnits - 1
                                                : currentMilestoneIndex - 1;
                                        // Get subsections for the new milestone
                                        const newSubsections = getSubsectionsForMilestone
                                            ? getSubsectionsForMilestone(newMilestoneIdx)
                                            : [];
                                        const lastSubsectionIdx =
                                            newSubsections.length > 0
                                                ? newSubsections.length - 1
                                                : 0;
                                        jumpToMilestone(newMilestoneIdx, lastSubsectionIdx);
                                    } else {
                                        const newChapter =
                                            chapterNumber === 1 ? totalChapters : chapterNumber - 1;
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
                                }
                            } else {
                                // Show warning when there are unsaved changes
                                setShowUnsavedWarning(true);
                                setTimeout(() => setShowUnsavedWarning(false), 3000);
                            }
                        }}
                        title={
                            unsavedChanges
                                ? "Save changes first to change section"
                                : currentSubsectionIndex > 0
                                ? "Previous Page"
                                : useMilestoneNavigation
                                ? "Previous Milestone"
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
                )}

                <div
                    ref={chapterTitleRef}
                    className="chapter-title-container flex items-center min-w-0 max-w-full cursor-pointer rounded-md transition-all duration-200 ease-in-out px-2"
                    onClick={() => {
                        // Always allow opening the chapter selector when there are no unsaved changes
                        if (!unsavedChanges) {
                            setShowChapterSelector(!showChapterSelector);
                        } else {
                            // Show warning when there are unsaved changes
                            setShowUnsavedWarning(true);
                            setTimeout(() => setShowUnsavedWarning(false), 3000);
                        }
                    }}
                >
                    <h1
                        className={`${
                            shouldUseMinimalLayout ? "text-sm" : "text-2xl"
                        } flex items-center m-0 min-w-0 transition-all duration-200 ease-in-out`}
                    >
                        <span
                            className={`${
                                shouldUseMinimalLayout || truncatedBookName !== null
                                    ? "truncate"
                                    : "whitespace-nowrap"
                            } transition-all duration-200 ease-in-out`}
                        >
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
                        {/* Show page info - hide when using hamburger menu to prevent collisions */}
                        {subsections.length > 0 && !shouldShowHamburger && (
                            <span
                                className={`flex-shrink-0 ml-1 ${
                                    shouldUseMinimalLayout ? "text-xs" : "text-sm"
                                } inline transition-opacity duration-200 ease-in-out`}
                            >
                                ({subsections[currentSubsectionIndex]?.label || ""})
                            </span>
                        )}
                        <i
                            className={`codicon ${
                                showChapterSelector ? "codicon-chevron-up" : "codicon-chevron-down"
                            } ml-1 flex-shrink-0 ${shouldUseMinimalLayout ? "hidden" : "inline"}`}
                        />
                    </h1>
                </div>

                {!shouldHideNavButtons && (
                    <Button
                        className="inline-flex transition-all duration-200 ease-in-out"
                        variant="outline"
                        size="default"
                        disabled={isLoadingCells}
                        onClick={() => {
                            if (!unsavedChanges) {
                                // Check if we're on the last page of the current section
                                if (
                                    subsections.length > 0 &&
                                    currentSubsectionIndex < subsections.length - 1
                                ) {
                                    // Move to next page within the same section
                                    if (useMilestoneNavigation) {
                                        jumpToMilestone(
                                            currentMilestoneIndex,
                                            currentSubsectionIndex + 1
                                        );
                                    } else {
                                        setCurrentSubsectionIndex(currentSubsectionIndex + 1);
                                    }
                                } else {
                                    // Move to next milestone/chapter and reset to first page
                                    if (useMilestoneNavigation) {
                                        const newMilestoneIdx =
                                            currentMilestoneIndex === totalNavigationUnits - 1
                                                ? 0
                                                : currentMilestoneIndex + 1;
                                        jumpToMilestone(newMilestoneIdx, 0);
                                    } else {
                                        const newChapter =
                                            chapterNumber === totalChapters ? 1 : chapterNumber + 1;
                                        jumpToChapter(newChapter);
                                        setCurrentSubsectionIndex(0);
                                    }
                                }
                            } else {
                                // Show warning when there are unsaved changes
                                setShowUnsavedWarning(true);
                                setTimeout(() => setShowUnsavedWarning(false), 3000);
                            }
                        }}
                        title={
                            unsavedChanges
                                ? "Save changes first to change section"
                                : subsections.length > 0 &&
                                  currentSubsectionIndex < subsections.length - 1
                                ? "Next Page"
                                : useMilestoneNavigation
                                ? "Next Milestone"
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
                )}

                {/* Page selector - shown when not using hamburger menu */}
                {subsections.length > 0 && !shouldShowHamburger && (
                    <div className="flex items-center ml-4 transition-all duration-200 ease-in-out">
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
                                        const progress = calculateSubsectionProgress(
                                            currentSection,
                                            isSourceText
                                        );
                                        return (
                                            <>
                                                <span>{currentSection?.label || ""}</span>
                                                {(() => {
                                                    const percentages =
                                                        deriveSubsectionPercentages(progress);
                                                    return (
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
                                                    );
                                                })()}
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
                                    const progress = calculateSubsectionProgress(
                                        section,
                                        isSourceText
                                    );
                                    const isActive = currentSubsectionIndex === index;
                                    return (
                                        <MemoDropdownRow
                                            key={section.id}
                                            label={section.label}
                                            isActive={isActive}
                                            progress={progress}
                                            onClick={() => setCurrentSubsectionIndex(index)}
                                        />
                                    );
                                })}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>

            {/* Desktop right controls - hidden when hamburger is active */}
            <div
                className={`${
                    shouldShowHamburger ? "hidden" : "flex"
                } items-center justify-end ml-auto space-x-2`}
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
                        <Button variant="outline" title="Advanced Settings" className="relative">
                            <i className="codicon codicon-settings-gear" />
                            {autoDownloadAudioOnOpen ? (
                                <span
                                    className="absolute rounded-full"
                                    style={{
                                        width: 8,
                                        height: 8,
                                        right: 6,
                                        top: 6,
                                        backgroundColor: "var(--vscode-charts-blue)",
                                    }}
                                    title="Auto-download enabled"
                                />
                            ) : null}
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
                                const next = !autoDownloadAudioOnOpen;
                                setAutoDownloadAudioOnOpenState(next);
                                try {
                                    vscode.postMessage({
                                        command: "setAutoDownloadAudioOnOpen",
                                        content: { value: next },
                                    });
                                } catch (error) {
                                    console.error(
                                        "Error setting auto download audio on open",
                                        error
                                    );
                                }
                                try {
                                    (window as any).__autoDownloadAudioOnOpen = next;
                                    (window as any).__autoDownloadAudioOnOpenInitialized = true;
                                } catch (error) {
                                    console.error(
                                        "Error setting auto download audio on open",
                                        error
                                    );
                                }
                            }}
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
                        <DropdownMenuItem
                            onClick={() => {
                                if (onToggleInlineBacktranslations) {
                                    onToggleInlineBacktranslations();
                                }
                            }}
                            className="cursor-pointer"
                        >
                            <i className="codicon codicon-eye mr-2 h-4 w-4" />
                            <span className="flex-1">Show inline backtranslations</span>
                            <span
                                className="text-xs px-2 py-0.5 rounded-full"
                                style={{
                                    backgroundColor: showInlineBacktranslations
                                        ? "var(--vscode-charts-blue)"
                                        : "var(--vscode-editorHoverWidget-border)",
                                    color: showInlineBacktranslations
                                        ? "var(--vscode-editor-background)"
                                        : "var(--vscode-foreground)",
                                }}
                            >
                                {showInlineBacktranslations ? "On" : "Off"}
                            </span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                            onClick={() => {
                                const newMode =
                                    cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                        ? CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
                                        : CELL_DISPLAY_MODES.INLINE;
                                onSetCellDisplayMode(newMode);
                                vscode.postMessage({
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
                            <div className="flex items-center justify-between mb-0.5">
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

            {/* Warning alert for unsaved changes */}
            {showUnsavedWarning && (
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 z-50 w-80 max-w-[90vw]">
                    <Alert variant="destructive" className="bg-red-50 border-red-200 shadow-lg">
                        <i className="codicon codicon-warning h-4 w-4" />
                        <AlertDescription className="text-red-800">
                            Please close the editor or save your changes before navigating away from
                            this section.
                        </AlertDescription>
                    </Alert>
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
