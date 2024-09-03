import { remark } from "remark";
import remarkHtml from "remark-html";

import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkStringify from "remark-stringify";

export function markdownToHtml(markdownText: string) {
    const file = remark().use(remarkHtml).processSync(markdownText);
    return String(file);
}

export function htmlToMarkdown(htmlText: string) {
    const file = remark()
        .use(rehypeParse, { emitParseErrors: true, duplicateAttribute: false })
        .use(rehypeRemark)
        .use(remarkStringify)
        .processSync(htmlText);

    return String(file);
}
