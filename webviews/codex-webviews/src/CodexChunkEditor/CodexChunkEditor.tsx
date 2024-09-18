import React, { useState, useEffect } from "react";
import {
    CustomNotebookData,
    EditorPostMessages,
    EditorVerseContent,
} from "../../../../types";
import ChapterNavigation from "./ChapterNavigation";
import VerseList from "./VerseList";
import { processVerseContent } from "./utils";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";

const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

const CodexChunkEditor: React.FC = () => {
    const [content, setContent] = useState<CustomNotebookData>(
        {} as CustomNotebookData,
    );
    const [spellCheckResponse, setSpellCheckResponse] =
        useState<CustomNotebookData>({} as CustomNotebookData);
    const [contentBeingUpdated, setContentBeingUpdated] =
        useState<EditorVerseContent>({} as EditorVerseContent);
    const [chapterIndex, setChapterIndex] = useState<number>(0);

    useVSCodeMessageHandler(setContent, setSpellCheckResponse);

    useEffect(() => {
        vscode.postMessage({ command: "getContent" } as EditorPostMessages);
    }, []);

    const scriptureCells = content?.cells?.filter(
        (cell) => cell.language === "scripture",
    );
    const translationUnits =
        scriptureCells?.length > 0
            ? processVerseContent(scriptureCells[chapterIndex].value).filter(
                  Boolean,
              )
            : [];

    const handleCloseEditor = () =>
        setContentBeingUpdated({} as EditorVerseContent);

    const handleSaveMarkdown = () => {
        vscode.postMessage({
            command: "saveHtml",
            content: contentBeingUpdated,
        } as EditorPostMessages);
        handleCloseEditor();
    };

    const translationUnitsWithMergedRanges: {
        verseMarkers: string[];
        verseContent: string;
    }[] = [];

    translationUnits?.forEach((verse, index) => {
        let forwardIndex = 1;
        const rangeMarker = "<range>";
        if (verse.verseContent?.trim() === rangeMarker) {
            return;
        }
        const verseMarkers = [...verse.verseMarkers];
        let nextVerse = translationUnits[index + forwardIndex];

        while (nextVerse?.verseContent?.trim() === rangeMarker) {
            verseMarkers.push(...nextVerse.verseMarkers);
            forwardIndex++;
            nextVerse = translationUnits[index + forwardIndex];
        }
        const verseContent = verse.verseContent;

        translationUnitsWithMergedRanges.push({
            verseMarkers,
            verseContent: verseContent,
        });
    });

    return (
        <div className="codex-chunk-editor">
            <h1>{translationUnits[0]?.verseMarkers[0].split(":")[0]}</h1>
            <div className="editor-container">
                <ChapterNavigation
                    chapterIndex={chapterIndex}
                    setChapterIndex={setChapterIndex}
                    scriptureCellsLength={scriptureCells?.length || 0}
                    unsavedChanges={!!contentBeingUpdated.content}
                />
                <VerseList
                    translationUnits={translationUnitsWithMergedRanges}
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

export default CodexChunkEditor;
