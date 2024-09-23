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

export function tokenizeText({ method, text }: TokenizeTextOptions): string[] {
    switch (method) {
        case "whitespace":
            return text.split(/\s+/);
        case "whitespace_and_punctuation":
            return text.split(/\s+|[^\w\s]+/);
        case "words":
            return text.split(/\b\w+\b/);
        case "words_and_punctuation":
            return text.split(/\b\w+\b|[^\w\s]+/);
        case "lines":
            return text.split(/\n+/);
        case "lines_and_punctuation":
            return text.split(/\n+|[^\w\s]+/);
        default:
            return text.split(/\s+/);
    }
}
