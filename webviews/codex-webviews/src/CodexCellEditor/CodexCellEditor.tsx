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
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { TextFieldType } from "@vscode/webview-ui-toolkit";

const ModalWithVSCodeUI = ({
    open,
    onClose,
    children,
}: {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}) => {
    if (!open) return null;

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                zIndex: 1000,
            }}
        >
            <div
                style={{
                    backgroundColor: "var(--vscode-editor-background)",
                    padding: "20px",
                    borderRadius: "4px",
                    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.1)",
                }}
            >
                {children}
                <VSCodeButton onClick={onClose} style={{ marginTop: "10px" }}>
                    Close
                </VSCodeButton>
            </div>
        </div>
    );
};

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
    const [metadata, setMetadata] = useState<CustomNotebookMetadata>();
    const [videoUrl, setVideoUrl] = useState<string>("");
    const playerRef = useRef<ReactPlayer>(null);
    const [shouldShowVideoPlayer, setShouldShowVideoPlayer] = useState<boolean>(false);
    const { setSourceCellMap } = useContext(SourceCellContext);
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

    const handleOpenMetadataModal = () => {
        setIsMetadataModalOpen(true);
    };

    const handleCloseMetadataModal = () => {
        setIsMetadataModalOpen(false);
    };

    const handleMetadataChange = (key: string, value: string) => {
        setMetadata((prev: CustomNotebookMetadata | undefined) => {
            if (!prev) {
                return { [key]: value } as unknown as CustomNotebookMetadata;
            }
            return { ...prev, [key]: value };
        });
    };

    const handlePickFile = () => {
        vscode.postMessage({ command: "pickVideoFile" } as EditorPostMessages);
    };

    const handleSaveMetadata = () => {
        vscode.postMessage({
            command: "updateNotebookMetadata",
            content: metadata,
        } as EditorPostMessages);
        handleCloseMetadataModal();
    };

    return (
        <div className="codex-cell-editor" style={{ direction: textDirection }}>
            <h1>{translationUnitsForSection[0]?.cellMarkers?.[0]?.split(":")[0]}</h1>
            <div className="editor-container">
                {shouldShowVideoPlayer && metadata?.videoUrl && (
                    <VideoPlayer
                        playerRef={playerRef}
                        videoUrl={videoUrl}
                        translationUnitsForSection={translationUnitsWithCurrentEditorContent}
                    />
                )}
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
                />
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
                    spellCheckResponse={spellCheckResponse}
                    handleCloseEditor={handleCloseEditor}
                    handleSaveHtml={handleSaveHtml}
                    vscode={vscode}
                    textDirection={textDirection}
                    cellDisplayMode={cellDisplayMode}
                    isSourceText={isSourceText}
                />
            </div>
            <VSCodeButton onClick={handleOpenMetadataModal}>Edit Metadata</VSCodeButton>

            {isMetadataModalOpen && metadata && (
                <ModalWithVSCodeUI open={isMetadataModalOpen} onClose={handleCloseMetadataModal}>
                    <div style={{ padding: "20px" }}>
                        <h2>Edit Notebook Metadata</h2>
                        <form>
                            {Object.entries(metadata).map(([key, value]) => {
                                if (key === "videoUrl") {
                                    return (
                                        <div key={key} style={{ marginBottom: "10px" }}>
                                            <label
                                                style={{ display: "block", marginBottom: "5px" }}
                                            >
                                                {key}:
                                            </label>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    gap: "0.5rem",
                                                    alignItems: "center",
                                                }}
                                            >
                                                <VSCodeTextField
                                                    type="text"
                                                    value={value as string}
                                                    onInput={(e: any) =>
                                                        handleMetadataChange(key, e.target.value)
                                                    }
                                                    placeholder="Enter video URL"
                                                    style={{ flex: 1 }}
                                                />
                                                <VSCodeButton
                                                    onClick={handlePickFile}
                                                    appearance="icon"
                                                    title="Pick Video File"
                                                >
                                                    <i className="codicon codicon-folder"></i>
                                                </VSCodeButton>
                                            </div>
                                        </div>
                                    );
                                }

                                // Determine the type of the value
                                let inputType: string;
                                let isReadOnly = false;
                                let displayValue: string = "";

                                if (typeof value === "number") {
                                    inputType = "number";
                                    displayValue = value.toString();
                                } else if (typeof value === "string") {
                                    inputType = "text";
                                    displayValue = value;
                                } else if (typeof value === "object" && value !== null) {
                                    inputType = "text";
                                    isReadOnly = true;
                                    displayValue = JSON.stringify(value);
                                } else {
                                    // Default to text input for other types
                                    inputType = "text";
                                    displayValue = String(value);
                                }

                                const readOnlyKeywords = [
                                    "path",
                                    "uri",
                                    // "id", // this would have made videoUrl readonly...
                                    "originalName",
                                    "sourceFile",
                                ];

                                const hideFieldKeywords = ["data", "navigation"];

                                // Determine if the field should be read-only
                                if (
                                    readOnlyKeywords.some((keyword) => key.includes(keyword)) ||
                                    key === "id"
                                ) {
                                    isReadOnly = true;
                                }

                                if (hideFieldKeywords.some((keyword) => key.includes(keyword))) {
                                    return null;
                                }

                                return (
                                    <div key={key} style={{ marginBottom: "10px" }}>
                                        <label style={{ display: "block", marginBottom: "5px" }}>
                                            {key}:
                                        </label>
                                        <VSCodeTextField
                                            type={inputType as TextFieldType}
                                            value={displayValue}
                                            onInput={(e: any) =>
                                                !isReadOnly &&
                                                handleMetadataChange(key, e.target.value)
                                            }
                                            placeholder={isReadOnly ? "Read-only" : `Enter ${key}`}
                                            readOnly={isReadOnly}
                                        />
                                    </div>
                                );
                            })}
                        </form>
                        <div style={{ marginTop: "20px" }}>
                            <VSCodeButton onClick={handleSaveMetadata}>Save</VSCodeButton>
                            <VSCodeButton onClick={handleCloseMetadataModal} appearance="secondary">
                                Cancel
                            </VSCodeButton>
                        </div>
                    </div>
                </ModalWithVSCodeUI>
            )}
        </div>
    );
};

export default CodexCellEditor;
