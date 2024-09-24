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
            return text.split(/[\s\p{P}]+/u);
        case "words":
            return text.match(/\b\w+\b/g) || [];
        case "words_and_punctuation":
            return text.match(/\w+|[^\w\s]/g) || [];
        case "lines":
            return text.split(/\n+/);
        case "lines_and_punctuation":
            return text.match(/[^\n]+|[^\w\s]/g) || [];
        default:
            return text.split(/\s+/);
    }
}
