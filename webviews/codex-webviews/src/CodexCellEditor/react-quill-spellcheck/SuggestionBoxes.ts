import type Quill from "quill";
import Delta from "quill-delta";
import { QuillSpellChecker } from ".";
import { MatchesEntity } from "./types";

/**
 * Clean all suggestion boxes from an HTML string
 */
export const getCleanedHtml = (html: string) =>
    html.replace(/<quill-spck-match.*?(?:class="purple")?.*?>|<\/quill-spck-match>/g, "");

/**
 * Remove all suggestion boxes from the editor.
 */
export const removeSuggestionBoxes = (quillEditor: Quill) => {
    const initialSelection = quillEditor.getSelection();
    const deltas = quillEditor.getContents();

    const cleanedDeltas = deltas.ops.map((delta) => ({
        ...delta,
        attributes: delta.attributes && {
            ...delta.attributes,
            "spck-match": null,
        },
    }));

    quillEditor.setContents(new Delta(cleanedDeltas), "silent");
    if (initialSelection) quillEditor.setSelection(initialSelection, "silent");
};

/**
 * Manager for the suggestion boxes.
 * Handles inserting and removing suggestion box elements from the editor.
 */
export class SuggestionBoxes {
    constructor(private readonly parent: QuillSpellChecker) {}

    public removeSuggestionBoxes() {
        removeSuggestionBoxes(this.parent.quill);
    }

    public addSuggestionBoxes() {
        this.parent.matches.forEach((match) => {
            const ops = new Delta()
                .retain(match.offset)
                .retain(match.length, { "spck-match": match });

            this.parent.quill.updateContents(ops, "silent");
        });
    }

    public removeCurrentSuggestionBox(currentMatch: MatchesEntity, replacement: string) {
        const start = currentMatch.offset + currentMatch.length;
        const diff = replacement.length - currentMatch.length;

        this.parent.matches = this.parent.matches
            .filter(
                (match) =>
                    match.replacements &&
                    match.replacements.length > 0 &&
                    match.offset !== currentMatch.offset
            )
            .map((match) => ({
                ...match,
                offset: match.offset >= start ? match.offset + diff : match.offset,
            }));

        this.removeSuggestionBoxes();
        this.addSuggestionBoxes();
    }
}
