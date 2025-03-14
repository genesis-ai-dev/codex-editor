import React, { useState, useEffect } from "react";
import {
    VSCodeBadge,
    VSCodeButton,
    VSCodeRadio,
    VSCodeRadioGroup,
    VSCodeTag,
    VSCodeCheckbox,
} from "@vscode/webview-ui-toolkit/react";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import NotebookMetadataModal from "./NotebookMetadataModal";
import { CustomNotebookMetadata, QuillCellContent } from "../../../../types";

interface AutocompleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (numberOfCells: number, includeNotValidatedByCurrentUser: boolean) => void;
    totalCellsToAutocomplete: number;
    totalCellsWithCurrentUserOption: number;
    defaultValue?: number;
}

const AutocompleteModal: React.FC<AutocompleteModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    totalCellsToAutocomplete,
    totalCellsWithCurrentUserOption,
    defaultValue = Math.min(5, totalCellsToAutocomplete > 0 ? totalCellsToAutocomplete : 5),
}) => {
    // Initialize with the correct value for non-user-validated cells
    const [numberOfCellsToAutocomplete, setNumberOfCellsToAutocomplete] = useState(
        totalCellsToAutocomplete > 0 ? defaultValue : 0
    );
    const [customValue, setCustomValue] = useState(
        totalCellsToAutocomplete > 0 ? defaultValue : 0
    );
    const [includeNotValidatedByCurrentUser, setIncludeNotValidatedByCurrentUser] = useState(false);
    // Start with the base total (cells without content or without any validators)
    const [effectiveTotalCells, setEffectiveTotalCells] = useState(totalCellsToAutocomplete);

    // Log initial values to debug
    useEffect(() => {
        console.log('Modal initialized with:', {
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption,
            defaultValue,
            effectiveTotalCells
        });
    }, []);

    // Update effective total cells when props change
    useEffect(() => {
        console.log("Props changed:", {
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption
        });
        
        if (includeNotValidatedByCurrentUser) {
            setEffectiveTotalCells(totalCellsWithCurrentUserOption);
        } else {
            setEffectiveTotalCells(totalCellsToAutocomplete);
        }
        
        // Adjust default values if needed
        const newEffectiveTotal = includeNotValidatedByCurrentUser ? 
            totalCellsWithCurrentUserOption : totalCellsToAutocomplete;
            
        if (numberOfCellsToAutocomplete > newEffectiveTotal) {
            const newDefaultValue = Math.min(5, newEffectiveTotal);
            setNumberOfCellsToAutocomplete(newDefaultValue);
            setCustomValue(newDefaultValue);
        }
    }, [totalCellsToAutocomplete, totalCellsWithCurrentUserOption, includeNotValidatedByCurrentUser]);

    // Update effective total cells when checkbox state changes
    const handleCheckboxChange = () => {
        const newValue = !includeNotValidatedByCurrentUser;
        console.log("CHECKBOX CHANGED TO:", newValue, "- THIS SHOULD UPDATE THE DISPLAY");
        
        // Update checkbox state
        setIncludeNotValidatedByCurrentUser(newValue);
        
        // Update the effective total based on checkbox state
        const newTotalCells = newValue ? totalCellsWithCurrentUserOption : totalCellsToAutocomplete;
        console.log('CHECKBOX CHANGE EFFECT:', { 
            newValue, 
            totalCellsToAutocomplete, 
            totalCellsWithCurrentUserOption, 
            newTotalCells 
        });
        
        // Force immediate update of effectiveTotalCells
        setEffectiveTotalCells(newTotalCells);
        
        // Update the number of cells to autocomplete if needed
        if (numberOfCellsToAutocomplete > newTotalCells) {
            // Cap to new maximum
            setNumberOfCellsToAutocomplete(newTotalCells);
            setCustomValue(newTotalCells);
        } else if (numberOfCellsToAutocomplete === 0 && newTotalCells > 0) {
            // Set to default if currently 0
            const newDefaultValue = Math.min(5, newTotalCells);
            setNumberOfCellsToAutocomplete(newDefaultValue);
            setCustomValue(newDefaultValue);
        }
        
        // For debugging only - should show state changes
        setTimeout(() => {
            console.log("AFTER CHECKBOX CHANGE:", {
                includeNotValidatedByCurrentUser: newValue,
                effectiveTotalCells: newTotalCells,
                numberOfCellsToAutocomplete: (numberOfCellsToAutocomplete > newTotalCells) 
                    ? newTotalCells 
                    : numberOfCellsToAutocomplete
            });
        }, 0);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2 style={{ marginBottom: "1rem" }}>Autocomplete Cells</h2>
                <VSCodeTag style={{ marginBottom: "1rem" }}>
                    Autocomplete {numberOfCellsToAutocomplete || 0} Cells
                </VSCodeTag>
                <VSCodeRadioGroup
                    value={
                        numberOfCellsToAutocomplete === effectiveTotalCells
                            ? effectiveTotalCells.toString()
                            : "custom"
                    }
                    onChange={(e) => {
                        const target = e.target as HTMLInputElement;
                        if (target.value === "custom") {
                            if (effectiveTotalCells === 0) {
                                setCustomValue(0);
                                setNumberOfCellsToAutocomplete(0);
                            } else if (!customValue) {
                                const defaultValue = Math.min(5, effectiveTotalCells);
                                setCustomValue(defaultValue);
                                setNumberOfCellsToAutocomplete(defaultValue);
                            } else {
                                setNumberOfCellsToAutocomplete(customValue);
                            }
                        } else if (target.value === effectiveTotalCells.toString()) {
                            setNumberOfCellsToAutocomplete(effectiveTotalCells);
                        }
                    }}
                >
                    <label slot="label">Autocomplete</label>
                    <VSCodeRadio value="custom">
                        <input
                            type="number"
                            min="1"
                            max={effectiveTotalCells}
                            defaultValue={Math.min(5, effectiveTotalCells)}
                            value={
                                customValue === 0
                                    ? "0"
                                    : Math.min(customValue, effectiveTotalCells)
                            }
                            onFocus={(e) => {
                                const defaultValue = Math.min(5, effectiveTotalCells);
                                if (!customValue) {
                                    setCustomValue(defaultValue);
                                }
                                setNumberOfCellsToAutocomplete(customValue || defaultValue);

                                // Select the custom radio button
                                const radioGroup = e.currentTarget.closest("vscode-radio-group");
                                if (radioGroup) {
                                    const event = new Event("change", {
                                        bubbles: true,
                                    });
                                    Object.defineProperty(event, "target", {
                                        value: { value: "custom" },
                                        enumerable: true,
                                    });
                                    radioGroup.dispatchEvent(event);
                                }
                            }}
                            onChange={(e) => {
                                const inputValue = e.target.value;
                                if (inputValue === "") {
                                    setCustomValue(0);
                                    setNumberOfCellsToAutocomplete(0);
                                    return;
                                }
                                const value = parseInt(inputValue);
                                if (!isNaN(value) && value >= 0) {
                                    const cappedValue = Math.min(value, effectiveTotalCells);
                                    setCustomValue(cappedValue);
                                    setNumberOfCellsToAutocomplete(cappedValue);
                                }
                            }}
                            style={{ 
                                width: "60px", 
                                marginLeft: "8px",
                                border: "2px solid var(--vscode-focusBorder)",
                                borderRadius: "4px",
                                padding: "4px",
                                outline: "none",
                                boxShadow: "0 0 0 1px var(--vscode-focusBorder)"
                            }}
                            className="autocomplete-number-input"
                        />
                    </VSCodeRadio>
                    <VSCodeRadio value={effectiveTotalCells.toString()}>
                        All ({effectiveTotalCells})
                    </VSCodeRadio>
                </VSCodeRadioGroup>
                
                <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
                    <label 
                        className="checkbox-container" 
                        style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
                    >
                        <div 
                            className="custom-checkbox" 
                            style={{
                                width: "18px",
                                height: "18px",
                                border: "2px solid var(--vscode-checkbox-border, #6c757d)",
                                borderRadius: "3px",
                                backgroundColor: includeNotValidatedByCurrentUser ? 
                                    "var(--vscode-focusBorder, #007fd4)" : 
                                    "var(--vscode-checkbox-background, #252526)",
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                marginRight: "8px",
                                position: "relative",
                                cursor: "pointer",
                                boxShadow: includeNotValidatedByCurrentUser ? 
                                    "0 0 2px 1px var(--vscode-focusBorder, #007fd4)" : 
                                    "none"
                            }}
                            onClick={handleCheckboxChange}
                        >
                            {includeNotValidatedByCurrentUser && (
                                <div 
                                    style={{
                                        width: "6px",
                                        height: "10px",
                                        borderRight: "2px solid white",
                                        borderBottom: "2px solid white",
                                        transform: "rotate(45deg) translate(-1px, -1px)",
                                        position: "absolute"
                                    }}
                                />
                            )}
                        </div>
                        <span onClick={handleCheckboxChange}>
                            Include cells not validated by the current user

                        </span>
                    </label>
                </div>
                
                <div className="modal-actions">
                    <VSCodeButton onClick={onClose} appearance="secondary">
                        Cancel
                    </VSCodeButton>
                    <VSCodeButton
                        onClick={() => onConfirm(numberOfCellsToAutocomplete, includeNotValidatedByCurrentUser)}
                        disabled={numberOfCellsToAutocomplete === 0}
                    >
                        Confirm
                    </VSCodeButton>
                </div>
            </div>
        </div>
    );
};

interface ChapterNavigationProps {
    chapterNumber: number;
    setChapterNumber: React.Dispatch<React.SetStateAction<number>>;
    unsavedChanges: boolean;
    onAutocompleteChapter: (numberOfCells: number, includeNotValidatedByCurrentUser: boolean) => void;
    onStopAutocomplete: () => void;
    isAutocompletingChapter: boolean;
    onSetTextDirection: (direction: "ltr" | "rtl") => void;
    textDirection: "ltr" | "rtl";
    onSetCellDisplayMode: (mode: CELL_DISPLAY_MODES) => void;
    cellDisplayMode: CELL_DISPLAY_MODES;
    isSourceText: boolean;
    totalChapters: number;
    totalCellsToAutocomplete: number;
    totalCellsWithCurrentUserOption: number;
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
}

const ChapterNavigation: React.FC<ChapterNavigationProps> = ({
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
    totalCellsToAutocomplete,
    totalCellsWithCurrentUserOption,
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
}) => {
    const [showConfirm, setShowConfirm] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);

    const handleAutocompleteClick = () => {
        console.log("Autocomplete clicked, showing modal with:", {
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption
        });
        setShowConfirm(true);
    };

    const handleConfirmAutocomplete = (numberOfCells: number, includeNotValidatedByCurrentUser: boolean) => {
        console.log('Confirm autocomplete:', {
            numberOfCells,
            includeNotValidatedByCurrentUser,
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption
        });
        onAutocompleteChapter(numberOfCells, includeNotValidatedByCurrentUser);
        setShowConfirm(false);
    };

    const handleCancelAutocomplete = () => {
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

    // Helper to determine if any translation is in progress (either autocomplete or single cell)
    const isAnyTranslationInProgress = isAutocompletingChapter || isTranslatingCell;
    
    // Common handler for stopping any kind of translation
    const handleStopTranslation = () => {
        if (isAutocompletingChapter) {
            onStopAutocomplete();
        } else if (isTranslatingCell && onStopSingleCellTranslation) {
            onStopSingleCellTranslation();
        }
    };

    const buttonGap = "0.5rem";

    return (
        <div className="chapter-navigation" style={{ gap: buttonGap }}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    flexFlow: "nowrap",
                    flex: 1,
                    justifyContent: "flex-start",
                }}
            >
                {isSourceText ? (
                    <>
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => {
                                toggleScrollSync();
                            }}
                        >
                            <i
                                className={`codicon ${
                                    scrollSyncEnabled ? "codicon-lock" : "codicon-unlock"
                                }`}
                            />
                        </VSCodeButton>
                        Source Text
                    </>
                ) : (
                    <VSCodeButton appearance="icon" onClick={() => openSourceText(chapterNumber)}>
                        <i className="codicon codicon-open-preview"></i>
                    </VSCodeButton>
                )}
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "nowrap",
                    alignItems: "center",
                    flex: 1,
                    justifyContent: "center",
                    flexGrow: 2,
                }}
            >
                <VSCodeButton
                    appearance="icon"
                    disabled={chapterNumber === 1 || unsavedChanges}
                    onClick={() => setChapterNumber(chapterNumber - 1)}
                >
                    <i className="codicon codicon-chevron-left"></i>
                </VSCodeButton>
                <h1
                    style={{
                        fontSize: "1.5rem",
                        marginLeft: "1rem",
                        marginRight: "1rem",
                    }}
                >
                    {(translationUnitsForSection[0]?.cellMarkers?.[0]
                        ?.split(":")[0]
                        .split(" ")[0] || "") +
                        "\u00A0" +
                        (translationUnitsForSection[0]?.cellMarkers?.[0]
                            ?.split(":")[0]
                            .split(" ")[1] || "")}
                </h1>
                <VSCodeButton
                    appearance="icon"
                    disabled={chapterNumber === totalChapters || unsavedChanges}
                    onClick={() => setChapterNumber(chapterNumber + 1)}
                >
                    <i className="codicon codicon-chevron-right"></i>
                </VSCodeButton>
            </div>

            <div className="chapter-navigation-group" style={{ gap: buttonGap }}>
                {!isSourceText && (
                    <>
                        {isAnyTranslationInProgress ? (
                            <VSCodeButton
                                appearance="icon"
                                onClick={handleStopTranslation}
                                title={isAutocompletingChapter ? "Stop Autocomplete" : "Stop Translation"}
                                style={{
                                    backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)',
                                    borderRadius: '4px'
                                }}
                            >
                                <i className="codicon codicon-circle-slash"></i>
                            </VSCodeButton>
                        ) : (
                            <VSCodeButton
                                appearance="icon"
                                onClick={handleAutocompleteClick}
                                disabled={unsavedChanges}
                                title="Autocomplete Chapter"
                            >
                                <i className="codicon codicon-sparkle"></i>
                            </VSCodeButton>
                        )}
                        <AutocompleteModal
                            isOpen={showConfirm}
                            onClose={handleCancelAutocomplete}
                            onConfirm={handleConfirmAutocomplete}
                            totalCellsToAutocomplete={totalCellsToAutocomplete}
                            totalCellsWithCurrentUserOption={totalCellsWithCurrentUserOption}
                        />
                    </>
                )}

                {showAdvancedSettings && (
                    <div className="advanced-settings-container">
                        <VSCodeButton
                            appearance="icon"
                            onClick={() =>
                                onSetTextDirection(textDirection === "ltr" ? "rtl" : "ltr")
                            }
                            disabled={unsavedChanges}
                            title="Set Text Direction"
                        >
                            <i className="codicon codicon-arrow-swap"></i>
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => {
                                const newMode =
                                    cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                        ? CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
                                        : CELL_DISPLAY_MODES.INLINE;
                                onSetCellDisplayMode(newMode);
                                // Send message to update metadata
                                (window as any).vscodeApi.postMessage({
                                    command: "updateCellDisplayMode",
                                    mode: newMode,
                                });
                            }}
                            disabled={unsavedChanges}
                            title="Toggle Cell Display Mode"
                        >
                            {cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? (
                                <i className="codicon codicon-symbol-enum"></i>
                            ) : (
                                <i className="codicon codicon-symbol-constant"></i>
                            )}
                        </VSCodeButton>
                        <div
                            data-force-break-before="this div is simply here to force a break so we don't have widowed buttons"
                            style={{ display: "flex", flexDirection: "row", gap: buttonGap }}
                        >
                            {documentHasVideoAvailable && (
                                <VSCodeButton appearance="icon" onClick={handleToggleVideoPlayer}>
                                    {shouldShowVideoPlayer ? (
                                        <i className="codicon codicon-close"></i>
                                    ) : (
                                        <i className="codicon codicon-device-camera-video"></i>
                                    )}
                                </VSCodeButton>
                            )}
                            {metadata && (
                                <VSCodeButton
                                    appearance="icon"
                                    onClick={handleOpenMetadataModal}
                                    title="Edit Notebook Metadata"
                                >
                                    <i className="codicon codicon-notebook"></i>
                                </VSCodeButton>
                            )}
                        </div>
                    </div>
                )}
                <VSCodeButton
                    appearance={"icon"}
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                >
                    <i
                        className={`codicon ${
                            showAdvancedSettings ? "codicon-close" : "codicon-menu"
                        }`}
                    ></i>
                </VSCodeButton>
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
        </div>
    );
};

export default ChapterNavigation;
