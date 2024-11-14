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
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
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
    const [topPrompts, setTopPrompts] = useState<string[]>([]);
    const [selectedPrompts, setSelectedPrompts] = useState<Set<string>>(new Set());
    const [visiblePrompts, setVisiblePrompts] = useState<string[]>([]);
    const MAX_VISIBLE_PROMPTS = 5;
    const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
    const [editingPromptText, setEditingPromptText] = useState("");
    const [isPromptsExpanded, setIsPromptsExpanded] = useState(false);
    const [showPromptsSection, setShowPromptsSection] = useState(true);
    const [isEditorControlsExpanded, setIsEditorControlsExpanded] = useState(false);

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

            // Clear the prompt input and hide entire prompts section
            setPrompt("");
            setShowPromptsSection(false);
            setSelectedPrompts(new Set());
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

    useEffect(() => {
        if (contentBeingUpdated.cellContent) {
            const messageContent: EditorPostMessages = {
                command: "getTopPrompts",
                content: {
                    cellId: cellMarkers[0],
                    text: contentBeingUpdated.cellContent,
                },
            };
            window.vscodeApi.postMessage(messageContent);
        }
    }, [contentBeingUpdated.cellContent]);

    useEffect(() => {
        const handleTopPromptsResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsTopPrompts") {
                setTopPrompts(message.content);
            }
        };

        window.addEventListener("message", handleTopPromptsResponse);
        return () => window.removeEventListener("message", handleTopPromptsResponse);
    }, []);

    useEffect(() => {
        if (topPrompts.length > 0) {
            // Remove duplicates using Set
            const uniquePrompts = Array.from(new Set(topPrompts));
            const initialVisible = uniquePrompts.slice(0, MAX_VISIBLE_PROMPTS);
            setVisiblePrompts(initialVisible);
            setSelectedPrompts(new Set(initialVisible));
        }
    }, [topPrompts]);

    const handlePromptSelect = (prompt: string) => {
        setSelectedPrompts((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(prompt)) {
                newSet.delete(prompt);
            } else {
                newSet.add(prompt);
            }
            return newSet;
        });
    };

    const handlePromptEdit = (index: number, event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setEditingPromptIndex(index);
        setEditingPromptText(visiblePrompts[index]);
    };

    const handlePromptEditSave = () => {
        if (editingPromptIndex !== null) {
            const newPrompts = [...visiblePrompts];
            newPrompts[editingPromptIndex] = editingPromptText;
            setVisiblePrompts(newPrompts);

            setSelectedPrompts((prev) => {
                const newSet = new Set(prev);
                newSet.delete(visiblePrompts[editingPromptIndex]);
                newSet.add(editingPromptText);
                return newSet;
            });

            setEditingPromptIndex(null);
            setEditingPromptText("");
        }
    };

    const handlePromptEditCancel = () => {
        setEditingPromptIndex(null);
        setEditingPromptText("");
    };

    const handleApplySelectedPrompts = async () => {
        for (const prompt of selectedPrompts) {
            const messageContent: EditorPostMessages = {
                command: "applyPromptedEdit",
                content: {
                    text: contentBeingUpdated.cellContent,
                    prompt: prompt,
                    cellId: cellMarkers[0],
                },
            };
            window.vscodeApi.postMessage(messageContent);
        }
        setSelectedPrompts(new Set());
        setShowPromptsSection(false);
    };

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
                    <div className="input-row">
                        <textarea
                            value={prompt}
                            onChange={handlePromptChange}
                            onKeyDown={handleKeyDown}
                            placeholder="Prompt"
                            rows={1}
                            className="prompt-input"
                        />
                        <VSCodeButton
                            onClick={handlePromptSend}
                            appearance="icon"
                            title="Send Prompt"
                        >
                            <i className="codicon codicon-send"></i>
                        </VSCodeButton>
                    </div>
                </div>
            )}

            <div className="text-editor">
                <Editor
                    currentLineId={cellMarkers[0]}
                    key={`${cellIndex}-quill`}
                    initialValue={editorContent}
                    spellCheckResponse={spellCheckResponse}
                    onChange={({ html }) => {
                        setEditorContent(html);
                        setContentBeingUpdated({
                            cellMarkers,
                            cellContent: html,
                            cellChanged: true,
                            cellLabel: editableLabel,
                        });
                    }}
                    textDirection={textDirection}
                />
            </div>

            {showPromptsSection && visiblePrompts.length > 0 && (
                <div className="top-prompts-section">
                    <div className="prompts-header">
                        <h4>Suggested Prompts</h4>
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => setIsPromptsExpanded(!isPromptsExpanded)}
                        >
                            <i
                                className={`codicon codicon-chevron-${
                                    isPromptsExpanded ? "up" : "down"
                                }`}
                            ></i>
                        </VSCodeButton>
                    </div>

                    {isPromptsExpanded && (
                        <>
                            <ul className="prompts-list">
                                {visiblePrompts.map((prompt, index) => (
                                    <li key={index} className="prompt-item">
                                        {editingPromptIndex === index ? (
                                            <div className="prompt-edit-container">
                                                <input
                                                    type="text"
                                                    value={editingPromptText}
                                                    onChange={(e) =>
                                                        setEditingPromptText(e.target.value)
                                                    }
                                                    className="edit-prompt-input"
                                                />
                                                <div className="prompt-edit-buttons">
                                                    <VSCodeButton onClick={handlePromptEditSave}>
                                                        Save
                                                    </VSCodeButton>
                                                    <VSCodeButton onClick={handlePromptEditCancel}>
                                                        Cancel
                                                    </VSCodeButton>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="prompt-display-container">
                                                <VSCodeCheckbox
                                                    checked={selectedPrompts.has(prompt)}
                                                    onChange={() => handlePromptSelect(prompt)}
                                                >
                                                    {prompt}
                                                </VSCodeCheckbox>
                                                <VSCodeButton
                                                    appearance="icon"
                                                    onClick={(e) => handlePromptEdit(index, e)}
                                                >
                                                    <i className="codicon codicon-edit"></i>
                                                </VSCodeButton>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            <div className="prompts-actions">
                                <VSCodeButton
                                    onClick={handleApplySelectedPrompts}
                                    disabled={selectedPrompts.size === 0}
                                >
                                    Apply Selected Prompts
                                </VSCodeButton>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default CellEditor;
