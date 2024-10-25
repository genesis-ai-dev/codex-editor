import React, { useContext, useEffect, useState } from "react";
import { EditorCellContent, EditorPostMessages, Timestamps } from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";
import { CodexCellTypes } from "../../../../types/enums";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { WebviewApi } from "vscode-webview";

interface CellContentDisplayProps {
    cellIds: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    cellLabel?: string;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    isSourceText: boolean;
    hasDuplicateId: boolean;
    timestamps: Timestamps | undefined;
    getAlertCodeFunction: (
        text: string,
        cellId: string
    ) => Promise<{ getAlertCode: number; cellId: string }>;
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cellIds,
    cellContent,
    cellType,
    cellLabel,
    setContentBeingUpdated,
    vscode,
    textDirection,
    isSourceText,
    hasDuplicateId,
    timestamps,
    getAlertCodeFunction,
}) => {
    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);
    const [getAlertCode, setgetAlertCode] = useState<number>(-1);

    useEffect(() => {
        const checkContent = async () => {
            if (getAlertCode !== -1) return;
            try {
                const result = await getAlertCodeFunction(cellContent, cellIds[0]);
                setgetAlertCode(result.getAlertCode);
            } catch (error) {
                console.error("Error checking content:", error);
                setgetAlertCode(0);
            }
        };
        checkContent();
    }, [cellContent, cellIds]);

    const handleVerseClick = () => {
        if (unsavedChanges || isSourceText) {
            toggleFlashingBorder();
            return;
        }
        setContentBeingUpdated({
            cellMarkers: cellIds,
            cellContent,
            cellChanged: unsavedChanges,
            cellLabel,
            timestamps,
        } as EditorCellContent);
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: { currentLineId: cellIds[0] },
        } as EditorPostMessages);
    };

    const displayLabel =
        cellLabel ||
        (() => {
            const numbers = cellIds.map((id) => id.split(":").pop());
            const reference =
                numbers.length === 1 ? numbers[0] : `${numbers[0]}-${numbers[numbers.length - 1]}`;
            return reference?.slice(-3) ?? "";
        })();

    const AlertDot = ({ color }: { color: string }) => (
        <span
            style={{
                display: "inline-block",
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: color,
                marginLeft: "4px",
            }}
        />
    );

    const getAlertDot = () => {
        const colors = {
            "-1": "transparent",
            "0": "transparent",
            "1": "#FF6B6B",
            "2": "purple",
            "3": "white",
        } as const;
        return (
            <AlertDot
                color={colors[getAlertCode.toString() as keyof typeof colors] || "transparent"}
            />
        );
    };

    return (
        <span
            className={`verse-display ${
                cellType === CodexCellTypes.TEXT ? "canonical-display" : "paratext-display"
            } cell-content ${hasDuplicateId ? "duplicate-id" : ""}`}
            onClick={handleVerseClick}
            style={{ direction: textDirection }}
        >
            {hasDuplicateId && (
                <span className="duplicate-id-alert">
                    <i className="codicon codicon-warning"></i>
                </span>
            )}
            {cellType === CodexCellTypes.TEXT && (
                <sup>
                    {displayLabel}
                    {getAlertDot()}
                </sup>
            )}
            {cellType === CodexCellTypes.PARATEXT && (
                <span className="paratext-indicator">[Paratext]</span>
            )}
            <span
                style={{ direction: textDirection }}
                dangerouslySetInnerHTML={{
                    __html: HACKY_removeContiguousSpans(cellContent),
                }}
            />
        </span>
    );
};

export default CellContentDisplay;
