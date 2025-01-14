interface TokenizeTextOptions {
    method:
        | "whitespace"
        | "whitespace_and_punctuation"
        | "words"
        | "words_and_punctuation"
        | "lines"
        | "lines_and_punctuation";
    text: string;
}

// Common HTML whitespace characters
const HTML_WHITESPACE = ["&nbsp;", "&ensp;", "&emsp;", "&thinsp;", "&zwnj;", "&zwj;"];
const HTML_WHITESPACE_PATTERN = new RegExp(HTML_WHITESPACE.join("|"));

export function tokenizeText({ method, text }: TokenizeTextOptions): string[] {
    switch (method) {
        case "whitespace":
            return text.split(new RegExp(`\\s+|${HTML_WHITESPACE_PATTERN.source}|\\n`));
        case "whitespace_and_punctuation":
            return text.split(new RegExp(`[\\s\\p{P}]+|${HTML_WHITESPACE_PATTERN.source}`, "u"));
        case "words":
            return text.replace(HTML_WHITESPACE_PATTERN, " ").match(/\b\w+\b/g) || [];
        case "words_and_punctuation":
            return text.replace(HTML_WHITESPACE_PATTERN, " ").match(/\w+|[^\w\s]/g) || [];
        case "lines":
            return text.split(/\n+/);
        case "lines_and_punctuation":
            return text
                .split(/\n/)
                .flatMap(
                    (line) => line.replace(HTML_WHITESPACE_PATTERN, " ").match(/\w+|[^\w\s]/g) || []
                );
        default:
            return text.split(new RegExp(`\\s+|${HTML_WHITESPACE_PATTERN.source}`));
    }
}
