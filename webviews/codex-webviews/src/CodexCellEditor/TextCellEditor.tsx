import React, { useContext, useEffect, useRef } from "react";
import { EditorCellContent, EditorPostMessages, SpellCheckResponse } from "../../../../types";
import Editor from "./Editor";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
import { getCleanedHtml } from "./react-quill-spellcheck";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { CodexCellTypes } from "../../../../types/enums";

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
}) => {
    const { unsavedChanges, setUnsavedChanges, showFlashingBorder } =
        useContext(UnsavedChangesContext);
    const cellEditorRef = useRef<HTMLDivElement>(null);

    const unsavedChangesState = !!(
        contentBeingUpdated.cellContent &&
        getCleanedHtml(contentBeingUpdated.cellContent) &&
        getCleanedHtml(contentBeingUpdated.cellContent).replace(/\s/g, "") !==
            cellContent.replace(/\s/g, "")
    );

    useEffect(() => {
        setUnsavedChanges(unsavedChangesState);
    }, [unsavedChangesState]);

    useEffect(() => {
        if (showFlashingBorder && cellEditorRef.current) {
            cellEditorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [showFlashingBorder]);

    const makeChild = () => {
        // const cellComponents = .split(":");
        const newChildId = `${cellMarkers[cellMarkers.length - 1]}:${Math.random()
            .toString(36)
            .substring(7)}`;

        const messageContent: EditorPostMessages = {
            command: "makeChildOfCell",
            content: {
                newCellId: newChildId,
                cellIdOfCellBeforeNewCell: cellMarkers[cellMarkers.length - 1],
                cellType: cellType,
                data: {}, // TODO: add timestamps
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    return (
        <div ref={cellEditorRef} className="cell-editor" style={{ direction: textDirection }}>
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
                        <VSCodeButton
                            onClick={handleSaveHtml}
                            appearance="primary"
                            className={`${showFlashingBorder ? "flashing-border" : ""}`}
                        >
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
            <div className={`text-editor ${showFlashingBorder ? "flashing-border" : ""}`}>
                <Editor
                    currentLineId={cellMarkers[0]}
                    key={`${cellIndex}-quill`}
                    initialValue={cellContent}
                    spellCheckResponse={spellCheckResponse}
                    onChange={({ html }) => {
                        setContentBeingUpdated({
                            cellMarkers,
                            cellContent: html.endsWith("\n") ? html : `${html}\n`,
                            cellChanged: true,
                        });
                    }}
                    textDirection={textDirection}
                />
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    width: "100%",
                    paddingTop: "1em",
                }}
            >
                <VSCodeButton onClick={makeChild} appearance="icon">
                    <i className="codicon codicon-type-hierarchy-sub"></i>
                </VSCodeButton>
            </div>
        </div>
    );
};

export default CellEditor;
