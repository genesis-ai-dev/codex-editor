import { useState } from "react";
import { Button } from "../components/ui/button";
import { Plus, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
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
        setButtonsVisible(false);
    };

    if (!buttonsVisible) {
        return (
            <Button
                onClick={() => setButtonsVisible(true)}
                variant="ghost"
                size="icon"
                title="Add Paratext Cell"
            >
                <Plus className="h-4 w-4" />
            </Button>
        );
    }

    return (
        <div className="flex gap-1 border border-border rounded-md p-0.5">
            <Button
                onClick={() => addParatextCell("above")}
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Add Paratext Cell Above"
            >
                <ArrowUpCircle className="h-4 w-4" />
            </Button>
            <Button
                onClick={() => addParatextCell("below")}
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Add Paratext Cell Below"
            >
                <ArrowDownCircle className="h-4 w-4" />
            </Button>
        </div>
    );
};
