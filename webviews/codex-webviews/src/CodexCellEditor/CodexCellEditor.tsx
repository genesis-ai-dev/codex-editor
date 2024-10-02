import React, { useState, useEffect, useRef } from "react";
import ReactPlayer from "react-player";
import {
    QuillCellContent,
    EditorPostMessages,
    EditorVerseContent,
    SpellCheckResponse,
} from "../../../../types";
import ChapterNavigation from "./ChapterNavigation";
import VerseList from "./VerseList";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

// eslint-disable-next-line react-refresh/only-export-components
export enum CELL_DISPLAY_MODES {
    INLINE = "inline",
    ONE_LINE_PER_CELL = "one-line-per-cell",
}

const CodexCellEditor: React.FC = () => {
    const [translationUnits, setTranslationUnits] = useState<QuillCellContent[]>([]);
    const [spellCheckResponse, setSpellCheckResponse] = useState<SpellCheckResponse | null>(null);
    const [contentBeingUpdated, setContentBeingUpdated] = useState<EditorVerseContent>(
        {} as EditorVerseContent
    );
    const [chapterNumber, setChapterNumber] = useState<number>(1);
    const [autocompletionProgress, setAutocompletionProgress] = useState<number | null>(null);
    const [textDirection, setTextDirection] = useState<"ltr" | "rtl">("ltr");
    const [cellDisplayMode, setCellDisplayMode] = useState<CELL_DISPLAY_MODES>(
        CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
    );
    const [isSourceText, setIsSourceText] = useState<boolean>(false);
    const [videoUrl, setVideoUrl] = useState<string>("files/videoplayback.mp4");
    const playerRef = useRef<ReactPlayer>(null);
    const [shouldShowVideoPlayer, setShouldShowVideoPlayer] = useState<boolean>(false);
    // const [documentHasVideoAvailable, setDocumentHasVideoAvailable] = useState<boolean>(false);
    console.log("FIXME: setVideoUrl needs a form", setVideoUrl);
    useVSCodeMessageHandler({
        setContent: (content: QuillCellContent[], isSourceText: boolean) => {
            setTranslationUnits(content);
            setIsSourceText(isSourceText);
        },
        setSpellCheckResponse: setSpellCheckResponse,
        jumpToCell: (cellId) => {
            const chapter = cellId?.split(" ")[1]?.split(":")[0];
            setChapterNumber(parseInt(chapter) || 1);
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
        // Set initial isSourceText value from window.initialData
        setIsSourceText((window as any).initialData?.isSourceText || false);
    }, []);

    useEffect(() => {
        // Send the text direction to the extension whenever it changes
        vscode.postMessage({
            command: "updateTextDirection",
            direction: textDirection,
        } as EditorPostMessages);
    }, [textDirection]);

    const calculateTotalChapters = (units: QuillCellContent[]): number => {
        const sectionSet = new Set<string>();
        units.forEach((unit) => {
            const sectionNumber = unit.verseMarkers[0]?.split(" ")?.[1]?.split(":")?.[0];
            if (sectionNumber) {
                sectionSet.add(sectionNumber);
            }
        });
        return sectionSet.size;
    };

    const totalChapters = calculateTotalChapters(translationUnits);

    const translationUnitsForSection = translationUnits.filter((verse) => {
        const cellId = verse?.verseMarkers?.[0];
        const sectionCellIdParts = cellId?.split(" ")?.[1]?.split(":");
        const sectionCellNumber = sectionCellIdParts?.[0];
        return sectionCellNumber === chapterNumber.toString();
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
            content: translationUnitsForSection,
        } as EditorPostMessages);
    };

    const openSourceText = (sectionIdNumber: number) => {
        vscode.postMessage({
            command: "openSourceText",
            content: {
                chapterNumber: sectionIdNumber,
            },
        } as EditorPostMessages);
    };

    useEffect(() => {
        console.log("RYDER", contentBeingUpdated);
        // Jump to the start time of the cell being edited
        if (playerRef.current && contentBeingUpdated.verseMarkers?.length > 0) {
            const cell = translationUnits.find(
                (unit) => unit.verseMarkers[0] === contentBeingUpdated.verseMarkers[0]
            );
            console.log("seekTo args", JSON.stringify(cell), "seconds");
            if (cell?.timestamps?.startTime) {
                playerRef.current.seekTo(parseFloat(cell.timestamps.startTime), "seconds");
            }
        }
    }, [contentBeingUpdated, translationUnits]);

    // Dynamically set styles for .ql-editor
    const styleElement = document.createElement("style");
    styleElement.textContent = `
        .ql-editor {
            direction: ${textDirection} !important;
            text-align: ${textDirection === "rtl" ? "right" : "left"} !important;
        }
    `;
    // FIXME: apply these styles outside of the quill editor to fix
    document.head.appendChild(styleElement);

    return (
        <div className="codex-cell-editor" style={{ direction: textDirection }}>
            <h1>{translationUnitsForSection[0]?.verseMarkers?.[0]?.split(":")[0]}</h1>
            <div className="editor-container">
                {shouldShowVideoPlayer && (
                    <ReactPlayer
                        ref={playerRef}
                        url={videoUrl}
                        controls={true}
                        width="100%"
                        height="auto"
                    />
                )}
                <ChapterNavigation
                    chapterNumber={chapterNumber}
                    setChapterNumber={setChapterNumber}
                    totalChapters={totalChapters}
                    unsavedChanges={!!contentBeingUpdated.content}
                    onAutocompleteChapter={handleAutocompleteChapter}
                    onSetTextDirection={setTextDirection}
                    textDirection={textDirection}
                    onSetCellDisplayMode={setCellDisplayMode}
                    cellDisplayMode={cellDisplayMode}
                    isSourceText={isSourceText}
                    openSourceText={openSourceText}
                    totalCellsToAutocomplete={translationUnitsForSection.length}
                    setShouldShowVideoPlayer={setShouldShowVideoPlayer}
                    shouldShowVideoPlayer={shouldShowVideoPlayer}
                    // documentHasVideoAvailable={documentHasVideoAvailable}
                    documentHasVideoAvailable={true}
                />
                {autocompletionProgress !== null && (
                    <div className="autocompletion-progress">
                        <VSCodeProgressRing value={autocompletionProgress * 100} />
                        <span>{Math.round(autocompletionProgress * 100)}% complete</span>
                    </div>
                )}
                <VerseList
                    translationUnits={translationUnitsForSection}
                    contentBeingUpdated={contentBeingUpdated}
                    setContentBeingUpdated={setContentBeingUpdated}
                    spellCheckResponse={spellCheckResponse}
                    handleCloseEditor={handleCloseEditor}
                    handleSaveMarkdown={handleSaveMarkdown}
                    vscode={vscode}
                    textDirection={textDirection}
                    cellDisplayMode={cellDisplayMode}
                    isSourceText={isSourceText}
                />
            </div>
        </div>
    );
};

export default CodexCellEditor;
