import React from "react";

interface ChapterNavigationProps {
    chapterNumber: number;
    setChapterNumber: React.Dispatch<React.SetStateAction<number>>;
    scriptureCellsLength: number;
    unsavedChanges: boolean;
}

const ChapterNavigation: React.FC<ChapterNavigationProps> = ({
    chapterNumber,
    setChapterNumber,
    scriptureCellsLength,
    unsavedChanges,
}) => (
    <div className="chapter-navigation">
        <button
            disabled={chapterNumber === 0 || unsavedChanges}
            onClick={() => setChapterNumber(chapterNumber - 1)}
        >
            <i className="codicon codicon-chevron-left"></i>
        </button>
        <button
            disabled={chapterNumber === scriptureCellsLength - 1 || unsavedChanges}
            onClick={() => setChapterNumber(chapterNumber + 1)}
        >
            <i className="codicon codicon-chevron-right"></i>
        </button>
    </div>
);

export default ChapterNavigation;
