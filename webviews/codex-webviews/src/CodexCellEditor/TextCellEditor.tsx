import React from "react";
import { EditorCellContent, SpellCheckResponse } from "../../../../types";
import Editor from "./Editor";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
import { getCleanedHtml } from "./react-quill-spellcheck";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface CellEditorProps {
    cellMarkers: string[];
    cellContent: string;
    cellIndex: number;
    spellCheckResponse: SpellCheckResponse | null;
    contentBeingUpdated: EditorCellContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    handleCloseEditor: () => void;
    handleSaveMarkdown: () => void;
    textDirection: "ltr" | "rtl";
}

const CellEditor: React.FC<CellEditorProps> = ({
    cellMarkers,
    cellContent,
    cellIndex,
    spellCheckResponse,
    contentBeingUpdated,
    setContentBeingUpdated,
    handleCloseEditor,
    handleSaveMarkdown,
    textDirection,
}) => {
    const unsavedChanges = !!(
        contentBeingUpdated.content &&
        getCleanedHtml(contentBeingUpdated.content) &&
        getCleanedHtml(contentBeingUpdated.content).replace(/\s/g, "") !==
            cellContent.replace(/\s/g, "")
    );

    return (
        <div className="cell-editor" style={{ direction: textDirection }}>
            <div className="cell-header">
                <h3>{cellMarkers.join("-")}</h3>
                {unsavedChanges ? (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            gap: "0.5rem",
                        }}
                    >
                        <VSCodeButton onClick={handleSaveMarkdown} appearance="primary">
                            <i className="codicon codicon-save"></i>
                        </VSCodeButton>
                        <CloseButtonWithConfirmation handleDeleteButtonClick={handleCloseEditor} />
                    </div>
                ) : (
                    <VSCodeButton onClick={handleCloseEditor} appearance="icon">
                        <i className="codicon codicon-close"></i>
                    </VSCodeButton>
                )}
            </div>
            <div className="text-editor">
                <Editor
                    currentLineId={cellMarkers[0]}
                    key={`${cellIndex}-quill`}
                    initialValue={cellContent}
                    spellCheckResponse={spellCheckResponse}
                    onChange={({ html }) => {
                        setContentBeingUpdated({
                            cellMarkers,
                            content: html.endsWith("\n") ? html : `${html}\n`,
                        });
                    }}
                    textDirection={textDirection}
                />
            </div>
        </div>
    );
};

export default CellEditor;
