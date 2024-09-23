/* eslint-disable react-refresh/only-export-components */
import { useMemo } from "react";
import { vscode } from "../utilities/vscode";
import { renderToPage } from "../utilities/main-vscode";
import { MessageType } from "../types";

const StoriesOutline = () => {
    const storyNumbers = useMemo(
        () => new Array(50).fill(0).map((_, idx) => (idx + 1).toString().padStart(2, "0")),
        []
    );

    const handleClickStory = (storyNumber: string) => {
        vscode.postMessage({
            type: MessageType.openStory,
            payload: {
                storyNumber,
            },
        });
    };
    return (
        <div className="flex flex-col gap-2">
            {storyNumbers.map((storyNumber) => (
                <button
                    key={storyNumber}
                    className="flex flex-row items-center"
                    onClick={() => handleClickStory(storyNumber)}
                >
                    <div className="text-md font-medium">Story {storyNumber}</div>
                </button>
            ))}
        </div>
    );
};

renderToPage(<StoriesOutline />);
