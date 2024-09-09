import { MatchesEntity } from "./types";

/**
 * Quill editor blot that represents a suggestion.
 *
 * This is added to the text to enable the suggestion to be selected and inserted.
 *
 * @param Quill Quill static instance
 * @returns Blot class that can be registered on the Quill instance
 */
export default function createSuggestionBlotForQuillInstance(Quill: any) {
    console.log(
        "spell-checker-debug: Creating SuggestionBlot for Quill instance",
    );
    const ParentBlot = Quill.import("formats/bold");

    return class SuggestionBlot extends ParentBlot {
        static blotName = "spck-match";
        static tagName = "quill-spck-match";

        static create(match?: MatchesEntity) {
            console.log("spell-checker-debug: Creating SuggestionBlot node", {
                match,
            });
            let node: HTMLElement = super.create();
            if (match) {
                node.setAttribute("data-offset", match.offset?.toString());
                node.setAttribute("data-length", match.length?.toString());
                node.id = `match-${match.id}`;
                console.log(
                    "spell-checker-debug: SuggestionBlot node attributes set",
                    {
                        offset: node.getAttribute("data-offset"),
                        length: node.getAttribute("data-length"),
                        id: node.id,
                    },
                );
            }
            console.log("spell-checker-debug: SuggestionBlot node created", {
                node,
            });
            return node;
        }

        optimize() {
            console.log("spell-checker-debug: SuggestionBlot optimize called");
        }

        static value(node: HTMLElement) {
            console.log("spell-checker-debug: SuggestionBlot value called", {
                node,
            });
            return node.textContent;
        }
    };
}
