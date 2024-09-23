import { HtmlPerfEditor } from "@xelah/type-perf-html";
import { getTarget } from "@/utilities/getTarget";

interface RecursiveBlockProps {
    htmlPerf: any;
    onHtmlPerf: (htmlPerf: any) => void;
    sequenceIds: Array<string>;
    addSequenceId: (sequenceId: string) => void;
    options: any;
    content: string;
    style: any;
    contentEditable: boolean;
    index: number;
    verbose: boolean;
    setFootNote: (footNote: string) => void;
    bookId: string;
    onReferenceSelected: (reference: string) => void;
    setCaretPosition: (position: number) => void;
    setSelectedText: (text: string) => void;
    scrollLock: boolean;
}

export default function RecursiveBlock({
    htmlPerf,
    onHtmlPerf,
    sequenceIds,
    addSequenceId,
    options,
    content,
    contentEditable,

    ...props
}: RecursiveBlockProps) {
    let component;

    const editable = !!content.match(/data-type="paragraph"/);

    if (editable) {
        component = (
            <div className="editor-paragraph" contentEditable={contentEditable} {...props} />
        );
    }
    if (!editable) {
        const sequenceId = getTarget({ content });

        if (sequenceId && !options.preview) {
            const _props = {
                sequenceIds: [...sequenceIds, sequenceId],
                addSequenceId,
                htmlPerf,
                onHtmlPerf,
                // onInput: props?.onInput,
                options,
            };
            component = <HtmlPerfEditor {..._props} />;
        }
        component ||= <div {...props} contentEditable={false} />;
    }
    return <>{component}</>;
}
