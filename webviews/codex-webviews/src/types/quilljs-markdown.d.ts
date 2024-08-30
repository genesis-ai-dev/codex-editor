declare module "quilljs-markdown" {
    import Quill from "quill";

    interface QuillMarkdownOptions {
        ignoreTags?: string[];
        tags?: {
            [key: string]: {
                pattern: RegExp;
            };
        };
    }

    class QuillMarkdown {
        constructor(quill: Quill, options?: QuillMarkdownOptions);
    }

    export default QuillMarkdown;
}
