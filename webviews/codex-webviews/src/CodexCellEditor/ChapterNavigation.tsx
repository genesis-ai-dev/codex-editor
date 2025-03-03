import React, { useState } from "react";
import {
    VSCodeBadge,
    VSCodeButton,
    VSCodeRadio,
    VSCodeRadioGroup,
    VSCodeTag,
} from "@vscode/webview-ui-toolkit/react";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import NotebookMetadataModal from "./NotebookMetadataModal";
import { CustomNotebookMetadata } from "../../../../types";

interface ChapterNavigationProps {
    chapterNumber: number;
    setChapterNumber: React.Dispatch<React.SetStateAction<number>>;
    unsavedChanges: boolean;
    onAutocompleteChapter: (numberOfCells: number) => void;
    onSetTextDirection: (direction: "ltr" | "rtl") => void;
    textDirection: "ltr" | "rtl";
    onSetCellDisplayMode: (mode: CELL_DISPLAY_MODES) => void;
    cellDisplayMode: CELL_DISPLAY_MODES;
    isSourceText: boolean;
    totalChapters: number;
    totalCellsToAutocomplete: number;
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
}

const ChapterNavigation: React.FC<ChapterNavigationProps> = ({
    chapterNumber,
    setChapterNumber,
    unsavedChanges,
    onAutocompleteChapter,
    onSetTextDirection,
    textDirection,
    onSetCellDisplayMode,
    cellDisplayMode,
    isSourceText,
    totalChapters,
    totalCellsToAutocomplete,
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
}) => {
    const [showConfirm, setShowConfirm] = useState(false);
    const defaultCustomValue = Math.min(5, totalCellsToAutocomplete);
    const [numberOfCellsToAutocomplete, setNumberOfCellsToAutocomplete] =
        useState(defaultCustomValue);
    const [customValue, setCustomValue] = useState(defaultCustomValue);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);

    const handleAutocompleteClick = () => {
        setShowConfirm(true);
    };

    const handleConfirmAutocomplete = () => {
        onAutocompleteChapter(numberOfCellsToAutocomplete);
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

    return (
        <div className="chapter-navigation">
            <VSCodeButton
                appearance="icon"
                disabled={chapterNumber === 1 || unsavedChanges}
                onClick={() => setChapterNumber(chapterNumber - 1)}
            >
                <i className="codicon codicon-chevron-left"></i>
            </VSCodeButton>
            <div className="chapter-navigation-group">
                {isSourceText && (
                    <>
                        Source Text
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
                    </>
                )}
                {!isSourceText && (
                    <>
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => openSourceText(chapterNumber)}
                        >
                            <i className="codicon codicon-open-preview"></i>
                        </VSCodeButton>
                        {showConfirm ? (
                            <div className="autocomplete-confirm-container">
                                <VSCodeTag>
                                    Autocomplete {numberOfCellsToAutocomplete || 0} Cells
                                </VSCodeTag>
                                <VSCodeRadioGroup
                                    value={
                                        numberOfCellsToAutocomplete === totalCellsToAutocomplete
                                            ? totalCellsToAutocomplete.toString()
                                            : "custom"
                                    }
                                    onChange={(e) => {
                                        const target = e.target as HTMLInputElement;
                                        if (target.value === "custom") {
                                            if (totalCellsToAutocomplete === 0) {
                                                setCustomValue(0);
                                                setNumberOfCellsToAutocomplete(0);
                                            } else if (!customValue) {
                                                const defaultValue = Math.min(
                                                    5,
                                                    totalCellsToAutocomplete
                                                );
                                                setCustomValue(defaultValue);
                                                setNumberOfCellsToAutocomplete(defaultValue);
                                            } else {
                                                setNumberOfCellsToAutocomplete(customValue);
                                            }
                                        } else if (
                                            target.value === totalCellsToAutocomplete.toString()
                                        ) {
                                            setNumberOfCellsToAutocomplete(
                                                totalCellsToAutocomplete
                                            );
                                        }
                                    }}
                                >
                                    <label slot="label">Autocomplete</label>
                                    <VSCodeRadio value="custom">
                                        <input
                                            type="number"
                                            min="1"
                                            max={totalCellsToAutocomplete}
                                            defaultValue={Math.min(5, totalCellsToAutocomplete)}
                                            value={
                                                customValue === 0
                                                    ? "0"
                                                    : Math.min(
                                                          customValue,
                                                          totalCellsToAutocomplete
                                                      )
                                            }
                                            onFocus={(e) => {
                                                const defaultValue = Math.min(
                                                    5,
                                                    totalCellsToAutocomplete
                                                );
                                                if (!customValue) {
                                                    setCustomValue(defaultValue);
                                                }
                                                setNumberOfCellsToAutocomplete(
                                                    customValue || defaultValue
                                                );

                                                // Select the custom radio button
                                                const radioGroup =
                                                    e.currentTarget.closest("vscode-radio-group");
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
                                                    const cappedValue = Math.min(
                                                        value,
                                                        totalCellsToAutocomplete
                                                    );
                                                    setCustomValue(cappedValue);
                                                    setNumberOfCellsToAutocomplete(cappedValue);
                                                }
                                            }}
                                            style={{ width: "60px", marginLeft: "8px" }}
                                        />
                                    </VSCodeRadio>
                                    <VSCodeRadio value={totalCellsToAutocomplete.toString()}>
                                        All ({totalCellsToAutocomplete})
                                    </VSCodeRadio>
                                </VSCodeRadioGroup>
                                <VSCodeButton
                                    appearance="secondary"
                                    onClick={handleConfirmAutocomplete}
                                    disabled={unsavedChanges || numberOfCellsToAutocomplete === 0}
                                >
                                    <i className="codicon codicon-check"></i>
                                </VSCodeButton>
                                <VSCodeButton
                                    appearance="secondary"
                                    onClick={handleCancelAutocomplete}
                                >
                                    <i className="codicon codicon-close"></i>
                                </VSCodeButton>
                            </div>
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
                    </>
                )}
                <VSCodeButton
                    appearance="icon"
                    onClick={() => onSetTextDirection(textDirection === "ltr" ? "rtl" : "ltr")}
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
            <VSCodeButton
                appearance="icon"
                disabled={chapterNumber === totalChapters || unsavedChanges}
                onClick={() => setChapterNumber(chapterNumber + 1)}
            >
                <i className="codicon codicon-chevron-right"></i>
            </VSCodeButton>
        </div>
    );
};

export default ChapterNavigation;
