import { describe, it, expect } from 'vitest';
import {
    isBiblicaNoteSectionStyle,
    isStructuralOnlyContent,
    splitSegmentsAtLineBreaks,
    getStructuralApostropheSegmentIndexes,
    isStructuralApostropheSegment,
    stripStructuralApostropheSegments,
} from './biblicaImportUtils';
import { buildSegmentedParagraphHtml } from '../common/contentSegmentUtils';

describe('biblicaImportUtils', () => {
    it('detects intro note styles', () => {
        expect(isBiblicaNoteSectionStyle('ParagraphStyle/intro%3aipi')).toBe(true);
        expect(isBiblicaNoteSectionStyle('ParagraphStyle/meta%3arh')).toBe(false);
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
        expect(stripStructuralApostropheSegments(segments, indexes)).toEqual([
            'Israel',
            's covenant history',
        ]);
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
