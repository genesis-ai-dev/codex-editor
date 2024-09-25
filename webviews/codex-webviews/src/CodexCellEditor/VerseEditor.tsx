import React from "react";
import { EditorVerseContent, CustomNotebookData } from "../../../../types";
import Editor from "./Editor";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
import { getCleanedHtml } from "./react-quill-spellcheck";

interface VerseEditorProps {
    verseMarkers: string[];
    verseContent: string;
    verseIndex: number;
    spellCheckResponse: CustomNotebookData;
    contentBeingUpdated: EditorVerseContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorVerseContent>>;
    handleCloseEditor: () => void;
    handleSaveMarkdown: () => void;
}

const VerseEditor: React.FC<VerseEditorProps> = ({
    verseMarkers,
    verseContent,
    verseIndex,
    spellCheckResponse,
    contentBeingUpdated,
    setContentBeingUpdated,
    handleCloseEditor,
    handleSaveMarkdown,
}) => {
    const unsavedChanges = !!(
        contentBeingUpdated.content &&
        getCleanedHtml(contentBeingUpdated.content) &&
        getCleanedHtml(contentBeingUpdated.content).replace(/\s/g, "") !==
            verseContent.replace(/\s/g, "")
    );

    return (
        <div className="verse-editor">
            <div className="verse-header">
                <h3>{verseMarkers.join("-")}</h3>
                {unsavedChanges ? (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "row",
                            gap: "0.5rem",
                        }}
                    >
                        <button onClick={handleSaveMarkdown} className="vscode-button-confirm">
                            <i className="codicon codicon-save"></i>
                        </button>
                        <CloseButtonWithConfirmation handleDeleteButtonClick={handleCloseEditor} />
                    </div>
                ) : (
                    <button
                        onClick={handleCloseEditor}
                        disabled={unsavedChanges}
                        className="vscode-button"
                    >
                        <i className="codicon codicon-close"></i>
                    </button>
                )}
            </div>
            <div className="text-editor">
                <Editor
                    currentLineId={verseMarkers[0]}
                    key={`${verseIndex}-quill`}
                    initialValue={verseContent}
                    spellCheckResponse={spellCheckResponse}
                    onChange={({ html }) => {
                        setContentBeingUpdated({
                            verseMarkers,
                            content: html.endsWith("\n") ? html : `${html}\n`,
                        });
                    }}
                />
            </div>
        </div>
    );
};

export default VerseEditor;
