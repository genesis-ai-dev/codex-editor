import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export type IdmlSegmentSeparator = "none" | "continuation" | "line-break";

export interface IdmlTranslationSegment {
    index: number;
    sourceText: string;
    characterStyle?: string;
    separatorBefore: IdmlSegmentSeparator;
}

interface LocatedIdmlTranslationSegment extends IdmlTranslationSegment {
    contentStart: number;
    contentEnd: number;
}

export interface IdmlStructuredSource {
    sourceHtml: string;
    segments: LocatedIdmlTranslationSegment[];
}

export type StructuredResponseFormat = NonNullable<
    ChatCompletionCreateParamsNonStreaming["response_format"]
>;

interface StructuredTranslationItem {
    index: number;
    translation: string;
}

const readAttribute = (tag: string, name: string): string | undefined => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = tag.match(
        new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`, "i"),
    );
    return match?.[1] ?? match?.[2] ?? match?.[3];
};

const decodeHtmlText = (text: string): string =>
    text
        .replace(/&#x([0-9a-f]+);/gi, (entity, value: string) => {
            const codePoint = Number.parseInt(value, 16);
            try {
                return Number.isInteger(codePoint) && codePoint <= 0x10ffff
                    ? String.fromCodePoint(codePoint)
                    : entity;
            } catch {
                return entity;
            }
        })
        .replace(/&#(\d+);/g, (entity, value: string) => {
            const codePoint = Number.parseInt(value, 10);
            try {
                return Number.isInteger(codePoint) && codePoint <= 0x10ffff
                    ? String.fromCodePoint(codePoint)
                    : entity;
            } catch {
                return entity;
            }
        })
        .replace(/&nbsp;/gi, "\u00a0")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");

const escapeHtmlText = (text: string): string =>
    text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const containsHtmlTag = (value: string): boolean => /<\/?[a-zA-Z][^>]*>|<!--|<!DOCTYPE/i.test(value);

const separatorBetween = (html: string): IdmlSegmentSeparator => {
    if (/<br\b[^>]*\bclass\s*=\s*(?:"[^"]*\bidml-eoc\b[^"]*"|'[^']*\bidml-eoc\b[^']*')[^>]*\/?>/i.test(html)) {
        return "line-break";
    }
    return "continuation";
};

/**
 * Extract the editable IDML text slots while retaining byte ranges into the
 * original HTML. Returning null deliberately opts callers back into the legacy
 * completion path when the fragment is malformed or contains unsupported
 * nested markup.
 */
export const extractIdmlStructuredSource = (sourceHtml: string): IdmlStructuredSource | null => {
    if (!sourceHtml || !sourceHtml.includes("idml-segment")) return null;

    const tagRegex = /<\/?span\b[^>]*>/gi;
    const stack: Array<{ openingTag: string; contentStart: number; isIdmlSegment: boolean; }> = [];
    const located: LocatedIdmlTranslationSegment[] = [];
    const seenIndexes = new Set<number>();
    let idmlOpeningCount = 0;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(sourceHtml)) !== null) {
        const tag = match[0];
        const isClosing = /^<\s*\/span/i.test(tag);
        const isSelfClosing = /\/\s*>$/.test(tag);

        if (!isClosing) {
            const className = readAttribute(tag, "class") ?? "";
            const isIdmlSegment = className.split(/\s+/).includes("idml-segment");
            if (isIdmlSegment) idmlOpeningCount++;
            if (!isSelfClosing) {
                stack.push({
                    openingTag: tag,
                    contentStart: tagRegex.lastIndex,
                    isIdmlSegment,
                });
            } else if (isIdmlSegment) {
                return null;
            }
            continue;
        }

        const opening = stack.pop();
        if (!opening) return null;
        if (!opening.isIdmlSegment) continue;

        const indexText = readAttribute(opening.openingTag, "data-segment-index");
        const index = indexText === undefined ? Number.NaN : Number(indexText);
        const innerHtml = sourceHtml.slice(opening.contentStart, match.index);
        if (!Number.isSafeInteger(index) || index < 0 || seenIndexes.has(index) || containsHtmlTag(innerHtml)) {
            return null;
        }

        seenIndexes.add(index);
        located.push({
            index,
            sourceText: decodeHtmlText(innerHtml),
            characterStyle: readAttribute(opening.openingTag, "data-character-style"),
            separatorBefore: "none",
            contentStart: opening.contentStart,
            contentEnd: match.index,
        });
    }

    if (stack.length > 0 || located.length === 0 || located.length !== idmlOpeningCount) return null;

    located.sort((left, right) => left.contentStart - right.contentStart);
    for (let i = 1; i < located.length; i++) {
        located[i].separatorBefore = separatorBetween(
            sourceHtml.slice(located[i - 1].contentEnd, located[i].contentStart),
        );
    }

    return { sourceHtml, segments: located };
};

export const buildIdmlStructuredResponseFormat = (
    source: IdmlStructuredSource,
): StructuredResponseFormat => ({
    type: "json_schema",
    json_schema: {
        name: "idml_segment_translation",
        description: "A translation for every indexed IDML text segment.",
        strict: true,
        schema: {
            type: "object",
            additionalProperties: false,
            properties: {
                segments: {
                    type: "array",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            index: {
                                type: "integer",
                                enum: source.segments.map((segment) => segment.index),
                            },
                            translation: { type: "string" },
                        },
                        required: ["index", "translation"],
                    },
                },
            },
            required: ["segments"],
        },
    },
});

const parseStructuredResponse = (content: string): unknown => {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
    return JSON.parse(fenced?.[1]?.trim() ?? trimmed);
};

const validateTranslations = (
    value: unknown,
    source: IdmlStructuredSource,
): Map<number, string> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Structured translation response is not an object.");
    }

    const response = value as { segments?: unknown; };
    if (!Array.isArray(response.segments) || response.segments.length !== source.segments.length) {
        throw new Error("Structured translation response has the wrong segment count.");
    }

    const requiredIndexes = new Set(source.segments.map((segment) => segment.index));
    const translations = new Map<number, string>();
    for (const item of response.segments) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error("Structured translation response contains an invalid segment.");
        }
        const { index, translation } = item as Partial<StructuredTranslationItem>;
        if (!Number.isSafeInteger(index) || !requiredIndexes.has(index!) || typeof translation !== "string") {
            throw new Error("Structured translation response contains an unknown index or invalid text.");
        }
        if (translations.has(index!)) {
            throw new Error(`Structured translation response repeats segment ${index}.`);
        }
        translations.set(index!, translation);
    }

    if ([...requiredIndexes].some((index) => !translations.has(index))) {
        throw new Error("Structured translation response is missing a required segment.");
    }
    const sourceHasText = source.segments.some((segment) => segment.sourceText.trim().length > 0);
    const translationHasText = [...translations.values()].some((translation) => translation.trim().length > 0);
    if (sourceHasText && !translationHasText) {
        throw new Error("Structured translation response is empty.");
    }

    return translations;
};

/** Rebuild translated HTML by replacing text nodes only; all source markup remains byte-for-byte intact. */
export const reconstructIdmlTranslationHtml = (
    source: IdmlStructuredSource,
    responseContent: string,
): string => {
    const translations = validateTranslations(parseStructuredResponse(responseContent), source);
    let result = source.sourceHtml;

    for (const segment of [...source.segments].sort((left, right) => right.contentStart - left.contentStart)) {
        const translatedText = translations.get(segment.index);
        if (translatedText === undefined) {
            throw new Error(`Structured translation response is missing segment ${segment.index}.`);
        }
        result =
            result.slice(0, segment.contentStart) +
            escapeHtmlText(translatedText) +
            result.slice(segment.contentEnd);
    }

    return result;
};
