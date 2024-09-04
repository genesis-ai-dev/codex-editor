import { useRef, useState } from "react";
import ReactQuill from "react-quill";

import "react-quill/dist/quill.snow.css";

export interface EditorContentChanged {
    html: string;
}

export interface EditorProps {
    value?: string;
    onChange?: (changes: EditorContentChanged) => void;
}

const TOOLBAR_OPTIONS = [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike", "blockquote", "link"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    ["clean"],
];

export default function Editor(props: EditorProps) {
    const [value, setValue] = useState<string>(props.value || "");
    const reactQuillRef = useRef<ReactQuill>(null);

    const onChange = (content: string) => {
        setValue(content);

        if (props.onChange) {
            // Parse the content and replace outer <p> with <span>
            const parsedContent = content.replace(
                /^<p>([\s\S]*)<\/p>$/,
                "<span>$1</span>",
            );
            props.onChange({
                html: parsedContent,
            });
        }
    };

    return (
        <ReactQuill
            ref={reactQuillRef}
            theme="snow"
            placeholder="Start writing..."
            modules={{
                toolbar: {
                    container: TOOLBAR_OPTIONS,
                },
            }}
            value={value}
            onChange={onChange}
        />
    );
}
