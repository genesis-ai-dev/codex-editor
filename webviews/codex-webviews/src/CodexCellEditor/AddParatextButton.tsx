import { useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { EditorPostMessages } from "../../../../types";
import { CodexCellTypes } from "../../../../types/enums";

interface AddParatextButtonProps {
    cellId: string;
    cellTimestamps?: {
        startTime?: number;
        endTime?: number;
    };
}

export const AddParatextButton: React.FC<AddParatextButtonProps> = ({ cellId, cellTimestamps }) => {
    const [buttonsVisible, setButtonsVisible] = useState(false);

    const addParatextCell = (addDirection: "above" | "below") => {
        const parentCellId = cellId;
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
                referenceCellId: parentCellId,
                direction: addDirection,
                cellType: CodexCellTypes.PARATEXT,
                data: {
                    startTime: childStartTime,
                    endTime: endTime,
                },
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    if (!buttonsVisible) {
        return (
            <VSCodeButton
                onClick={() => setButtonsVisible(true)}
                appearance="icon"
                title="Add Paratext Cell"
            >
                <i className="codicon codicon-diff-added"></i>
            </VSCodeButton>
        );
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "row",
                gap: "0.5rem",
                flexWrap: "nowrap",
                border: "1px solid gray",
                borderRadius: "4px",
            }}
        >
            <VSCodeButton
                onClick={() => addParatextCell("above")}
                appearance="icon"
                title="Add Paratext Cell"
            >
                <i className="codicon codicon-arrow-circle-up"></i>
            </VSCodeButton>
            <VSCodeButton
                onClick={() => addParatextCell("below")}
                appearance="icon"
                title="Add Paratext Cell"
            >
                <i className="codicon codicon-arrow-circle-down"></i>
            </VSCodeButton>
        </div>
    );
};
