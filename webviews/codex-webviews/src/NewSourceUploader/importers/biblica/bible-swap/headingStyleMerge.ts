/**
 * Copy Bible heading-role paragraph styles into the Study IDML style sheet.
 *
 * Structure swap inserts Portuguese `title:s1` (and the rest of the `title:*`
 * heading family) as whole paragraphs. The Study package only defines the
 * equivalent `head:s1` styles, so InDesign treats `title:s1` as missing and
 * falls back to body text (Charis SIL Regular) — dropping both Source Sans 3
 * and the nested Semibold (`#base.bd`) that the Bible uses.
 *
 * The Study already has `#base.title` (Myriad Pro, for `title:mt*` book
 * titles). Copied heading styles therefore keep their Bible BasedOn, but the
 * Bible's resolved AppliedFont is stamped on so they do not inherit the
 * Study's different title font.
 */

import { isHeadingRoleTitleStyle } from "./paragraphStyleRoles";

interface StyleRecord {
    self: string;
    block: string;
    basedOn?: string;
    appliedFont?: string;
}

export function mergeBibleHeadingStylesIntoStudyStylesXml(
    studyStylesXml: string,
    bibleStylesXml: string
): string {
    if (!studyStylesXml || !bibleStylesXml) {
        return studyStylesXml;
    }

    const studyStyles = extractNamedBlocks(studyStylesXml, "ParagraphStyle");
    const bibleStyles = extractNamedBlocks(bibleStylesXml, "ParagraphStyle");
    const toInsert: string[] = [];

    for (const [self, bible] of bibleStyles) {
        if (!isHeadingRoleTitleStyle(self) || studyStyles.has(self)) {
            continue;
        }

        let block = bible.block;
        const basedOn = bible.basedOn;
        if (basedOn && studyStyles.has(basedOn) && !isHeadingRoleTitleStyle(basedOn)) {
            const bibleFont = resolveAppliedFont(self, bibleStyles);
            const studyBaseFont = resolveAppliedFont(basedOn, studyStyles);
            if (bibleFont && bibleFont !== studyBaseFont) {
                block = stampAppliedFont(block, bibleFont);
            }
        }
        toInsert.push(block);
    }

    if (toInsert.length === 0) {
        return studyStylesXml;
    }

    return insertParagraphStyles(studyStylesXml, toInsert);
}

function extractNamedBlocks(xml: string, tagName: string): Map<string, StyleRecord> {
    const map = new Map<string, StyleRecord>();
    const openRe = new RegExp(`<${tagName}\\b`, "gi");
    let match: RegExpExecArray | null;

    while ((match = openRe.exec(xml))) {
        const start = match.index;
        const afterOpen = xml.indexOf(">", start);
        if (afterOpen < 0) {
            break;
        }

        const openTag = xml.slice(start, afterOpen + 1);
        const self = openTag.match(/\bSelf="([^"]+)"/)?.[1];
        let end = afterOpen + 1;
        if (!openTag.endsWith("/>")) {
            const close = `</${tagName}>`;
            const closeAt = xml.indexOf(close, afterOpen);
            if (closeAt < 0) {
                break;
            }
            end = closeAt + close.length;
        }

        openRe.lastIndex = end;
        if (!self) {
            continue;
        }

        const block = xml.slice(start, end);
        map.set(self, {
            self,
            block,
            basedOn: block.match(/<BasedOn\b[^>]*>([^<]+)<\/BasedOn>/)?.[1],
            appliedFont: block.match(/<AppliedFont\b[^>]*>([^<]+)<\/AppliedFont>/)?.[1],
        });
    }

    return map;
}

function resolveAppliedFont(
    self: string,
    styles: Map<string, StyleRecord>
): string | undefined {
    const seen = new Set<string>();
    let current: string | undefined = self;

    while (current && !seen.has(current)) {
        seen.add(current);
        const entry = styles.get(current);
        if (!entry) {
            return undefined;
        }
        if (entry.appliedFont) {
            return entry.appliedFont;
        }
        current = entry.basedOn;
    }

    return undefined;
}

function stampAppliedFont(block: string, font: string): string {
    if (/<AppliedFont\b/.test(block)) {
        return block;
    }

    const stamped = `\t<AppliedFont type="string">${font}</AppliedFont>\n`;
    if (/<\/Properties>/.test(block)) {
        return block.replace(
            /<\/Properties>(\s*)<\/ParagraphStyle>/,
            `${stamped}\t\t\t\t</Properties>$1</ParagraphStyle>`
        );
    }

    return block.replace(
        /<\/ParagraphStyle>/,
        `<Properties>\n${stamped}\t\t\t</Properties>\n\t\t</ParagraphStyle>`
    );
}

function insertParagraphStyles(studyStylesXml: string, blocks: string[]): string {
    const joined = blocks.join("\n");
    const titleGroup = /<ParagraphStyleGroup\b[^>]*Self="ParagraphStyleGroup\/\$ID\/title"[^>]*>/i.exec(
        studyStylesXml
    );
    if (titleGroup && titleGroup.index !== undefined) {
        const closeAt = studyStylesXml.indexOf(
            "</ParagraphStyleGroup>",
            titleGroup.index + titleGroup[0].length
        );
        if (closeAt >= 0) {
            return (
                studyStylesXml.slice(0, closeAt) +
                joined +
                "\n\t\t" +
                studyStylesXml.slice(closeAt)
            );
        }
    }

    const rootClose = studyStylesXml.lastIndexOf("</RootParagraphStyleGroup>");
    if (rootClose >= 0) {
        return studyStylesXml.slice(0, rootClose) + joined + "\n\t" + studyStylesXml.slice(rootClose);
    }

    return `${studyStylesXml}\n${joined}`;
}
