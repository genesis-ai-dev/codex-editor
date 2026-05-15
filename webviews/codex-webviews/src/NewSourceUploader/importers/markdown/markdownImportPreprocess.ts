/**
 * Markdown round-trip: single newlines inside a paragraph block are not line breaks in
 * CommonMark unless they are hard breaks (`  \n`). Without this, `marked` collapses them
 * into one `<p>` and export loses per-line layout (labels, IN/OUT blocks, etc.).
 */
export function preprocessParagraphForHardLineBreaks(markdown: string): string {
    return markdown.replace(/([^\n])\n(?!\n)/g, "$1  \n");
}
