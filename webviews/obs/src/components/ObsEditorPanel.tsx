// import { Key } from "react";

import { VSCodeTextArea } from "@vscode/webview-ui-toolkit/react";
import { FormEventHandler, useEffect } from "react";
import { vscode } from "../utilities/vscode";
import { MessageType } from "../types";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ObsStory = Record<string, any>;
// type ObsStory = {
//   id: Key | null | undefined;
//   title: string | undefined;
//   text: string | undefined;
//   end: string | undefined;
// };

const autoResizeVscodeTextarea = (vscodeTextArea: HTMLElement) => {
    // This is a little hacky... we have to reach in and get the text area
    // element since we can't directly access the height with Vscode's text area
    const textAreaElement = vscodeTextArea.shadowRoot?.querySelector("textarea");
    if (textAreaElement) {
        textAreaElement.style.height = "auto";
        textAreaElement.style.height = `${textAreaElement.scrollHeight}px`;

        // This auto updates the height of the parent component.
        // Unsure if this behavior is desired.
        vscodeTextArea.style.height = "auto";
        vscodeTextArea.style.height = `${textAreaElement.scrollHeight}px`;
    }
};

const ObsEditorPanel = ({
    obsStory,
    setStory,
}: {
    obsStory: ObsStory[];
    setStory: (story: ObsStory[]) => void;
}) => {
    useEffect(() => {
        // Adjust text area height on first render if necessary
        const vscodeTextAreas = document.querySelectorAll("vscode-text-area");
        vscodeTextAreas.forEach((element) => {
            if (element instanceof HTMLElement) {
                autoResizeVscodeTextarea(element);
            }
        });
    }, [obsStory]);

    const handleChange: ((e: globalThis.Event) => unknown) & FormEventHandler = (e) => {
        autoResizeVscodeTextarea(e.currentTarget as HTMLTextAreaElement);
        const index = Number((e.target as HTMLElement)?.getAttribute("data-id")) ?? 0;
        const value = (e.target as HTMLInputElement)?.value?.toString().replace(/[\n\r]/gm, "");
        const story = obsStory[index - 1];
        let newStory = {};
        if (Object.prototype.hasOwnProperty.call(story, "title")) {
            newStory = {
                id: story.id,
                title: value,
            };
        } else if (Object.prototype.hasOwnProperty.call(story, "text")) {
            newStory = {
                id: story.id,
                img: story.img,
                text: value,
            };
        } else if (Object.prototype.hasOwnProperty.call(story, "end")) {
            newStory = {
                id: story.id,
                end: value,
            };
        }
        const newObsStory = [...obsStory];
        newObsStory[index - 1] = newStory;
        setStory(newObsStory);
    };

    const handleParagraphFocus = (paragraphId: number) => {
        vscode.postMessage({
            type: MessageType.UPDATE_OBS_REF,
            payload: {
                paragraphId,
            },
        });
    };

    return (
        <div className="flex gap-2 flex-col w-full">
            {obsStory.map((story, index: number) => (
                <div className="flex items-center w-full">
                    {Object.prototype.hasOwnProperty.call(story, "title") && (
                        <div className="flex m-4 rounded-md w-full" key={story.id}>
                            <VSCodeTextArea
                                name={story.title}
                                onInput={handleChange}
                                value={story.title}
                                data-id={story.id}
                                className="flex-grow text-justify ml-2 p-2 text-xl"
                            />
                        </div>
                    )}
                    {Object.prototype.hasOwnProperty.call(story, "text") && (
                        <div className="flex m-4 rounded-md w-full gap-2" key={story.id}>
                            <span className="w-10 h-10 bg-gray-800 rounded-full flex justify-center text-md text-white items-center p-6 ">
                                {index}
                            </span>

                            {Object.prototype.hasOwnProperty.call(story, "img") && (
                                <div className="rounded-md w-2/5" key={story.id}>
                                    <img src={story.img} alt={story.title} />
                                </div>
                            )}

                            <VSCodeTextArea
                                name={story.text}
                                onInput={handleChange}
                                value={story.text}
                                data-id={story.id}
                                className=" text-justify ml-2 text-sm w-full"
                                onFocus={() => handleParagraphFocus(index)}
                            />
                        </div>
                    )}
                    {Object.prototype.hasOwnProperty.call(story, "end") && (
                        <div className="flex m-4 rounded-md w-full" key={story.id}>
                            <VSCodeTextArea
                                name={story.end}
                                onInput={handleChange}
                                value={story.end}
                                data-id={story.id}
                                className="flex-grow text-justify ml-2 text-sm h-full"
                            />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
export default ObsEditorPanel;
