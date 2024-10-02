import React, { useState } from "react";
import {
    VSCodeBadge,
    VSCodeButton,
    VSCodeRadio,
    VSCodeRadioGroup,
    VSCodeTag,
} from "@vscode/webview-ui-toolkit/react";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";

interface ChapterNavigationProps {
    chapterNumber: number;
    setChapterNumber: React.Dispatch<React.SetStateAction<number>>;
    unsavedChanges: boolean;
    onAutocompleteChapter: () => void;
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
}) => {
    const [showConfirm, setShowConfirm] = useState(false);
    const [numberOfCellsToAutocomplete, setNumberOfCellsToAutocomplete] = useState(5);
    // FIXME: this isn't actually limiting the number of calls to the llm completion; that happens at the provider level

    const handleAutocompleteClick = () => {
        setShowConfirm(true);
    };

    const handleConfirmAutocomplete = () => {
        onAutocompleteChapter();
        setShowConfirm(false);
    };

    const handleCancelAutocomplete = () => {
        setShowConfirm(false);
    };

    const handleToggleVideoPlayer = () => {
        setShouldShowVideoPlayer(!shouldShowVideoPlayer);
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
                        <VSCodeButton appearance="secondary" disabled>
                            Source Text
                        </VSCodeButton>
                        <VSCodeButton appearance="icon" disabled>
                            <i className="codicon codicon-lock" />
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
                                <VSCodeTag>Autocomplete {numberOfCellsToAutocomplete}</VSCodeTag>
                                <VSCodeRadioGroup
                                    value={numberOfCellsToAutocomplete.toString()}
                                    onChange={(e) => {
                                        const target = e.target as HTMLInputElement;
                                        setNumberOfCellsToAutocomplete(parseInt(target.value));
                                    }}
                                >
                                    <label slot="label">Autocomplete</label>
                                    <VSCodeRadio value="5">5</VSCodeRadio>
                                    <VSCodeRadio value={totalCellsToAutocomplete.toString()}>
                                        All ({totalCellsToAutocomplete})
                                    </VSCodeRadio>
                                </VSCodeRadioGroup>
                                <VSCodeButton
                                    appearance="secondary"
                                    onClick={handleConfirmAutocomplete}
                                    disabled={unsavedChanges}
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
                        <VSCodeButton
                            appearance="icon"
                            onClick={handleAutocompleteClick}
                            disabled={unsavedChanges}
                            title="Copilot Smart Edit Suggestions"
                        >
                            <i className="codicon codicon-copilot"></i>
                        </VSCodeButton>
                        <VSCodeBadge>23</VSCodeBadge>
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
                    onClick={() =>
                        onSetCellDisplayMode(
                            cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                ? CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
                                : CELL_DISPLAY_MODES.INLINE
                        )
                    }
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
                    <VSCodeButton
                        appearance="icon"
                        onClick={handleToggleVideoPlayer}
                    >
                        <i className="codicon codicon-close"></i>
                    </VSCodeButton>
                )}
            </div>
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
