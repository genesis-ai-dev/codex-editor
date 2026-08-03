/**
 * Paragraph-style role canonicalization for Bible Swap.
 *
 * The Biblica IDMLs disagree on the prefix used for heading-role paragraphs.
 * The English study files tag them `head:*`, while the Portuguese Bible tags the
 * very same roles `title:*`:
 *
 * | role                  | study        | Portuguese Bible  |
 * |-----------------------|--------------|-------------------|
 * | section title         | `head:s1`    | `title:s1`        |
 * | parallel reference    | —            | `title:r_h`       |
 * | Psalm chapter label   | `head:cl`    | `title:cl`        |
 * | Psalm superscription  | `head:d_h`   | `title:d_h`       |
 * | speaker label (SNG)   | `head:sp`    | `title:sp`        |
 * | acrostic letter       | `head:qa`    | `title:qa`        |
 * | major section         | `head:ms1`   | `title:ms1`       |
 *
 * `title:mt*` is the one genuine exception — that is the book's main title, not
 * a heading inside a chapter, and it must stay excluded from chapter blocks.
 *
 * Every style predicate in the swap is written against `head:`, so the prefix is
 * canonicalized where paragraphs are first read (`iterateParagraphsInRange`).
 * Without this, the Portuguese Bible's section headings, Psalm superscriptions,
 * chapter labels and Song of Songs speaker labels are all classified as
 * intro/title junk and silently dropped from the swapped output.
 */

/**
 * `title:`/`title%3a` acting as a heading prefix, i.e. everything except the
 * `mt*` book title. Matches at the start of the style name or after a `/`, so
 * both bare and `ParagraphStyle/`-qualified names are handled.
 */
const HEADING_TITLE_PREFIX = /(^|\/)title(%3a|:)(?!mt)/gi;

/** Rewrite heading-role `title:*` styles to their `head:*` equivalent. */
export function canonicalizeParagraphStyle(style: string): string {
    if (!style || !/title/i.test(style)) return style;
    return style.replace(
        HEADING_TITLE_PREFIX,
        (_match, lead: string, separator: string) => `${lead}head${separator}`
    );
}
