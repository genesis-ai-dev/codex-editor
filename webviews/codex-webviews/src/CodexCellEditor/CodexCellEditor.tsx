import React, { useState, useEffect } from "react";
import {
    QuillCellContent,
    CodexNotebookAsJSONData,
    EditorPostMessages,
    EditorVerseContent,
} from "../../../../types";
import ChapterNavigation from "./ChapterNavigation";
import VerseList from "./VerseList";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

export enum CELL_DISPLAY_MODES {
    INLINE = "inline",
    ONE_LINE_PER_CELL = "one-line-per-cell",
}

const CodexCellEditor: React.FC = () => {
    const [translationUnits, setTranslationUnits] = useState<QuillCellContent[]>([]);
    const [spellCheckResponse, setSpellCheckResponse] = useState<CodexNotebookAsJSONData>(
        {} as CodexNotebookAsJSONData
    );
    const [contentBeingUpdated, setContentBeingUpdated] = useState<EditorVerseContent>(
        {} as EditorVerseContent
    );
    const [chapterNumber, setChapterNumber] = useState<number>(1);
    const [autocompletionProgress, setAutocompletionProgress] = useState<number | null>(null);
    const [textDirection, setTextDirection] = useState<"ltr" | "rtl">("ltr");
    const [cellDisplayMode, setCellDisplayMode] = useState<CELL_DISPLAY_MODES>(
        CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
    );

    useVSCodeMessageHandler({
        setContent: setTranslationUnits,
        setSpellCheckResponse,
        jumpToCell: (cellId) => {
            const chapter = cellId?.split(" ")[1]?.split(":")[0];
            setChapterNumber(parseInt(chapter));
        },
        updateCell: (data: { cellId: string; newContent: string; progress: number }) => {
            setTranslationUnits((prevUnits) =>
                prevUnits.map((unit) =>
                    unit.verseMarkers[0] === data.cellId
                        ? { ...unit, verseContent: data.newContent }
                        : unit
                )
            );
            setAutocompletionProgress(data.progress);
        },
        autocompleteChapterComplete: () => {
            setAutocompletionProgress(null);
            vscode.postMessage({ command: "getContent" } as EditorPostMessages);
        },
        updateTextDirection: (direction) => {
            setTextDirection(direction);
        },
    });

    useEffect(() => {
        vscode.postMessage({ command: "getContent" } as EditorPostMessages);
    }, []);

    const translationUnitsForChapter = translationUnits.filter((verse) => {
        const verseMarker = verse?.verseMarkers?.[0];
        const chapterVerseParts = verseMarker?.split(" ")?.[1]?.split(":");
        const verseChapterNumber = chapterVerseParts?.[0];
        return verseChapterNumber === chapterNumber.toString();
    });

    const handleCloseEditor = () => setContentBeingUpdated({} as EditorVerseContent);

    const handleSaveMarkdown = () => {
        vscode.postMessage({
            command: "saveHtml",
            content: contentBeingUpdated,
        } as EditorPostMessages);
        handleCloseEditor();
    };

    const handleAutocompleteChapter = () => {
        console.log("Autocomplete chapter");
        vscode.postMessage({
            command: "requestAutocompleteChapter",
            content: translationUnitsForChapter,
        } as EditorPostMessages);
    };

    return (
        <div className="codex-cell-editor" style={{ direction: textDirection }}>
            <h1>{translationUnitsForChapter[0]?.verseMarkers?.[0]?.split(":")[0]}</h1>
            <div className="editor-container">
                <ChapterNavigation
                    chapterNumber={chapterNumber}
                    setChapterNumber={setChapterNumber}
                    scriptureCellsLength={translationUnitsForChapter?.length || 0}
                    unsavedChanges={!!contentBeingUpdated.content}
                    onAutocompleteChapter={handleAutocompleteChapter}
                    onSetTextDirection={setTextDirection}
                    textDirection={textDirection}
                    onSetCellDisplayMode={setCellDisplayMode}
                    cellDisplayMode={cellDisplayMode}
                />
                {autocompletionProgress !== null && (
                    <div className="autocompletion-progress">
                        <VSCodeProgressRing value={autocompletionProgress * 100} />
                        <span>{Math.round(autocompletionProgress * 100)}% complete</span>
                    </div>
                )}
                <VerseList
                    translationUnits={translationUnitsForChapter}
                    contentBeingUpdated={contentBeingUpdated}
                    setContentBeingUpdated={setContentBeingUpdated}
                    spellCheckResponse={spellCheckResponse}
                    handleCloseEditor={handleCloseEditor}
                    handleSaveMarkdown={handleSaveMarkdown}
                    vscode={vscode}
                    textDirection={textDirection}
                    cellDisplayMode={cellDisplayMode}
                />
            </div>
        </div>
    );
};

export default CodexCellEditor;
