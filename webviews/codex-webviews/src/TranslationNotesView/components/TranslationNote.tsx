import React from "react";
import { markdownToHTML } from "../utilities/markdownToHTML";
import type { TranslationNoteType } from "../../../../../types/TsvTypes";

/**
 * @component
 * @description
 * `TranslationNote` renders a translation note which includes a heading (Quote) and the note's content (Note).
 * The note content is converted from Markdown to HTML for rendering. The component expects a `note` object
 * as a prop, conforming to the `TranslationNoteType` interface.
 *
 * The `Quote` is displayed as the heading of the note. If `Quote` is not provided or is an empty string,
 * "General Verse Note" is used as a fallback. The `Note` content is processed through `markdownToHTML`
 * function to convert Markdown formatted text into HTML.
 */
const TranslationNote: React.FC<{ note: TranslationNoteType }> = ({
    note: { ID, Quote, Note },
}: {
    note: TranslationNoteType;
}) => {
    const effectiveQuote = Quote || "General Verse Note";

    return (
        <div id={`note_${ID}`}>
            <h3>{effectiveQuote}</h3>
            <div dangerouslySetInnerHTML={{ __html: markdownToHTML(Note) }} />
        </div>
    );
};

export default TranslationNote;
