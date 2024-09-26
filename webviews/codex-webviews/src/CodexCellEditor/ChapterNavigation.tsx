import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface ChapterNavigationProps {
    chapterNumber: number;
    setChapterNumber: React.Dispatch<React.SetStateAction<number>>;
    scriptureCellsLength: number;
    unsavedChanges: boolean;
    onAutocompleteChapter: () => void;
}

const ChapterNavigation: React.FC<ChapterNavigationProps> = ({
    chapterNumber,
    setChapterNumber,
    scriptureCellsLength,
    unsavedChanges,
    onAutocompleteChapter,
}) => (
    <div className="chapter-navigation">
        <VSCodeButton
            appearance="icon"
            disabled={chapterNumber === 0 || unsavedChanges}
            onClick={() => setChapterNumber(chapterNumber - 1)}
        >
            <i className="codicon codicon-chevron-left"></i>
        </VSCodeButton>
        <div className="chapter-navigation-group">
            <VSCodeButton
                appearance="icon"
                onClick={onAutocompleteChapter}
                disabled={unsavedChanges}
                title="Autocomplete Chapter"
            >
                <i className="codicon codicon-sparkle"></i>
            </VSCodeButton>
        </div>
        <VSCodeButton
            appearance="icon"
            disabled={chapterNumber === scriptureCellsLength - 1 || unsavedChanges}
            onClick={() => setChapterNumber(chapterNumber + 1)}
        >
            <i className="codicon codicon-chevron-right"></i>
        </VSCodeButton>
    </div>
);

export default ChapterNavigation;
