import { describe, it, expect } from 'vitest';
import { applySegmentTranslationToParagraphBlock, mergeSplitCellTranslations } from '../common/contentSegmentUtils';

describe('Biblica surgical export', () => {
    const paragraphBlock = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>Original bold</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>Original plain</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`;

    it('should replace only changed Content inner text and preserve character styles', () => {
        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">Translated bold</span>' +
            '<span class="idml-eoc" data-eoc="1"></span>' +
            '<span class="idml-segment" data-segment-index="1">Original plain</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            paragraphBlock,
            html,
            ['Original bold', 'Original plain']
        );

        expect(result).toContain('<Content>Translated bold</Content>');
        expect(result).toContain('<Content>Original plain</Content>');
        expect(result).toContain('bold%3astyle');
        expect(result).not.toContain('Original bold');
    });

    it('should leave paragraph XML unchanged when translation matches originals', () => {
        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">Original bold</span>' +
            '<span class="idml-eoc" data-eoc="1"></span>' +
            '<span class="idml-segment" data-segment-index="1">Original plain</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            paragraphBlock,
            html,
            ['Original bold', 'Original plain']
        );

        expect(result).toBe(paragraphBlock);
    });

    it('merges split cell translations back onto one paragraph', () => {
        const originalSegments = ['First line', 'Second line'];
        const cellOne =
            '<p><span class="idml-segment" data-segment-index="0">Edited first</span></p>';
        const cellTwo =
            '<p><span class="idml-segment" data-segment-index="1">Edited second</span></p>';

        const mergedHtml = mergeSplitCellTranslations(
            [cellOne, cellTwo],
            originalSegments,
            [false, true]
        );

        const paragraphBlock = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>First line</Content>
        <Br />
        <Content>Second line</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`;

        const result = applySegmentTranslationToParagraphBlock(
            paragraphBlock,
            mergedHtml,
            originalSegments
        );

        expect(result).toContain('<Content>Edited first</Content>');
        expect(result).toContain('<Content>Edited second</Content>');
        expect(result).toContain('<Br');
    });

    it('clears structural apostrophe Content slots on export', () => {
        const apostropheParagraph = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>Israel</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/source%20serif">
        <Content>ʼ</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>s covenant history</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`;

        const originalSegments = ['Israel', 'ʼ', 's covenant history'];
        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">Zmluvné</span>' +
            '<span class="idml-eoc" data-eoc="1"></span>' +
            '<span class="idml-segment" data-segment-index="2">dejiny Izraela</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            apostropheParagraph,
            html,
            originalSegments,
            undefined,
            [1]
        );

        expect(result).toContain('<Content>Zmluvné</Content>');
        expect(result).toContain('<Content>dejiny Izraela</Content>');
        expect(result).toContain('<Content></Content>');
        expect(result).not.toContain('<Content>ʼ</Content>');
    });
});
