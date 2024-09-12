import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * A string containing markdown content
 */
type MarkdownString = string;

/**
 * A string representing HTML content
 */
type HTMLString = string;

export const markdownToHTML = (markdown: MarkdownString): HTMLString => {
    console.log("markdown", markdown);
    const renderer = new marked.Renderer();
    renderer.paragraph = (text) => `${text}`;

    const html = marked.parse(markdown, { renderer }) as HTMLString;
    return DOMPurify.sanitize(html);
};
