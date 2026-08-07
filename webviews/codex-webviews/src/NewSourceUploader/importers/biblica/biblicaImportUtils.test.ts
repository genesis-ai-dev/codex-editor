import { describe, it, expect } from 'vitest';
import {
    isBiblicaFrontBackMatterDocument,
    isBiblicaMajorSectionHeadingStyle,
    isBiblicaNoteSectionStyle,
    isBiblicaRunningHeadStyle,
    isStructuralOnlyContent,
    splitSegmentsAtLineBreaks,
    getStructuralApostropheSegmentIndexes,
    isStructuralApostropheSegment,
    omitSegmentsAtIndexes,
    getVerseMarkerSegmentIndexes,
} from './biblicaImportUtils';
import { buildSegmentedParagraphHtml } from '../common/contentSegmentUtils';
import type { IDMLStory } from './types';

describe('biblicaImportUtils', () => {
    it('detects intro note styles', () => {
        expect(isBiblicaNoteSectionStyle('ParagraphStyle/intro%3aipi')).toBe(true);
        expect(isBiblicaNoteSectionStyle('ParagraphStyle/meta%3arh')).toBe(false);
    });

    it('detects major section headings and running heads', () => {
        expect(isBiblicaMajorSectionHeadingStyle('ParagraphStyle/head%3ams1')).toBe(true);
        expect(isBiblicaMajorSectionHeadingStyle('ParagraphStyle/head%3acl')).toBe(false);
        expect(isBiblicaRunningHeadStyle('ParagraphStyle/meta%3arh')).toBe(true);
        expect(isBiblicaRunningHeadStyle('ParagraphStyle/text%3am')).toBe(false);
    });

    it('recognises a front/back matter volume by the absence of verses', () => {
        const storyWith = (metadata: Record<string, unknown>): IDMLStory =>
            ({
                id: 'u363',
                paragraphs: [
                    {
                        paragraphStyleRange: {
                            appliedParagraphStyle: 'ParagraphStyle/text%3am',
                            properties: {},
                            content: 'text',
                        },
                        characterStyleRanges: [],
                        metadata,
                    },
                ],
            }) as unknown as IDMLStory;

        expect(isBiblicaFrontBackMatterDocument([storyWith({ biblicaVerseSegments: [] })])).toBe(
            true
        );
        expect(
            isBiblicaFrontBackMatterDocument([
                storyWith({
                    biblicaVerseSegments: [
                        { bookAbbreviation: 'MAT', chapterNumber: '1', verseNumber: '1' },
                    ],
                }),
            ])
        ).toBe(false);
        expect(
            isBiblicaFrontBackMatterDocument([storyWith({ isPartOfSpanningVerse: true })])
        ).toBe(false);
    });

    it('treats ACE-only content as structural', () => {
        expect(isStructuralOnlyContent(['\t<?ACE 18?><?ACE 8?>'])).toBe(true);
        expect(isStructuralOnlyContent(['Genesis'])).toBe(false);
    });

    it('splits segments at line breaks and preserves start indices', () => {
        const groups = splitSegmentsAtLineBreaks(
            ['Line one', 'Line two', 'Line three'],
            [false, true, true]
        );

        expect(groups).toHaveLength(3);
        expect(groups[0].startIndex).toBe(0);
        expect(groups[0].segments).toEqual(['Line one']);
        expect(groups[1].startIndex).toBe(1);
        expect(groups[1].segments).toEqual(['Line two']);
        expect(groups[2].startIndex).toBe(2);
        expect(groups[2].segments).toEqual(['Line three']);
    });

    it('detects structural apostrophe segments by style or content', () => {
        expect(
            isStructuralApostropheSegment('ʼ', 'CharacterStyle/source%20serif')
        ).toBe(true);
        expect(isStructuralApostropheSegment("'", 'CharacterStyle/$ID/[No character style]')).toBe(
            true
        );
        expect(isStructuralApostropheSegment('covenant', 'CharacterStyle/bold')).toBe(false);
    });

    it('collects apostrophe slot indexes and strips them from visible text', () => {
        const segments = ["Israel", "ʼ", "s covenant history"];
        const styles = [
            'CharacterStyle/$ID/[No character style]',
            'CharacterStyle/source%20serif',
            'CharacterStyle/$ID/[No character style]',
        ];
        const indexes = getStructuralApostropheSegmentIndexes(segments, styles);
        expect(indexes).toEqual([1]);
        expect(omitSegmentsAtIndexes(segments, indexes)).toEqual([
            'Israel',
            's covenant history',
        ]);
    });

    it('detects chapter/verse marker slots by character style', () => {
        // Matthew's closing 28:20 markers, flushed into Mark's intro:ie paragraph.
        const segments = ['28:', '20'];
        const styles = ['CharacterStyle/meta%3ac', 'CharacterStyle/meta%3av'];

        expect(getVerseMarkerSegmentIndexes(segments, styles)).toEqual([0, 1]);
        expect(omitSegmentsAtIndexes(segments, [0, 1])).toEqual([]);
    });

    it('does not mistake other meta styles for verse markers', () => {
        expect(
            getVerseMarkerSegmentIndexes(
                ['Matthew', 'Mt', '3'],
                [
                    'CharacterStyle/meta%3arh',
                    'CharacterStyle/meta%3atoc3',
                    'CharacterStyle/cv%3adc',
                ]
            )
        ).toEqual([]);
    });

    it('omits apostrophe segments from editor HTML while preserving indices', () => {
        const segments = ['Zmluvné', 'ʼ', 'dejiny'];
        const styles = [
            'CharacterStyle/bold',
            'CharacterStyle/source%20serif',
            'CharacterStyle/bold',
        ];
        const skipIndexes = getStructuralApostropheSegmentIndexes(segments, styles);
        const html = buildSegmentedParagraphHtml(segments, 'ParagraphStyle/intro%3aipi', 'u123', styles, [false, false, false], {
            skipSegmentIndexes: skipIndexes,
        });

        expect(html).toContain('data-segment-index="0"');
        expect(html).toContain('data-segment-index="2"');
        expect(html).not.toContain('data-segment-index="1"');
        expect(html).not.toContain('ʼ');
        expect(html).toContain('data-segment-count="3"');
    });
});
