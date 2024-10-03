import React, { useState, useEffect, useRef, useMemo } from "react";
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
    const [videoUrl, setVideoUrl] = useState<string>((window as any).initialData?.videoUrl || "");

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
        setIsSourceText((window as any).initialData?.isSourceText || false);
        setVideoUrl((window as any).initialData?.videoUrl || "");
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

    const OFFSET_SECONDS = 0; // just for testing purposes

    useEffect(() => {
        console.log("RYDER", contentBeingUpdated);
        // Jump to the start time of the cell being edited
        if (playerRef.current && contentBeingUpdated.verseMarkers?.length > 0) {
            const cellId = contentBeingUpdated.verseMarkers[0];
            const startTime = parseTimestampFromCellId(cellId);
            if (startTime !== null) {
                console.log(`Seeking to ${startTime} + ${OFFSET_SECONDS} seconds`);
                playerRef.current.seekTo(startTime + OFFSET_SECONDS, "seconds");
            }
        }
    }, [contentBeingUpdated]);

    // Helper function to parse timestamp from cellId
    const parseTimestampFromCellId = (cellId: string): number | null => {
        const match = cellId.match(/cue-(\d+(?:\.\d+)?)-/);
        if (match && match[1]) {
            return parseFloat(match[1]);
        }
        return null;
    };

    // Dynamically set styles for .ql-editor
    const styleElement = document.createElement("style");
    styleElement.textContent = `
        .ql-editor {
            direction: ${textDirection} !important;
            text-align: ${textDirection === "rtl" ? "right" : "left"} !important;
        }
    `;
    document.head.appendChild(styleElement);

    const subtitleData = useMemo(() => {
        if (!translationUnits.length) return "";

        const formatTime = (seconds: number): string => {
            const date = new Date(seconds * 1000);
            return date.toISOString().substr(11, 12);
        };

        const cues = translationUnits
            .map((unit, index) => {
                console.log("unit", unit);
                const startTime = unit.timestamps?.startTime ?? index;
                const endTime = unit.timestamps?.endTime ?? index + 1;
                return `${unit.verseMarkers[0]}
${formatTime(Number(startTime))} --> ${formatTime(Number(endTime))}
${unit.verseContent}

`;
            })
            .join("\n");

        return `WEBVTT

${cues}`;
    }, [translationUnits]);

    const subtitleBlob = useMemo(
        () => new Blob([subtitleData], { type: "text/vtt" }),
        [subtitleData]
    );
    const subtitleUrl = useMemo(() => URL.createObjectURL(subtitleBlob), [subtitleBlob]);

    return (
        <div className="codex-cell-editor" style={{ direction: textDirection }}>
            <h1>{translationUnitsForSection[0]?.verseMarkers?.[0]?.split(":")[0]}</h1>
            <div className="editor-container">
                {shouldShowVideoPlayer && (
                    <div className="player-wrapper">
                        <ReactPlayer
                            ref={playerRef}
                            url={videoUrl}
                            controls={true}
                            width="100%"
                            height="auto"
                            config={{
                                file: {
                                    tracks: [
                                        {
                                            kind: "subtitles",
                                            src: subtitleUrl,
                                            srcLang: "en", // FIXME: make this dynamic
                                            label: "English", // FIXME: make this dynamic
                                            default: true,
                                        },
                                    ],
                                },
                            }}
                        />
                    </div>
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
