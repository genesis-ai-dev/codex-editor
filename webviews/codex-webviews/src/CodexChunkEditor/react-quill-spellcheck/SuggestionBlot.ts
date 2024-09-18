import { MatchesEntity } from "./types";

const DEBUG = false;
const debug = (message: string, ...args: any[]) => {
    if (DEBUG) {
        console.log(`spell-checker-debug: ${message}`, ...args);
    }
};

/**
 * Quill editor blot that represents a suggestion.
 *
 * This is added to the text to enable the suggestion to be selected and inserted.
 *
 * @param Quill Quill static instance
 * @returns Blot class that can be registered on the Quill instance
 */
export default function createSuggestionBlotForQuillInstance(Quill: any) {
    debug("Creating SuggestionBlot for Quill instance");
    const ParentBlot = Quill.import("formats/bold");

    return class SuggestionBlot extends ParentBlot {
        static blotName = "spck-match";
        static tagName = "quill-spck-match";

        static create(match?: MatchesEntity) {
            debug("Creating SuggestionBlot node", { match });
            const node: HTMLElement = super.create();
            if (match) {
                node.setAttribute("data-offset", match.offset?.toString());
                node.setAttribute("data-length", match.length?.toString());
                node.id = `match-${match.id}`;
                debug("SuggestionBlot node attributes set", {
                    offset: node.getAttribute("data-offset"),
                    length: node.getAttribute("data-length"),
                    id: node.id,
                });
            }
            debug("SuggestionBlot node created", { node });
            return node;
        }

        optimize() {
            debug("SuggestionBlot optimize called");
        }

        static value(node: HTMLElement) {
            debug("SuggestionBlot value called", { node });
            return node.textContent;
        }
    };
}
