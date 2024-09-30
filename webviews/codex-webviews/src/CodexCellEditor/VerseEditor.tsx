import React from "react";
import { EditorVerseContent, SpellCheckResponse } from "../../../../types";
import Editor from "./Editor";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
import { getCleanedHtml } from "./react-quill-spellcheck";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface VerseEditorProps {
    verseMarkers: string[];
    verseContent: string;
    verseIndex: number;
    spellCheckResponse: SpellCheckResponse | null;
    contentBeingUpdated: EditorVerseContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorVerseContent>>;
    handleCloseEditor: () => void;
    handleSaveMarkdown: () => void;
    textDirection: "ltr" | "rtl";
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
    textDirection,
}) => {
    const unsavedChanges = !!(
        contentBeingUpdated.content &&
        getCleanedHtml(contentBeingUpdated.content) &&
        getCleanedHtml(contentBeingUpdated.content).replace(/\s/g, "") !==
            verseContent.replace(/\s/g, "")
    );

    return (
        <div className="verse-editor" style={{ direction: textDirection }}>
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
                    textDirection={textDirection}
                />
            </div>
        </div>
    );
};

export default VerseEditor;
