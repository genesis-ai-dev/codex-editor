import React from "react";

interface ChapterNavigationProps {
    chapterIndex: number;
    setChapterIndex: React.Dispatch<React.SetStateAction<number>>;
    scriptureCellsLength: number;
    unsavedChanges: boolean;
}

const ChapterNavigation: React.FC<ChapterNavigationProps> = ({
    chapterIndex,
    setChapterIndex,
    scriptureCellsLength,
    unsavedChanges,
}) => (
    <div className="chapter-navigation">
        <button
            disabled={chapterIndex === 0 || unsavedChanges}
            onClick={() => setChapterIndex(chapterIndex - 1)}
        >
            <i className="codicon codicon-chevron-left"></i>
        </button>
        <button
            disabled={
                chapterIndex === scriptureCellsLength - 1 || unsavedChanges
            }
            onClick={() => setChapterIndex(chapterIndex + 1)}
        >
            <i className="codicon codicon-chevron-right"></i>
        </button>
    </div>
);

export default ChapterNavigation;
