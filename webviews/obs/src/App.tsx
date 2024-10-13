import { useEffect, useState } from "react";
import "react-virtualized/styles.css";
import "./App.css";
import { vscode } from "./utilities/vscode";
import { markdownToStories, storiesToMarkdown } from "./utilities/editor";
import ObsEditorPanel from "./components/ObsEditorPanel";
import { useDocument } from "./hooks/useDocument";
import ObsReadonlyPanel from "./components/ObsReadonlyPanel";
import { MessageType } from "./types";

function App() {
    const [stories, setStories] = useState([]);

    const { document: doc, isReadonly } = useDocument();
    useEffect(() => {
        vscode.setMessageListeners();
    }, []);

    useEffect(() => {
        if (doc) {
            setStories(markdownToStories(doc ?? "") as []);
        }
    }, [doc]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSetStoryChange = (story: Record<string, any>[]) => {
        setStories(story as []);
        const docMarkdown = storiesToMarkdown(story);

        vscode.postMessage({
            type: MessageType.save,
            payload: docMarkdown,
        });
    };

    if (isReadonly) {
        return (
            <div className="card">
                <ObsReadonlyPanel obsStory={stories} />
            </div>
        );
    }
    return (
        <>
            <div className="card">
                {/* <VSCodeButton onClick={handleHowdyClick}>Howdy!</VSCodeButton> */}
                <div>
                    <ObsEditorPanel obsStory={stories} setStory={handleSetStoryChange} />
                </div>
            </div>
        </>
    );
}

export default App;
