import React, { useState, useEffect } from "react";
import {
    CellContent,
    CustomNotebookData,
    EditorPostMessages,
    EditorVerseContent,
} from "../../../../types";
import ChapterNavigation from "./ChapterNavigation";
import VerseList from "./VerseList";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";

const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

const CodexCellEditor: React.FC = () => {
    const [translationUnits, setTranslationUnits] = useState<CellContent[]>([]);
    const [spellCheckResponse, setSpellCheckResponse] =
        useState<CustomNotebookData>({} as CustomNotebookData);
    const [contentBeingUpdated, setContentBeingUpdated] =
        useState<EditorVerseContent>({} as EditorVerseContent);
    const [chapterNumber, setChapterNumber] = useState<number>(1);

    useVSCodeMessageHandler(setTranslationUnits, setSpellCheckResponse);

    useEffect(() => {
        vscode.postMessage({ command: "getContent" } as EditorPostMessages);
    }, []);

    const translationUnitsForChapter = translationUnits.filter((verse) => {
        const verseMarker = verse.verseMarkers[0];
        const chapterVerseParts = verseMarker.split(" ")[1].split(":");
        const verseChapterNumber = chapterVerseParts[0];
        return verseChapterNumber === chapterNumber.toString();
    });

    const handleCloseEditor = () =>
        setContentBeingUpdated({} as EditorVerseContent);

    const handleSaveMarkdown = () => {
        vscode.postMessage({
            command: "saveHtml",
            content: contentBeingUpdated,
        } as EditorPostMessages);
        handleCloseEditor();
    };

    return (
        <div className="codex-cell-editor">
            <h1>
                {translationUnitsForChapter[0]?.verseMarkers[0].split(":")[0]}
            </h1>
            <div className="editor-container">
                <ChapterNavigation
                    chapterNumber={chapterNumber}
                    setChapterNumber={setChapterNumber}
                    scriptureCellsLength={
                        translationUnitsForChapter?.length || 0
                    }
                    unsavedChanges={!!contentBeingUpdated.content}
                />
                <VerseList
                    translationUnits={translationUnitsForChapter}
                    contentBeingUpdated={contentBeingUpdated}
                    setContentBeingUpdated={setContentBeingUpdated}
                    spellCheckResponse={spellCheckResponse}
                    handleCloseEditor={handleCloseEditor}
                    handleSaveMarkdown={handleSaveMarkdown}
                    vscode={vscode}
                />
            </div>
        </div>
    );
};

export default CodexCellEditor;
