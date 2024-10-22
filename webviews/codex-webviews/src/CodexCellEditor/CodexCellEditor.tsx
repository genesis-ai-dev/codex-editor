import React, { useState, useEffect, useRef, useMemo, useContext } from "react";
import ReactPlayer from "react-player";
import Quill from "quill";
import {
    QuillCellContent,
    EditorPostMessages,
    EditorCellContent,
    SpellCheckResponse,
    CustomNotebookMetadata,
} from "../../../../types";
import ChapterNavigation from "./ChapterNavigation";
import CellList from "./CellList";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import VideoPlayer from "./VideoPlayer";
import registerQuillSpellChecker from "./react-quill-spellcheck";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import SourceCellContext from "./contextProviders/SourceCellContext";
import DuplicateCellResolver from "./DuplicateCellResolver";
import TimelineEditor from "./TimelineEditor";

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
    const [contentBeingUpdated, setContentBeingUpdated] = useState<EditorCellContent>(
        {} as EditorCellContent
    );
    const [chapterNumber, setChapterNumber] = useState<number>(1);
    const [autocompletionProgress, setAutocompletionProgress] = useState<number | null>(null);
    const [textDirection, setTextDirection] = useState<"ltr" | "rtl">("ltr");
    const [cellDisplayMode, setCellDisplayMode] = useState<CELL_DISPLAY_MODES>(
        CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
    );
    const [isSourceText, setIsSourceText] = useState<boolean>(false);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false);
    console.log({ isMetadataModalOpen });
    const [metadata, setMetadata] = useState<CustomNotebookMetadata>({
        videoUrl: "", // FIXME: use attachments instead of videoUrl
    } as CustomNotebookMetadata);
    const [videoUrl, setVideoUrl] = useState<string>("");
    const playerRef = useRef<ReactPlayer>(null);
    const [shouldShowVideoPlayer, setShouldShowVideoPlayer] = useState<boolean>(false);
    const { setSourceCellMap } = useContext(SourceCellContext);
    // A "temp" video URL that is used to update the video URL in the metadata modal.
    // We need to use the client-side file picker, so we need to then pass the picked
    // video URL back to the extension so the user can save or cancel the change.
    const [tempVideoUrl, setTempVideoUrl] = useState<string>("");
    // const [documentHasVideoAvailable, setDocumentHasVideoAvailable] = useState<boolean>(false);
    useVSCodeMessageHandler({
        setContent: (
            content: QuillCellContent[],
            isSourceText: boolean,
            sourceCellMap: { [k: string]: { content: string; versions: string[] } }
        ) => {
            // const sourceCellMapObject = Object.fromEntries(sourceCellMap);
            console.log("sourceCellMap in CodexCellEditor", { sourceCellMap });
            setTranslationUnits(content);
            setIsSourceText(isSourceText);
            setSourceCellMap(sourceCellMap);
        },
        setSpellCheckResponse: setSpellCheckResponse,
        jumpToCell: (cellId) => {
            const chapter = cellId?.split(" ")[1]?.split(":")[0];
            setChapterNumber(parseInt(chapter) || 1);
        },
        updateCell: (data: {
            cellId: string;
            newContent: string;
            progress: number;
            cellLabel?: string;
        }) => {
            setTranslationUnits((prevUnits) =>
                prevUnits.map((unit) =>
                    unit.cellMarkers[0] === data.cellId
                        ? {
                              ...unit,
                              cellContent: data.newContent,
                              cellLabel: data.cellLabel || unit.cellLabel,
                          }
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
        updateNotebookMetadata: (newMetadata) => {
            setMetadata(newMetadata);
        },
        updateVideoUrl: (url: string) => {
            setTempVideoUrl(url);
        },
    });

    useEffect(() => {
        vscode.postMessage({ command: "getContent" } as EditorPostMessages);
        setIsSourceText((window as any).initialData?.isSourceText || false);
        setVideoUrl((window as any).initialData?.videoUrl || "");
        setMetadata((window as any).initialData?.metadata || {});
    }, []);

    useEffect(() => {
        // Send the text direction to the extension whenever it changes
        vscode.postMessage({
            command: "updateTextDirection",
            direction: textDirection,
        } as EditorPostMessages);
    }, [textDirection]);

    useEffect(() => {
        // Initialize Quill and register SpellChecker and SmartEdits only once
        registerQuillSpellChecker(Quill as any, vscode);
    }, []);

    const calculateTotalChapters = (units: QuillCellContent[]): number => {
        const sectionSet = new Set<string>();
        units.forEach((unit) => {
            const sectionNumber = unit.cellMarkers[0]?.split(" ")?.[1]?.split(":")?.[0];
            if (sectionNumber) {
                sectionSet.add(sectionNumber);
            }
        });
        return sectionSet.size;
    };

    const totalChapters = calculateTotalChapters(translationUnits);

    const translationUnitsForSection = translationUnits.filter((verse) => {
        const cellId = verse?.cellMarkers?.[0];
        const sectionCellIdParts = cellId?.split(" ")?.[1]?.split(":");
        const sectionCellNumber = sectionCellIdParts?.[0];
        return sectionCellNumber === chapterNumber.toString();
    });

    const { setUnsavedChanges } = useContext(UnsavedChangesContext);

    const handleCloseEditor = () => {
        setContentBeingUpdated({} as EditorCellContent);
        setUnsavedChanges(false);
    };

    const handleSaveHtml = () => {
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
        // Jump to the start time of the cell being edited
        if (playerRef.current && contentBeingUpdated.cellMarkers?.length > 0) {
            const cellId = contentBeingUpdated.cellMarkers[0];
            const startTime = parseTimestampFromCellId(cellId);
            if (startTime !== null) {
                console.log(`Seeking to ${startTime} + ${OFFSET_SECONDS} seconds`);
                playerRef.current.seekTo(startTime + OFFSET_SECONDS, "seconds");
            }
        }
    }, [contentBeingUpdated, OFFSET_SECONDS]);

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

    const translationUnitsWithCurrentEditorContent = useMemo(() => {
        return translationUnitsForSection?.map((unit) => {
            if (unit.cellMarkers[0] === contentBeingUpdated.cellMarkers?.[0]) {
                return { ...unit, cellContent: contentBeingUpdated.cellContent };
            }
            return unit;
        });
    }, [contentBeingUpdated, translationUnitsForSection]);

    // const handleCloseMetadataModal = () => {
    //     setTempVideoUrl(""); // Reset temp video URL when closing without saving
    //     setIsMetadataModalOpen(false);
    // };

    const handleMetadataChange = (key: string, value: string) => {
        setMetadata((prev) => {
            const updatedMetadata = { ...prev, [key]: value };
            console.log("Updated metadata:", updatedMetadata);
            return updatedMetadata;
        });
    };

    const handlePickFile = () => {
        vscode.postMessage({ command: "pickVideoFile" } as EditorPostMessages);
    };

    const handleSaveMetadata = () => {
        const updatedMetadata = { ...metadata };
        if (tempVideoUrl) {
            updatedMetadata.videoUrl = tempVideoUrl;
            setVideoUrl(tempVideoUrl);
            setTempVideoUrl("");
        }
        console.log("Saving metadata:", updatedMetadata);
        vscode.postMessage({
            command: "updateNotebookMetadata",
            content: updatedMetadata,
        } as EditorPostMessages);
        setIsMetadataModalOpen(false);
    };

    const handleUpdateVideoUrl = (url: string) => {
        setVideoUrl(url);
    };

    const [headerHeight, setHeaderHeight] = useState(0);
    const [windowHeight, setWindowHeight] = useState(window.innerHeight);
    const headerRef = useRef<HTMLDivElement>(null);
    const navigationRef = useRef<HTMLDivElement>(null);
    const videoPlayerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleResize = () => {
            setWindowHeight(window.innerHeight);
            if (headerRef.current && navigationRef.current && videoPlayerRef.current) {
                const totalHeaderHeight =
                    headerRef.current.offsetHeight +
                    navigationRef.current.offsetHeight +
                    (shouldShowVideoPlayer ? videoPlayerRef.current.offsetHeight : 0);
                setHeaderHeight(totalHeaderHeight);
            }
        };

        window.addEventListener("resize", handleResize);
        handleResize(); // Initial calculation

        return () => window.removeEventListener("resize", handleResize);
    }, [shouldShowVideoPlayer]); // Add shouldShowVideoPlayer as a dependency

    const checkForDuplicateCells = (translationUnitsToCheck: QuillCellContent[]) => {
        const listOfCellIds = translationUnitsToCheck.map((unit) => unit.cellMarkers[0]);
        const uniqueCellIds = new Set(listOfCellIds);
        return uniqueCellIds.size !== listOfCellIds.length;
    };

    const duplicateCellsExist = checkForDuplicateCells(translationUnits);

    if (duplicateCellsExist) {
        return (
            <DuplicateCellResolver
                translationUnits={translationUnits}
                textDirection={textDirection}
                vscode={vscode}
            />
        );
    }

    // const data = [{ begin: 25, end: 35, text: "This is subtitle" }];
    const removeHtmlTags = (text: string) => {
        return text.replace(/<[^>]*>?/g, "").replace(/\n/g, " ");
    };
    const data: {
        begin: number;
        end: number;
        text: string;
        id: string;
    }[] = translationUnitsForSection.map((unit) => {
        return {
            begin: unit.timestamps?.startTime || 0,
            end: unit.timestamps?.endTime || 0,
            text: removeHtmlTags(unit.cellContent),
            id: unit.cellMarkers[0],
        };
    });
    return (
        <div className="codex-cell-editor">
            <div className="static-header" ref={headerRef}>
                <div ref={navigationRef}>
                    <ChapterNavigation
                        chapterNumber={chapterNumber}
                        setChapterNumber={setChapterNumber}
                        totalChapters={totalChapters}
                        unsavedChanges={!!contentBeingUpdated.cellContent}
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
                        documentHasVideoAvailable={true}
                        metadata={metadata}
                        tempVideoUrl={tempVideoUrl}
                        onMetadataChange={handleMetadataChange}
                        onSaveMetadata={handleSaveMetadata}
                        onPickFile={handlePickFile}
                        onUpdateVideoUrl={handleUpdateVideoUrl}
                    />
                </div>
                {shouldShowVideoPlayer && videoUrl && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                        }}
                        ref={videoPlayerRef}
                    >
                        <VideoPlayer
                            playerRef={playerRef}
                            videoUrl={videoUrl}
                            translationUnitsForSection={translationUnitsWithCurrentEditorContent}
                        />
                        <TimelineEditor data={data} vscode={vscode} />
                    </div>
                )}
            </div>
            <div
                className="scrollable-content"
                style={{ height: `calc(100vh - ${headerHeight}px)` }}
            >
                <h1>{translationUnitsForSection[0]?.cellMarkers?.[0]?.split(":")[0]}</h1>
                <div className="editor-container">
                    {autocompletionProgress !== null && (
                        <div className="autocompletion-progress">
                            <VSCodeProgressRing value={autocompletionProgress * 100} />
                            <span>{Math.round(autocompletionProgress * 100)}% complete</span>
                        </div>
                    )}
                    <CellList
                        translationUnits={translationUnitsForSection}
                        contentBeingUpdated={contentBeingUpdated}
                        setContentBeingUpdated={setContentBeingUpdated}
                        handleCloseEditor={handleCloseEditor}
                        handleSaveHtml={handleSaveHtml}
                        vscode={vscode}
                        textDirection={textDirection}
                        cellDisplayMode={cellDisplayMode}
                        isSourceText={isSourceText}
                        windowHeight={windowHeight}
                        headerHeight={headerHeight}
                        spellCheckFunction={(cellContent: string) => {
                            return new Promise<SpellCheckResponse | null>((resolve) => {
                                vscode.postMessage({
                                    command: "from-quill-spellcheck-getSpellCheckResponse",
                                    content: {
                                        cellContent,
                                        cellChanged: true,
                                    },
                                });
                                const handleSpellCheckResponse = (event: MessageEvent) => {
                                    if (event.data.type === "providerSendsSpellCheckResponse") {
                                        window.removeEventListener(
                                            "message",
                                            handleSpellCheckResponse
                                        );
                                        resolve(event.data.content as SpellCheckResponse);
                                    }
                                };
                                window.addEventListener("message", handleSpellCheckResponse);
                            });
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default CodexCellEditor;
