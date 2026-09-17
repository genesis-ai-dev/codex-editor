import { describe, it, expect } from 'vitest';
import {
    applySegmentTranslationToParagraphBlock,
    expandForceClearWithUntranslatedFollowers,
    findAbandonedSegmentIndexes,
    mergeSplitCellTranslations,
    moveBoldPunctuationSpilloverToBody,
    moveReferenceRunSpilloverToBody,
} from '../common/contentSegmentUtils';

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

    it('clears the untranslated English tail after a structural apostrophe', () => {
        const apostropheParagraph = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>Aaron</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/source%20serif">
        <Content>ʼ</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>s walking stick</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`;

        const originalSegments = ['Aaron', 'ʼ', 's walking stick'];
        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">O cajado de Arão:</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            apostropheParagraph,
            html,
            originalSegments,
            undefined,
            [1]
        );

        expect(result).toContain('<Content>O cajado de Arão:</Content>');
        expect(result).toContain('<Content></Content>');
        expect(result).not.toContain('s walking stick');
        expect(result).not.toContain('<Content>ʼ</Content>');
    });

    it('clears a leftover tail that is still English even when its span is present', () => {
        const apostropheParagraph = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>God</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/source%20serif">
        <Content>ʼ</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>s people</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`;

        const originalSegments = ['God', 'ʼ', 's people'];
        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">O povo de Deus</span>' +
            '<span class="idml-eoc" data-eoc="1"></span>' +
            '<span class="idml-segment" data-segment-index="2">s people</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            apostropheParagraph,
            html,
            originalSegments,
            undefined,
            [1]
        );

        expect(result).toContain('<Content>O povo de Deus</Content>');
        expect(result).not.toContain('s people');
    });
});

describe('key-term runs folded into one translated slot', () => {
    // JOS-EST note "9:10 – 11:43": IDML splits "Ahijah the prophet" into a
    // key-term slot, a plain slot and another key-term slot.
    const prophetParagraph = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/k_xt">
        <Content>Ahijah</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content> the </Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/k_xt">
        <Content>prophet</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content> to be king over ten of the tribes.</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`;

    const originalSegments = [
        'Ahijah',
        ' the ',
        'prophet',
        ' to be king over ten of the tribes.',
    ];

    it('drops the English runs the translator folded into the first slot', () => {
        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">Aías</span>' +
            '<span class="idml-eoc" data-eoc="1"></span>' +
            '<span class="idml-segment" data-segment-index="3">para ser rei sobre dez das tribos.</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            prophetParagraph,
            html,
            originalSegments
        );

        expect(result).toContain('<Content>Aías</Content>');
        expect(result).toContain('<Content>para ser rei sobre dez das tribos.</Content>');
        expect(result).not.toContain('prophet');
        expect(result).not.toContain(' the ');
        expect(result).toContain('k_xt');
    });

    it('keeps the source text when nothing after the gap was translated', () => {
        // No translated slot follows, so this reads as a mapping failure rather
        // than a deliberate merge: dropping the text would lose it silently.
        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">Aías</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            prophetParagraph,
            html,
            originalSegments
        );

        expect(result).toContain('<Content>prophet</Content>');
        expect(result).toContain('<Content> to be king over ten of the tribes.</Content>');
    });
});

describe('bold punctuation trimmed off a key-term slot on export', () => {
    const davidParagraph = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/k_xt">
        <Content>David</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>. The king of Israel.</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`;

    it('writes the leftover period into the following plain Content slot', () => {
        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">Davi.</span>' +
            '<span class="idml-eoc" data-eoc="1"></span>' +
            '<span class="idml-segment" data-segment-index="1"> O rei de Israel.</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            davidParagraph,
            html,
            ['David', '. The king of Israel.']
        );

        expect(result).toContain('<Content>Davi</Content>');
        expect(result).toContain('<Content>. O rei de Israel.</Content>');
        expect(result).not.toContain('<Content>Davi.</Content>');
        expect(result).toContain('k_xt');
    });

    it('does not rewrite a heading whose two bold slots already match', () => {
        const headingParagraph = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aimt1">
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>1:1–31</Content>
    </CharacterStyleRange>
    <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bold%3astyle">
        <Content>Isaiah</Content>
    </CharacterStyleRange>
</ParagraphStyleRange>`;

        const html =
            '<p class="indesign-paragraph">' +
            '<span class="idml-segment" data-segment-index="0">1:1–31</span>' +
            '<span class="idml-eoc" data-eoc="1"></span>' +
            '<span class="idml-segment" data-segment-index="1">Isaías</span>' +
            '</p>';

        const result = applySegmentTranslationToParagraphBlock(
            headingParagraph,
            html,
            ['1:1–31', 'Isaiah']
        );

        expect(result).toContain('<Content>1:1–31</Content>');
        expect(result).toContain('<Content>Isaías</Content>');
        expect(result).toContain('bold%3astyle');
    });
});

describe('folded runs in paragraphs split across cells', () => {
    const originalSegments = ['North­ern king­dom:', ' The land of Israel', 'Judah:', ' The south'];
    // One cell per glossary entry, split at the line break before index 2.
    const ranges = [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
    ];

    it('blanks a slot the translator emptied inside its own cell', () => {
        const cellOne =
            '<p><span class="idml-segment" data-segment-index="0"></span>' +
            '<span class="idml-segment" data-segment-index="1">Reino do norte: a terra de Israel</span></p>';
        const cellTwo =
            '<p><span class="idml-segment" data-segment-index="2">Judá:</span>' +
            '<span class="idml-segment" data-segment-index="3"> o sul</span></p>';

        const merged = mergeSplitCellTranslations(
            [cellOne, cellTwo],
            originalSegments,
            [false, false, true, false],
            ranges
        );

        expect(merged).not.toContain('North­ern king­dom:');
        expect(merged).toContain('Reino do norte: a terra de Israel');
        expect(merged).toContain('Judá:');
    });

    it('keeps slots owned by a cell that was never translated', () => {
        const cellTwo =
            '<p><span class="idml-segment" data-segment-index="2">Judá:</span>' +
            '<span class="idml-segment" data-segment-index="3"> o sul</span></p>';

        const merged = mergeSplitCellTranslations(
            ['', cellTwo],
            originalSegments,
            [false, false, true, false],
            ranges
        );

        expect(merged).toContain('North­ern king­dom:');
        expect(merged).toContain('Judá:');
    });
});

describe('findAbandonedSegmentIndexes', () => {
    it('reports only the gaps enclosed by translated slots', () => {
        expect(
            findAbandonedSegmentIndexes(
                ['Ahijah', ' the ', 'prophet', ' to be king.'],
                ['Aías', '', '', 'para ser rei.']
            )
        ).toEqual([1, 2]);
    });

    it('leaves a leading gap alone', () => {
        expect(
            findAbandonedSegmentIndexes(
                ['Ahijah', ' the ', 'prophet'],
                ['', '', 'profeta']
            )
        ).toEqual([]);
    });

    it('keeps the source for slots the cell never rendered a span for', () => {
        expect(
            findAbandonedSegmentIndexes(
                ['Ahijah', ' the ', 'prophet'],
                ['Aías']
            )
        ).toEqual([]);
    });

    it('reports a tail the translation ran out of slots for', () => {
        // Apostrophe splits give the English more slots than the translation uses,
        // so the last runs come back empty even though the text is fully translated.
        expect(
            findAbandonedSegmentIndexes(
                ['. But among ', 'God', 'ʼ', 's', ' people who fasted.'],
                ['. Mas entre o povo de ', 'Deus que jejuava.', '', '', '']
            )
        ).toEqual([2, 3, 4]);
    });

    it('never clears preserved slots such as verse delimiters', () => {
        expect(
            findAbandonedSegmentIndexes(
                ['Some prose', '28', 'more prose'],
                ['Algum texto', '', 'mais texto'],
                [1]
            )
        ).toEqual([]);
    });
});

describe('moveReferenceRunSpilloverToBody', () => {
    it('hands the note body back the word that landed in the reference run', () => {
        expect(
            moveReferenceRunSpilloverToBody(
                ['4:1 – 5:32 A ', 'linhagem ', 'de Adão.'],
                ['4:1 – 5:32', ' The ', 'lineage of Adam.']
            )
        ).toEqual(['4:1 – 5:32', ' A linhagem ', 'de Adão.']);
    });

    it('leaves a reference run the translation kept clean', () => {
        const segments = ['4:1 – 5:32', ' A linhagem ', 'de Adão.'];
        expect(
            moveReferenceRunSpilloverToBody(segments, ['4:1 – 5:32', ' The ', 'lineage of Adam.'])
        ).toEqual(segments);
    });

    it('ignores runs whose reference did not survive in place', () => {
        // A wholly shifted paragraph needs realignment, not this local repair.
        const segments = ['dos tessalonicenses', ' (1).'];
        expect(moveReferenceRunSpilloverToBody(segments, ['(1)', '.'])).toEqual(segments);
    });

    it('keeps punctuation-only runs out of it', () => {
        const segments = ['linhagens ', 'familiares '];
        expect(moveReferenceRunSpilloverToBody(segments, [', ', 'Shem'])).toEqual(segments);
    });

    it('will not overwrite a body run that still falls back to English', () => {
        const segments = ['4:1 – 5:32 A ', ''];
        expect(moveReferenceRunSpilloverToBody(segments, ['4:1 – 5:32', ' The '])).toEqual(segments);
    });

    it('skips blocked destinations such as verse delimiters', () => {
        const segments = ['4:1 – 5:32 A ', 'linhagem '];
        expect(
            moveReferenceRunSpilloverToBody(segments, ['4:1 – 5:32', ' The '], new Set([1]))
        ).toEqual(segments);
    });
});

describe('moveBoldPunctuationSpilloverToBody', () => {
    const keyTermThenPlain = ['CharacterStyle/k_xt', 'CharacterStyle/$ID/[No character style]'];
    const twoBoldHeading = ['CharacterStyle/bold%3astyle', 'CharacterStyle/bold%3astyle'];

    it('hands the leftover period back to the plain run after a key term', () => {
        expect(
            moveBoldPunctuationSpilloverToBody(
                ['Davi.', ' O rei'],
                ['David', ' The king'],
                undefined,
                keyTermThenPlain
            )
        ).toEqual(['Davi', '. O rei']);
    });

    it('hands the leftover comma back to the plain run after a key term', () => {
        expect(
            moveBoldPunctuationSpilloverToBody(
                ['Jeoacaz,', ' rei de Judá'],
                ['Jehoahaz', ' king of Judah'],
                undefined,
                keyTermThenPlain
            )
        ).toEqual(['Jeoacaz', ', rei de Judá']);
    });

    it('strips leftover marks when the next run already opens with them', () => {
        expect(
            moveBoldPunctuationSpilloverToBody(
                ['Davi.', '. O rei'],
                ['David', '. The king'],
                undefined,
                keyTermThenPlain
            )
        ).toEqual(['Davi', '. O rei']);
    });

    it('leaves a key-term run the translation kept clean', () => {
        const segments = ['Davi', '. O rei'];
        expect(
            moveBoldPunctuationSpilloverToBody(
                segments,
                ['David', '. The king'],
                undefined,
                keyTermThenPlain
            )
        ).toEqual(segments);
    });

    it('leaves punctuation that was already on the English key-term run', () => {
        const segments = ['Davi.', ' The rest'];
        expect(
            moveBoldPunctuationSpilloverToBody(
                segments,
                ['David.', ' The rest'],
                undefined,
                keyTermThenPlain
            )
        ).toEqual(segments);
    });

    it('will not overwrite a following run that still falls back to English', () => {
        const segments = ['Davi.', ''];
        expect(
            moveBoldPunctuationSpilloverToBody(
                segments,
                ['David', '. The king'],
                undefined,
                keyTermThenPlain
            )
        ).toEqual(segments);
    });

    it('skips blocked destinations such as verse delimiters', () => {
        const segments = ['Davi.', ' O rei'];
        expect(
            moveBoldPunctuationSpilloverToBody(
                segments,
                ['David', ' The king'],
                new Set([1]),
                keyTermThenPlain
            )
        ).toEqual(segments);
    });

    it('does not move punctuation onto a second bold heading slot', () => {
        const segments = ['1:1–31', 'Isaías'];
        expect(
            moveBoldPunctuationSpilloverToBody(
                segments,
                ['1:1–31', 'Isaiah'],
                undefined,
                twoBoldHeading
            )
        ).toEqual(segments);
    });

    it('does not steal a leftover mark from a heading onto the next bold slot', () => {
        expect(
            moveBoldPunctuationSpilloverToBody(
                ['Isaías.', 'Profeta'],
                ['Isaiah', 'Prophet'],
                undefined,
                twoBoldHeading
            )
        ).toEqual(['Isaías.', 'Profeta']);
    });

    it('leaves leftover punctuation on a plain run', () => {
        const segments = ['Adão.', ' O próximo'];
        expect(
            moveBoldPunctuationSpilloverToBody(
                segments,
                ['Adam', ' The next'],
                undefined,
                ['CharacterStyle/$ID/[No character style]', 'CharacterStyle/$ID/[No character style]']
            )
        ).toEqual(segments);
    });
});

describe('expandForceClearWithUntranslatedFollowers', () => {
    it('adds the untranslated slot after each apostrophe', () => {
        expect(
            expandForceClearWithUntranslatedFollowers(
                [1],
                ['Aaron', 'ʼ', 's walking stick'],
                ['O cajado de Arão:', 'ʼ', 's walking stick']
            )
        ).toEqual([1, 2]);
    });

    it('leaves an independently translated tail alone', () => {
        expect(
            expandForceClearWithUntranslatedFollowers(
                [1],
                ['Israel', 'ʼ', 's covenant history'],
                ['Zmluvné', '', 'dejiny Izraela']
            )
        ).toEqual([1]);
    });
});
