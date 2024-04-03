import type { ObsStory } from "./ObsEditorPanel";

const ObsReadonlyPanel = ({ obsStory }: { obsStory: ObsStory[] }) => {
    return (
        <div className="flex gap-2 flex-col w-full">
            {obsStory.map((story, index: number) => (
                <div className="flex items-center w-full">
                    {Object.prototype.hasOwnProperty.call(story, "title") && (
                        <div
                            className="flex m-4 rounded-md w-full"
                            key={story.id}
                        >
                            <h1 className="text-[color:var(--vscode-descriptionForeground)] flex-grow text-justify ml-2 p-2 text-xl">
                                {story.title}
                            </h1>
                        </div>
                    )}
                    {Object.prototype.hasOwnProperty.call(story, "text") && (
                        <div
                            className="flex m-4 rounded-md w-full gap-2"
                            key={story.id}
                        >
                            <span className="w-10 h-10 bg-gray-800 rounded-full flex justify-center text-md text-white items-center p-6 ">
                                {index}
                            </span>

                            {Object.prototype.hasOwnProperty.call(
                                story,
                                "img",
                            ) && (
                                <div
                                    className="rounded-md w-2/5"
                                    key={story.id}
                                >
                                    <img src={story.img} alt={story.title} />
                                </div>
                            )}

                            <p className="text-[color:var(--vscode-descriptionForeground)]  text-justify ml-2 w-full ">
                                {story.text}
                            </p>
                        </div>
                    )}
                    {Object.prototype.hasOwnProperty.call(story, "end") && (
                        <div
                            className="flex m-4 rounded-md w-full"
                            key={story.id}
                        >
                            <footer className="text-[color:var(--vscode-descriptionForeground)] flex-grow text-justify ml-2 text-sm h-full">
                                {story.end}
                            </footer>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
export default ObsReadonlyPanel;
