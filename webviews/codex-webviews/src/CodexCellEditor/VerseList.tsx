import React from "react";
import {
    EditorVerseContent,
    CustomNotebookData,
    CodexCellTypes,
} from "../../../../types";
import VerseEditor from "./VerseEditor";
import CellContentDisplay from "./CellContentDisplay";
import EmptyVerseDisplay from "./EmptyVerseDisplay";
import "@vscode/codicons/dist/codicon.css"; // Import codicons

interface VerseListProps {
    translationUnits: {
        verseMarkers: string[];
        verseContent: string;
        cellType: CodexCellTypes;
    }[];
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
            {group.map(({ verseMarkers, verseContent, cellType }, index) => (
                <CellContentDisplay
                    key={startIndex + index}
                    cellIds={verseMarkers}
                    cellContent={verseContent}
                    cellIndex={startIndex + index}
                    cellType={cellType}
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

            if (
                verseMarkers.join(" ") ===
                contentBeingUpdated.verseMarkers?.join(" ")
            ) {
                if (currentGroup.length > 0) {
                    result.push(
                        renderVerseGroup(currentGroup, groupStartIndex),
                    );
                    currentGroup = [];
                }
                result.push(
                    <VerseEditor
                        key={i}
                        verseMarkers={verseMarkers}
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
                        verseMarkers={verseMarkers}
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

    return <div className="verse-list ql-editor">{renderVerses()}</div>;
};

export default VerseList;
