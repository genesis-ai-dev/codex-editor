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

export const markdownToHTML = (markdown: MarkdownString) =>
    DOMPurify.sanitize(marked.parse(markdown) as HTMLString);
