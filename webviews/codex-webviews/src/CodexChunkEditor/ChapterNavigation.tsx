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
            ⬅
        </button>
        <button
            disabled={chapterIndex === scriptureCellsLength - 1 || unsavedChanges}
            style={{ transform: "rotate(180deg)" }}
            onClick={() => setChapterIndex(chapterIndex + 1)}
        >
            ⬅
        </button>
    </div>
);

export default ChapterNavigation;