import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
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
}) => (
    <div className="chapter-navigation">
        <VSCodeButton
            appearance="icon"
            disabled={chapterNumber === 1 || unsavedChanges}
            onClick={() => setChapterNumber(chapterNumber - 1)}
        >
            <i className="codicon codicon-chevron-left"></i>
        </VSCodeButton>
        <div className="chapter-navigation-group">
            {!isSourceText && (
                <VSCodeButton
                    appearance="icon"
                    onClick={onAutocompleteChapter}
                    disabled={unsavedChanges}
                    title="Autocomplete Chapter"
                >
                    <i className="codicon codicon-sparkle"></i>
                </VSCodeButton>
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

export default ChapterNavigation;
