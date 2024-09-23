import { ScribexContext, ScribexContextType } from "@/context/ScribexContext";
import { useContext, useState } from "react";
import { useDocument } from "../hooks/useDocument";
import Editor from "./Editor";
import usePerf from "@/hooks/usePerf2";
import { useDeepCompareEffect } from "use-deep-compare";
import { useEffect } from "react";
import { MessageType } from "../types/types";
import { vscode } from "@/utilities/vscode";
// import { ReferenceContext } from "@/context/ReferenceContext";

const scrollToChapter = (chapter: number, verse: number) => {
    const element = document.getElementById(`ch${chapter}v${verse}`);
    element?.scrollIntoView({ behavior: "smooth" });
};
export default function Scribex() {
    const [bookCode, setBookCode] = useState<string>("");
    const {
        perf,
        id: bookId,
        docSetId,
        chapter,
    } = useDocument({ scrollToChapter, bookCode, setBookCode });

    const { state, actions } = useContext<ScribexContextType>(ScribexContext);

    const {
        htmlPerf,
        ready,
        state: perfState,
        actions: perfActions,
    } = usePerf({
        perf,
        bookId,
        docSetId,
    });

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case MessageType.SCROLL_TO_CHAPTER:
                    {
                        console.log("scroll to chapter received", event.data.payload);
                        const element = document.getElementById(`ch-${event.data.payload.chapter}`);
                        element?.scrollIntoView({ behavior: "smooth" });
                        console.log("chapterElement", element);
                    }
                    break;
            }
        });
        // console.log("sending message to extension");
        // vscode.postMessage({
        //     type: MessageType.GET_USFM,
        //     payload: "usfmExplorer",
        // });
    }, [chapter]);

    useDeepCompareEffect(() => {
        if (htmlPerf && htmlPerf.mainSequenceId !== state.sequenceIds[0]) {
            actions.setSequenceIds([htmlPerf?.mainSequenceId]);
        }
    }, [htmlPerf, state.sequenceIds, bookId]);

    const _props = {
        ...state,
        ...perfState,
        ...actions,
        ...perfActions,
        htmlPerf,
        ready,
    };
    // console.log({ _props });

    return (
        <div className="layout">
            <div className="flex m-3 gap-2">
                <Editor {..._props} />
            </div>
        </div>
    );
}
