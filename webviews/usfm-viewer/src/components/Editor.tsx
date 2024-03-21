import { HtmlPerfEditor } from "@xelah/type-perf-html";
import RecursiveBlock from "./RecursiveBlock";
import LoadingScreen from "./LoadingScreen";
import { Perf } from "@/types/perfType";
import { MessageType } from "@/types/types";
import { vscode } from "@/utilities/vscode";

interface EditorProps {
    sequenceIds: Array<string>;
    // isSaving: boolean;
    htmlPerf: Perf | undefined;
    sectionable: boolean;
    blockable: boolean;
    editable: boolean;
    preview: boolean;
    verbose: boolean;
    addSequenceId: (sequenceId: string) => void;
    // saveHtmlPerf: (htmlPerf: any) => void;
}
export default function Editor(props: EditorProps) {
    const {
        sequenceIds,
        // isSaving
        htmlPerf,
        sectionable,
        blockable,
        editable,
        preview,
        verbose,
        addSequenceId,
        // saveHtmlPerf,
    } = props;

    // const { state, actions } = useContext(ScribexContext);

    const sequenceId = sequenceIds.at(-1);
    // const style = isSaving ? { cursor: "progress" } : {};

    const handlers = {
        onBlockClick: ({ element }: { element: HTMLElement }) => {
            vscode.postMessage({
                type: MessageType.BLOCK_CLICK,
                payload: { action: "click" },
            });
            const { tagName } = element;
            if (tagName === "SPAN") {
                console.log("onBlockClick", { element });
            }
        },
    };
    function saveHtmlPerf(htmlPerf: Perf) {
        console.log({ htmlPerf });
    }

    const _props = {
        htmlPerf,
        onHtmlPerf: saveHtmlPerf,
        sequenceIds,
        addSequenceId,
        components: {
            block: (__props: any) =>
                RecursiveBlock({
                    htmlPerf,
                    onHtmlPerf: saveHtmlPerf,
                    sequenceIds,
                    addSequenceId,
                    ...__props,
                }),
        },
        options: {
            sectionable,
            blockable,
            editable,
            preview,
        },
        decorators: {},
        verbose,
        handlers,
    };

    return (
        <div
            style={{
                fontFamily: "roboto",
                fontSize: `${1}rem`,
                direction: "ltr",
                textAlign: "left",
            }}
            // className="border-l-2 border-r-2 border-secondary pb-16 overflow-auto h-full scrollbars-width leading-8"
        >
            <div id="bibleRefEditor" className="bibleRefEditor">
                {!sequenceId && <LoadingScreen />}
                {sequenceId && <HtmlPerfEditor {..._props} />}
            </div>
        </div>
    );
}
