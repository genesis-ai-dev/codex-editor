import React, { useContext, useEffect, useRef, useState } from "react";
import {
    EditorCellContent,
    EditorPostMessages,
    SpellCheckResponse,
    Timestamps,
} from "../../../../types";
import Editor from "./Editor";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
import { getCleanedHtml } from "./react-quill-spellcheck";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { CodexCellTypes } from "../../../../types/enums";
import SourceCellContext from "./contextProviders/SourceCellContext";
import ConfirmationButton from "./ConfirmationButton";
import { debounce } from "lodash";
import { generateChildCellId } from "../../../../src/providers/codexCellEditorProvider/utils/cellUtils";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";

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
    getAlertCode: (
        text: string,
        cellId: string
    ) => Promise<{ alertColorCode: number; cellId: string }>;
    contentBeingUpdated: EditorCellContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    handleCloseEditor: () => void;
    handleSaveHtml: () => void;
    textDirection: "ltr" | "rtl";
    cellLabel?: string;
    cellTimestamps: Timestamps | undefined;
    cellIsChild: boolean;
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
}) => {
    const { unsavedChanges, setUnsavedChanges, showFlashingBorder } =
        useContext(UnsavedChangesContext);
    const { contentToScrollTo } = useContext(ScrollToContentContext);
    const { sourceCellMap } = useContext(SourceCellContext);
    const cellEditorRef = useRef<HTMLDivElement>(null);
    const sourceCellContent = sourceCellMap?.[cellMarkers[0]];
    const [editorContent, setEditorContent] = useState(cellContent);

    const unsavedChangesState = !!(
        contentBeingUpdated.cellContent &&
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
            !unsavedChanges
        ) {
            cellEditorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [contentToScrollTo]);

    const [editableLabel, setEditableLabel] = useState(cellLabel || "");
    const [prompt, setPrompt] = useState("");
    const [similarCells, setSimilarCells] = useState<SimilarCell[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [activeSearchPosition, setActiveSearchPosition] = useState<number | null>(null);

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

    const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setPrompt(newValue);
        setCursorPosition(e.target.selectionStart);

        // Only search if we're in an active @ search
        if (activeSearchPosition !== null) {
            const textAfterAt = newValue.slice(activeSearchPosition + 1, e.target.selectionStart);
            if (textAfterAt.length > 0) {
                const messageContent: EditorPostMessages = {
                    command: "searchSimilarCellIds",
                    content: {
                        cellId: textAfterAt,
                    },
                };
                window.vscodeApi.postMessage(messageContent);
                setShowSuggestions(true);
            }
        } else {
            // Check for new @ symbol
            const lastAtSymbolIndex = newValue.lastIndexOf("@", e.target.selectionStart);
            if (lastAtSymbolIndex !== -1 && lastAtSymbolIndex === e.target.selectionStart - 1) {
                setActiveSearchPosition(lastAtSymbolIndex);
                setShowSuggestions(true);
            }
        }
    };

    const insertCellId = (cellId: string) => {
        if (activeSearchPosition !== null) {
            // Get the text before and after the current search
            const textBefore = prompt.slice(0, activeSearchPosition);
            const textAfter = prompt.slice(cursorPosition).trimLeft();

            // Create new prompt with exactly one space after the cell ID if there's more text
            const newPrompt = `${textBefore}@${cellId}${textAfter ? " " + textAfter : ""}`;

            // Calculate new cursor position (right after the cell ID, before the space)
            const newCursorPosition = activeSearchPosition + cellId.length + 1; // +1 for @ only

            setPrompt(newPrompt);

            // Need to wait for the state update before setting cursor position
            setTimeout(() => {
                const textarea = document.querySelector(".prompt-input") as HTMLTextAreaElement;
                if (textarea) {
                    textarea.focus();
                    textarea.setSelectionRange(newCursorPosition, newCursorPosition);
                }
            }, 0);

            setActiveSearchPosition(null);
            setShowSuggestions(false);
            setCursorPosition(newCursorPosition);
        }
    };

    const handlePromptSend = async () => {
        if (!prompt.trim()) return;

        try {
            const messageContent: EditorPostMessages = {
                command: "applyPromptedEdit",
                content: {
                    text: contentBeingUpdated.cellContent,
                    prompt: prompt,
                    cellId: cellMarkers[0],
                },
            };

            window.vscodeApi.postMessage(messageContent);

            // Clear the prompt input
            setPrompt("");
        } catch (error) {
            console.error("Error sending prompt:", error);
        }
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
                cellIdOfCellBeforeNewCell: parentCellId,
                cellType: cellType,
                data: {
                    startTime: childStartTime,
                    endTime: endTime,
                },
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    const addParatextCell = () => {
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
                cellIdOfCellBeforeNewCell: parentCellId,
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

    useEffect(() => {
        const handlePromptedEditResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsPromptedEditResponse") {
                setContentBeingUpdated((prev) => ({
                    ...prev,
                    cellContent: message.content,
                }));
                // Update the editor content as well
                setEditorContent(message.content);
            }
        };

        window.addEventListener("message", handlePromptedEditResponse);
        return () => window.removeEventListener("message", handlePromptedEditResponse);
    }, []);

    const formatPromptWithHighlights = (text: string) => {
        // Updated regex to include spaces and more characters in cell IDs
        const parts = text.split(/(@[\w\s:.]+?)(?=\s|$)/g);
        return parts.map((part, index) => {
            if (part.startsWith("@")) {
                return (
                    <span key={index} className="cell-reference">
                        {part}
                    </span>
                );
            }
            return part;
        });
    };

    // Add keydown handler to detect Escape key
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
            setActiveSearchPosition(null);
            setShowSuggestions(false);
        }
    };

    return (
        <div ref={cellEditorRef} className="cell-editor" style={{ direction: textDirection }}>
            <div className="cell-header">
                <div className="header-controls">
                    <div className="input-group">
                        <div className="label-container">
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
                        <div className="prompt-container">
                            <textarea
                                value={prompt}
                                onChange={handlePromptChange}
                                onKeyDown={handleKeyDown}
                                placeholder="Prompt"
                                rows={1}
                                className="prompt-input"
                            />
                            <div className="prompt-preview">
                                {formatPromptWithHighlights(prompt)}
                            </div>
                            {showSuggestions && similarCells.length > 0 && (
                                <div className="suggestions-dropdown">
                                    {similarCells.map((cell) => (
                                        <div
                                            key={cell.cellId}
                                            className="suggestion-item"
                                            onClick={() => insertCellId(cell.cellId)}
                                        >
                                            {cell.cellId}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <VSCodeButton
                                onClick={handlePromptSend}
                                appearance="icon"
                                title="Send Prompt"
                            >
                                <i className="codicon codicon-send"></i>
                            </VSCodeButton>
                        </div>
                    </div>
                    <div className="action-buttons">
                        {unsavedChanges ? (
                            <>
                                <VSCodeButton
                                    onClick={handleSaveHtml}
                                    appearance="primary"
                                    className={`save-button ${
                                        showFlashingBorder ? "flashing-border" : ""
                                    }`}
                                >
                                    <i className="codicon codicon-save"></i>
                                </VSCodeButton>
                                <CloseButtonWithConfirmation
                                    handleDeleteButtonClick={handleCloseEditor}
                                />
                            </>
                        ) : (
                            <VSCodeButton
                                onClick={handleCloseEditor}
                                appearance="icon"
                                className="close-button"
                            >
                                <i className="codicon codicon-close"></i>
                            </VSCodeButton>
                        )}
                    </div>
                </div>
            </div>
            <div className={`text-editor ${showFlashingBorder ? "flashing-border" : ""}`}>
                <Editor
                    currentLineId={cellMarkers[0]}
                    key={`${cellIndex}-quill`}
                    initialValue={editorContent}
                    spellCheckResponse={spellCheckResponse}
                    onChange={debounce(({ html }) => {
                        setEditorContent(html);
                        setContentBeingUpdated({
                            cellMarkers,
                            cellContent: html,
                            cellChanged: true,
                            cellLabel: editableLabel,
                        });
                    }, 300)}
                    textDirection={textDirection}
                />
            </div>
            <div className="cell-footer">
                <div className="footer-buttons">
                    <VSCodeButton
                        onClick={addParatextCell}
                        appearance="icon"
                        title="Add Paratext Cell"
                    >
                        <i className="codicon codicon-diff-added"></i>
                    </VSCodeButton>
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
                </div>
            </div>
            <style>{`
                .cell-editor {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }
                
                .header-controls {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 1rem;
                }

                .input-group {
                    display: flex;
                    gap: 1rem;
                    flex-grow: 1;
                }

                .label-container, .prompt-container {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    padding: 2px;
                }

                .label-input {
                    width: 200px;
                }

                .prompt-input {
                    width: 250px;
                    resize: none;
                }

                .label-input, .prompt-input {
                    background: transparent;
                    border: none;
                    color: var(--vscode-input-foreground);
                }

                .action-buttons, .footer-buttons {
                    display: flex;
                    gap: 0.5rem;
                }

                @keyframes flash {
                    50% { border-color: var(--vscode-button-background); }
                }

                .prompt-container {
                    position: relative;
                }

                .prompt-input {
                    width: 250px;
                    resize: none;
                    position: absolute;
                    background: transparent;
                    color: transparent;
                    caret-color: var(--vscode-input-foreground);
                }

                .prompt-preview {
                    width: 250px;
                    white-space: pre-wrap;
                    pointer-events: none;
                }

                .cell-reference {
                    color: var(--vscode-textLink-foreground);
                }

                .suggestions-dropdown {
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    max-height: 200px;
                    overflow-y: auto;
                    z-index: 1000;
                }

                .suggestion-item {
                    padding: 4px 8px;
                    cursor: pointer;
                }

                .suggestion-item:hover {
                    background: var(--vscode-list-hoverBackground);
                }
            `}</style>
        </div>
    );
};

export default CellEditor;
