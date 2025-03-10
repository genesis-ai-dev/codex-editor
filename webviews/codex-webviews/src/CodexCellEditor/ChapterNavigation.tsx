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
import { CustomNotebookMetadata, QuillCellContent } from "../../../../types";

interface AutocompleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (numberOfCells: number) => void;
    totalCellsToAutocomplete: number;
    defaultValue?: number;
}

const AutocompleteModal: React.FC<AutocompleteModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    totalCellsToAutocomplete,
    defaultValue = Math.min(5, totalCellsToAutocomplete),
}) => {
    const [numberOfCellsToAutocomplete, setNumberOfCellsToAutocomplete] = useState(defaultValue);
    const [customValue, setCustomValue] = useState(defaultValue);

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
                                const defaultValue = Math.min(5, totalCellsToAutocomplete);
                                setCustomValue(defaultValue);
                                setNumberOfCellsToAutocomplete(defaultValue);
                            } else {
                                setNumberOfCellsToAutocomplete(customValue);
                            }
                        } else if (target.value === totalCellsToAutocomplete.toString()) {
                            setNumberOfCellsToAutocomplete(totalCellsToAutocomplete);
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
                                    : Math.min(customValue, totalCellsToAutocomplete)
                            }
                            onFocus={(e) => {
                                const defaultValue = Math.min(5, totalCellsToAutocomplete);
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
                                    const cappedValue = Math.min(value, totalCellsToAutocomplete);
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
                    <VSCodeRadio value={totalCellsToAutocomplete.toString()}>
                        All ({totalCellsToAutocomplete})
                    </VSCodeRadio>
                </VSCodeRadioGroup>
                <div className="modal-actions">
                    <VSCodeButton
                        onClick={() => onConfirm(numberOfCellsToAutocomplete)}
                        disabled={numberOfCellsToAutocomplete === 0}
                    >
                        Confirm
                    </VSCodeButton>
                    <VSCodeButton onClick={onClose} appearance="secondary">
                        Cancel
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
    translationUnitsForSection: QuillCellContent[];
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
    translationUnitsForSection,
}) => {
    const [showConfirm, setShowConfirm] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);

    const handleAutocompleteClick = () => {
        setShowConfirm(true);
    };

    const handleConfirmAutocomplete = (numberOfCells: number) => {
        onAutocompleteChapter(numberOfCells);
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
                        <VSCodeButton
                            appearance="icon"
                            onClick={handleAutocompleteClick}
                            disabled={unsavedChanges}
                            title="Autocomplete Chapter"
                        >
                            <i className="codicon codicon-sparkle"></i>
                        </VSCodeButton>
                        <AutocompleteModal
                            isOpen={showConfirm}
                            onClose={handleCancelAutocomplete}
                            onConfirm={handleConfirmAutocomplete}
                            totalCellsToAutocomplete={totalCellsToAutocomplete}
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
