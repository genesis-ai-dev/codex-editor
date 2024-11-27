import React, { useContext, useEffect, useRef, useState, useCallback } from "react";
import {
    EditorCellContent,
    EditorPostMessages,
    SpellCheckResponse,
    Timestamps,
} from "../../../../types";
import Editor from "./Editor";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
import { getCleanedHtml } from "./react-quill-spellcheck";
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { CodexCellTypes } from "../../../../types/enums";
import SourceCellContext from "./contextProviders/SourceCellContext";
import ConfirmationButton from "./ConfirmationButton";
import { generateChildCellId } from "../../../../src/providers/codexCellEditorProvider/utils/cellUtils";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { AddParatextButton } from "./AddParatextButton";
import ReactMarkdown from "react-markdown";

import "./TextCellEditorStyles.css";

interface SimilarCell {
    cellId: string;
    score: number;
}

interface CellEditorProps {
    cellMarkers: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    spellCheckResponse: SpellCheckResponse | null;
    contentBeingUpdated: EditorCellContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    handleCloseEditor: () => void;
    handleSaveHtml: () => void;
    textDirection: "ltr" | "rtl";
    cellLabel?: string;
    cellTimestamps: Timestamps | undefined;
    cellIsChild: boolean;
    openCellById: (cellId: string, text: string) => void;
}

const CellEditor: React.FC<CellEditorProps> = ({
    cellMarkers,
    cellContent,
    cellIndex,
    cellType,
    spellCheckResponse,
    contentBeingUpdated,
    setContentBeingUpdated,
    handleCloseEditor,
    handleSaveHtml,
    textDirection,
    cellLabel,
    cellTimestamps,
    cellIsChild,
    openCellById,
}) => {
    const { setUnsavedChanges, showFlashingBorder, unsavedChanges } =
        useContext(UnsavedChangesContext);
    const { contentToScrollTo } = useContext(ScrollToContentContext);
    const { sourceCellMap } = useContext(SourceCellContext);
    const cellEditorRef = useRef<HTMLDivElement>(null);
    const sourceCellContent = sourceCellMap?.[cellMarkers[0]];
    const [editorContent, setEditorContent] = useState(cellContent);
    const [sourceText, setSourceText] = useState<string | null>(null);
    const [backtranslation, setBacktranslation] = useState<string | null>(null);
    const [isEditingBacktranslation, setIsEditingBacktranslation] = useState(false);
    const [editedBacktranslation, setEditedBacktranslation] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"source" | "backtranslation">("source");

    const unsavedChangesState = !!(
        contentBeingUpdated.cellContent &&
        getCleanedHtml(contentBeingUpdated.cellContent) &&
        getCleanedHtml(contentBeingUpdated.cellContent).replace(/\s/g, "") !==
            cellContent.replace(/\s/g, "")
    );

    useEffect(() => {
        setUnsavedChanges(unsavedChangesState);
    }, [unsavedChangesState, setUnsavedChanges]);

    useEffect(() => {
        if (showFlashingBorder && cellEditorRef.current) {
            cellEditorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [showFlashingBorder]);

    useEffect(() => {
        if (
            contentToScrollTo &&
            contentToScrollTo === cellMarkers[0] &&
            cellEditorRef.current &&
            !setUnsavedChanges
        ) {
            cellEditorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [contentToScrollTo]);

    const [editableLabel, setEditableLabel] = useState(cellLabel || "");
    const [similarCells, setSimilarCells] = useState<SimilarCell[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [activeSearchPosition, setActiveSearchPosition] = useState<number | null>(null);
    const [isEditorControlsExpanded, setIsEditorControlsExpanded] = useState(false);
    const [isPinned, setIsPinned] = useState(false);

    useEffect(() => {
        setEditableLabel(cellLabel || "");
    }, [cellLabel]);

    const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditableLabel(e.target.value);
    };

    const handleLabelBlur = () => {
        // Update the cell label in the notebook data
        const messageContent: EditorPostMessages = {
            command: "updateCellLabel",
            content: {
                cellId: cellMarkers[0],
                cellLabel: editableLabel,
            },
        };
        window.vscodeApi.postMessage(messageContent);

        // Update local state
        setContentBeingUpdated((prev) => ({
            ...prev,
            cellLabel: editableLabel,
        }));
    };

    const handleLabelSave = () => {
        handleLabelBlur();
    };

    useEffect(() => {
        const handleSimilarCellsResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsSimilarCellIdsResponse") {
                setSimilarCells(message.content);
            }
        };

        window.addEventListener("message", handleSimilarCellsResponse);
        return () => window.removeEventListener("message", handleSimilarCellsResponse);
    }, []);

    const makeChild = () => {
        const parentCellId = cellMarkers[0];
        const newChildId = generateChildCellId(parentCellId);

        const startTime = cellTimestamps?.startTime;
        const endTime = cellTimestamps?.endTime;
        let childStartTime;

        if (startTime && endTime) {
            const deltaTime = endTime - startTime;
            childStartTime = startTime + deltaTime / 2;

            const messageContentToUpdateParentTimeStamps: EditorPostMessages = {
                command: "updateCellTimestamps",
                content: {
                    cellId: cellMarkers[0],
                    timestamps: {
                        startTime: startTime,
                        endTime: childStartTime - 0.001,
                    },
                },
            };
            window.vscodeApi.postMessage(messageContentToUpdateParentTimeStamps);
        }

        const messageContent: EditorPostMessages = {
            command: "makeChildOfCell",
            content: {
                newCellId: newChildId,
                referenceCellId: parentCellId,
                direction: "below",
                cellType: cellType,
                data: {
                    startTime: childStartTime,
                    endTime: endTime,
                },
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    const addParatextCell = (addDirection: "above" | "below") => {
        const parentCellId = cellMarkers[0];

        const newChildId = `${parentCellId}:paratext-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`;

        const startTime = cellTimestamps?.startTime;
        const endTime = cellTimestamps?.endTime;
        let childStartTime;

        if (startTime && endTime) {
            const deltaTime = endTime - startTime;
            childStartTime = startTime + deltaTime / 2;

            const messageContentToUpdateParentTimeStamps: EditorPostMessages = {
                command: "updateCellTimestamps",
                content: {
                    cellId: parentCellId,
                    timestamps: {
                        startTime: startTime,
                        endTime: childStartTime - 0.001,
                    },
                },
            };
            window.vscodeApi.postMessage(messageContentToUpdateParentTimeStamps);
        }
        const messageContent: EditorPostMessages = {
            command: "makeChildOfCell",
            content: {
                newCellId: newChildId,
                referenceCellId: parentCellId,
                direction: addDirection,
                cellType: CodexCellTypes.PARATEXT,
                data: {
                    startTime: childStartTime,
                    endTime: endTime,
                },
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    const deleteCell = () => {
        const messageContent: EditorPostMessages = {
            command: "deleteCell",
            content: {
                cellId: cellMarkers[0],
            },
        };
        window.vscodeApi.postMessage(messageContent);
        handleCloseEditor();
    };
    const cellHasContent =
        getCleanedHtml(contentBeingUpdated.cellContent).replace(/\s/g, "") !== "";

    const handleContentUpdate = (newContent: string) => {
        setContentBeingUpdated((prev) => ({
            ...prev,
            cellContent: newContent,
        }));
        setEditorContent(newContent);
    };

    // Add a ref to store the latest sourceText
    const sourceTextRef = useRef<string | null>(null);

    // Update the ref whenever sourceText changes
    useEffect(() => {
        sourceTextRef.current = sourceText;
        console.log("sourceText updated:", sourceText); // New log
    }, [sourceText]);

    // Modify the existing useEffect for fetching source text
    useEffect(() => {
        const fetchSourceText = () => {
            console.log("Fetching source text for cell:", cellMarkers[0]);
            const messageContent: EditorPostMessages = {
                command: "getSourceText",
                content: {
                    cellId: cellMarkers[0],
                },
            };
            window.vscodeApi.postMessage(messageContent);
        };

        fetchSourceText();
        const intervalId = setInterval(fetchSourceText, 5000);

        return () => clearInterval(intervalId);
    }, [cellMarkers]);

    // Modify the existing useEffect for handling source text response
    useEffect(() => {
        const handleSourceTextResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsSourceText") {
                console.log(
                    "Received source text for cell:",
                    cellMarkers[0],
                    "Content:",
                    message.content
                );
                setSourceText(message.content);
                sourceTextRef.current = message.content; // Update ref immediately
            }
        };

        window.addEventListener("message", handleSourceTextResponse);
        return () => window.removeEventListener("message", handleSourceTextResponse);
    }, [cellMarkers]);

    // Modify the handleAutocomplete function
    const handleAutocomplete = useCallback(() => {
        console.log("Autocomplete clicked for cell:", cellMarkers[0]);
        console.log("sourceText from state:", sourceText);
        console.log("sourceText from ref:", sourceTextRef.current);

        const textToUse = sourceTextRef.current || sourceText;

        if (textToUse) {
            window.vscodeApi.postMessage({
                command: "requestTranslation",
                content: {
                    cellId: cellMarkers[0],
                    sourceText: textToUse,
                },
            });
        } else {
            console.error("Source text is null or undefined for cell:", cellMarkers[0]);
            // Optionally, you could show an error message to the user here
        }
    }, [cellMarkers, sourceText]); // Keep sourceText in dependencies for consistency

    useEffect(() => {
        const handleBacktranslationResponse = (event: MessageEvent) => {
            const message = event.data;
            if (
                message.type === "providerSendsBacktranslation" ||
                message.type === "providerSendsExistingBacktranslation" ||
                message.type === "providerSendsUpdatedBacktranslation" ||
                message.type === "providerConfirmsBacktranslationSet"
            ) {
                setBacktranslation(message.content?.backtranslation || null);
                setEditedBacktranslation(message.content?.backtranslation || null);
            }
        };

        window.addEventListener("message", handleBacktranslationResponse);
        return () => window.removeEventListener("message", handleBacktranslationResponse);
    }, []);

    useEffect(() => {
        // Fetch existing backtranslation when component mounts
        const messageContent: EditorPostMessages = {
            command: "getBacktranslation",
            content: {
                cellId: cellMarkers[0],
            },
        };
        window.vscodeApi.postMessage(messageContent);
    }, [cellMarkers]);

    const handleGenerateBacktranslation = () => {
        const messageContent: EditorPostMessages = {
            command: "generateBacktranslation",
            content: {
                text: contentBeingUpdated.cellContent,
                cellId: cellMarkers[0],
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    const handleSaveBacktranslation = () => {
        const messageContent: EditorPostMessages = {
            command: "setBacktranslation",
            content: {
                cellId: cellMarkers[0],
                originalText: contentBeingUpdated.cellContent,
                userBacktranslation: editedBacktranslation || "", // Ensure non-null string
            },
        };
        window.vscodeApi.postMessage(messageContent);
        setIsEditingBacktranslation(false);
    };

    const handlePinCell = () => {
        setIsPinned(!isPinned);
        window.vscodeApi.postMessage({
            command: "executeCommand",
            content: {
                command: "parallelPassages.pinCellById",
                args: [cellMarkers[0]],
            },
        });
    };

    const handleOpenCellById = useCallback(
        (cellId: string, text: string) => {
            // First, save the current cell if there are unsaved changes
            if (unsavedChanges) {
                handleSaveHtml();
            }
            // Then, open the new cell and set its content
            openCellById(cellId, text);

            // Update the local state with the new content
            setContentBeingUpdated((prev) => ({
                ...prev,
                cellContent: text,
                cellChanged: true,
            }));

            // Update the editor content
            setEditorContent(text);
        },
        [unsavedChanges, handleSaveHtml, openCellById, setContentBeingUpdated, setEditorContent]
    );

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "openCellById") {
                handleOpenCellById(message.cellId, message.text);
            }
        };

        window.addEventListener("message", handleMessage);

        // We're not returning a cleanup function here
    }, []); // Empty dependency array means this effect runs once on mount

    return (
        <div ref={cellEditorRef} className="cell-editor" style={{ direction: textDirection }}>
            <div className="editor-controls-header">
                <div
                    className="header-content"
                    onClick={() => setIsEditorControlsExpanded(!isEditorControlsExpanded)}
                    style={{ cursor: "pointer" }}
                >
                    <i className="codicon codicon-menu"></i>
                </div>
                <div className="action-buttons">
                    <AddParatextButton cellId={cellMarkers[0]} cellTimestamps={cellTimestamps} />
                    {cellType !== CodexCellTypes.PARATEXT && !cellIsChild && (
                        <VSCodeButton onClick={makeChild} appearance="icon" title="Add Child Cell">
                            <i className="codicon codicon-type-hierarchy-sub"></i>
                        </VSCodeButton>
                    )}
                    {!sourceCellContent && (
                        <ConfirmationButton
                            icon="trash"
                            onClick={deleteCell}
                            disabled={cellHasContent}
                        />
                    )}
                    <VSCodeButton
                        onClick={handlePinCell}
                        appearance="icon"
                        title={isPinned ? "Unpin from Parallel View" : "Pin in Parallel View"}
                        style={{
                            backgroundColor: isPinned
                                ? "var(--vscode-button-background)"
                                : "transparent",
                            color: isPinned
                                ? "var(--vscode-button-foreground)"
                                : "var(--vscode-editor-foreground)",
                            marginLeft: "auto", // This pushes it to the right
                        }}
                    >
                        <i className={`codicon ${isPinned ? "codicon-pinned" : "codicon-pin"}`}></i>
                    </VSCodeButton>
                    {unsavedChanges ? (
                        <>
                            <VSCodeButton
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleSaveHtml();
                                }}
                                appearance="primary"
                                className="save-button"
                            >
                                <i className="codicon codicon-save"></i>
                            </VSCodeButton>
                            <CloseButtonWithConfirmation
                                handleDeleteButtonClick={handleCloseEditor}
                            />
                        </>
                    ) : (
                        <VSCodeButton
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCloseEditor();
                            }}
                            appearance="icon"
                            className="close-button"
                        >
                            <i className="codicon codicon-close"></i>
                        </VSCodeButton>
                    )}
                </div>
            </div>

            {isEditorControlsExpanded && (
                <div className="expanded-controls">
                    <div className="input-group">
                        <div className="input-row">
                            <input
                                type="text"
                                value={editableLabel}
                                onChange={handleLabelChange}
                                onBlur={handleLabelBlur}
                                placeholder="Label"
                                className="label-input"
                            />
                            <VSCodeButton
                                onClick={handleLabelSave}
                                appearance="icon"
                                title="Save Label"
                            >
                                <i className="codicon codicon-save"></i>
                            </VSCodeButton>
                        </div>
                    </div>
                </div>
            )}

            <div className={`text-editor ${showFlashingBorder ? "flashing-border" : ""}`}>
                <Editor
                    currentLineId={cellMarkers[0]}
                    key={`${cellIndex}-quill`}
                    initialValue={editorContent}
                    spellCheckResponse={spellCheckResponse}
                    onChange={({ html }) => {
                        setEditorContent(html);

                        // Calculate unsaved changes state here
                        const hasUnsavedChanges = !!(
                            html &&
                            getCleanedHtml(html).replace(/\s/g, "") !==
                                cellContent.replace(/\s/g, "")
                        );

                        setContentBeingUpdated({
                            cellMarkers,
                            cellContent: html,
                            cellChanged: true,
                            cellLabel: editableLabel,
                        });
                    }}
                    textDirection={textDirection}
                    sourceText={sourceText}
                    onAutocomplete={handleAutocomplete}
                />
            </div>

            <div className="tabs">
                <div className="tab-buttons">
                    <button
                        className={`tab-button ${activeTab === "source" ? "active" : ""}`}
                        onClick={() => setActiveTab("source")}
                    >
                        Source Text
                    </button>
                    <button
                        className={`tab-button ${activeTab === "backtranslation" ? "active" : ""}`}
                        onClick={() => setActiveTab("backtranslation")}
                    >
                        Backtranslation
                    </button>
                </div>
            </div>

            <div className="tab-content">
                {activeTab === "source" && (
                    <div className="source-text-content">
                        {sourceText || "No source text available."}
                    </div>
                )}
                {activeTab === "backtranslation" && (
                    <div className="backtranslation-section">
                        {backtranslation ? (
                            <>
                                {isEditingBacktranslation ? (
                                    <>
                                        <textarea
                                            value={editedBacktranslation || ""}
                                            onChange={(e) =>
                                                setEditedBacktranslation(e.target.value)
                                            }
                                            className="backtranslation-editor"
                                        />
                                        <VSCodeButton
                                            onClick={handleSaveBacktranslation}
                                            appearance="icon"
                                            title="Save Backtranslation"
                                        >
                                            <i className="codicon codicon-save"></i>
                                        </VSCodeButton>
                                    </>
                                ) : (
                                    <>
                                        <div className="backtranslation-content">
                                            <ReactMarkdown>{backtranslation}</ReactMarkdown>
                                        </div>
                                        <VSCodeButton
                                            onClick={() => setIsEditingBacktranslation(true)}
                                            appearance="icon"
                                            title="Edit Backtranslation"
                                        >
                                            <i className="codicon codicon-edit"></i>
                                        </VSCodeButton>
                                    </>
                                )}
                            </>
                        ) : (
                            <p>No backtranslation available.</p>
                        )}
                        <VSCodeButton
                            onClick={handleGenerateBacktranslation}
                            appearance="icon"
                            title="Generate Backtranslation"
                        >
                            <i className="codicon codicon-refresh"></i>
                        </VSCodeButton>
                    </div>
                )}
            </div>

            <VSCodeButton
                onClick={handleAutocomplete}
                appearance="icon"
                title="Autocomplete"
                disabled={!sourceTextRef.current && !sourceText}
            >
                <i className="codicon codicon-autocomplete"></i>
            </VSCodeButton>
        </div>
    );
};

export default CellEditor;
