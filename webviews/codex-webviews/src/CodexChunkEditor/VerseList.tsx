import React from "react";
import { EditorVerseContent, CustomNotebookData } from "../../../../types";
import VerseEditor from "./VerseEditor";
import VerseDisplay from "./VerseDisplay";
import EmptyVerseDisplay from "./EmptyVerseDisplay";
import "@vscode/codicons/dist/codicon.css"; // Import codicons

interface VerseListProps {
    translationUnits: { verseMarkers: string[]; verseContent: string }[];
    contentBeingUpdated: EditorVerseContent;
    setContentBeingUpdated: React.Dispatch<
        React.SetStateAction<EditorVerseContent>
    >;
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
}) => {
    const renderVerseGroup = (
        group: typeof translationUnits,
        startIndex: number,
    ) => (
        <span key={`group-${startIndex}`} className="verse-group">
            {group.map(({ verseMarkers, verseContent }, index) => (
                <VerseDisplay
                    key={startIndex + index}
                    verseMarker={verseMarkers.join(" ")}
                    verseContent={verseContent}
                    verseIndex={startIndex + index}
                    setContentBeingUpdated={setContentBeingUpdated}
                    vscode={vscode}
                />
            ))}
        </span>
    );

    const renderVerses = () => {
        const result = [];
        let currentGroup = [];
        let groupStartIndex = 0;

        for (let i = 0; i < translationUnits.length; i++) {
            const { verseMarkers, verseContent } = translationUnits[i];
            const verseMarker = verseMarkers.join(" ");

            if (verseMarker === contentBeingUpdated.verseMarkers?.join(" ")) {
                if (currentGroup.length > 0) {
                    result.push(
                        renderVerseGroup(currentGroup, groupStartIndex),
                    );
                    currentGroup = [];
                }
                result.push(
                    <VerseEditor
                        key={i}
                        verseMarker={verseMarker}
                        verseContent={verseContent}
                        verseIndex={i}
                        spellCheckResponse={spellCheckResponse}
                        contentBeingUpdated={contentBeingUpdated}
                        setContentBeingUpdated={setContentBeingUpdated}
                        handleCloseEditor={handleCloseEditor}
                        handleSaveMarkdown={handleSaveMarkdown}
                    />,
                );
                groupStartIndex = i + 1;
            } else if (verseContent.trim().length === 0) {
                if (currentGroup.length > 0) {
                    result.push(
                        renderVerseGroup(currentGroup, groupStartIndex),
                    );
                    currentGroup = [];
                }
                result.push(
                    <EmptyVerseDisplay
                        key={i}
                        verseMarker={verseMarker}
                        verseIndex={i}
                        setContentBeingUpdated={setContentBeingUpdated}
                    />,
                );
                groupStartIndex = i + 1;
            } else {
                currentGroup.push(translationUnits[i]);
            }
        }

        if (currentGroup.length > 0) {
            result.push(renderVerseGroup(currentGroup, groupStartIndex));
        }

        return result;
    };

    return <div className="verse-list">{renderVerses()}</div>;
};

export default VerseList;
