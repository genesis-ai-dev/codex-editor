import React from "react";
import { EditorVerseContent, CustomNotebookData } from "../../../../types";
import VerseEditor from "./VerseEditor";
import VerseDisplay from "./VerseDisplay";

interface VerseListProps {
    translationUnits: { verseMarkers: string[]; verseContent: string }[];
    contentBeingUpdated: EditorVerseContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorVerseContent>>;
    spellCheckResponse: CustomNotebookData;
    handleCloseEditor: () => void;
    handleSaveMarkdown: () => void;
    vscode: any;
}

const VerseList: React.FC<VerseListProps> = ({
    translationUnits,
    contentBeingUpdated,
    setContentBeingUpdated,
    spellCheckResponse,
    handleCloseEditor,
    handleSaveMarkdown,
    vscode,
}) => (
    <div className="verse-list">
        {translationUnits.map(({ verseMarkers, verseContent }, verseIndex) => {
            const verseMarker = verseMarkers?.join(" ");
            if (verseMarker === contentBeingUpdated.verseMarkers?.join(" ")) {
                return (
                    <VerseEditor
                        key={verseIndex}
                        verseMarker={verseMarker}
                        verseContent={verseContent}
                        verseIndex={verseIndex}
                        spellCheckResponse={spellCheckResponse}
                        contentBeingUpdated={contentBeingUpdated}
                        setContentBeingUpdated={setContentBeingUpdated}
                        handleCloseEditor={handleCloseEditor}
                        handleSaveMarkdown={handleSaveMarkdown}
                    />
                );
            } else {
                return (
                    <VerseDisplay
                        key={verseIndex}
                        verseMarker={verseMarker}
                        verseContent={verseContent}
                        verseIndex={verseIndex}
                        setContentBeingUpdated={setContentBeingUpdated}
                        vscode={vscode}
                    />
                );
            }
        })}
    </div>
);

export default VerseList;