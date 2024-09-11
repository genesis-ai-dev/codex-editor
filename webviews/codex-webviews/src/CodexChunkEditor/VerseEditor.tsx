import React from "react";
import { EditorVerseContent, CustomNotebookData } from "../../../../types";
import Editor from "./Editor";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
import { getCleanedHtml } from "./react-quill-spellcheck";

interface VerseEditorProps {
    verseMarker: string;
    verseContent: string;
    verseIndex: number;
    spellCheckResponse: CustomNotebookData;
    contentBeingUpdated: EditorVerseContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorVerseContent>>;
    handleCloseEditor: () => void;
    handleSaveMarkdown: () => void;
}

const VerseEditor: React.FC<VerseEditorProps> = ({
    verseMarker,
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
                <h3>{verseMarker}</h3>
                {!unsavedChanges ? (
                    <button onClick={handleCloseEditor} disabled={unsavedChanges}>
                        ❌
                    </button>
                ) : (
                    <CloseButtonWithConfirmation handleDeleteButtonClick={handleCloseEditor} />
                )}
            </div>
            <div className="text-editor">
                <Editor
                    key={`${verseIndex}-quill`}
                    value={contentBeingUpdated.content || verseContent}
                    spellCheckResponse={spellCheckResponse}
                    onChange={({ html }) => {
                        setContentBeingUpdated({
                            verseIndex,
                            verseMarkers: [verseMarker],
                            content: html.endsWith("\n") ? html : `${html}\n`,
                        });
                    }}
                />
                <button onClick={handleSaveMarkdown}>Save</button>
            </div>
        </div>
    );
};

export default VerseEditor;