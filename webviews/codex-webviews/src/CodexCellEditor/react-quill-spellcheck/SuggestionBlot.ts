import { MatchesEntity } from "./types";

const DEBUG = false;
const debug = DEBUG ? console.log.bind(console, "spell-checker-debug:") : () => {};

/**
 * Creates a Quill editor blot representing a suggestion.
 * @param Quill Quill static instance
 * @returns Blot class for registering on the Quill instance
 */
export default function createSuggestionBlotForQuillInstance(Quill: any) {
    const ParentBlot = Quill.import("formats/bold");

    return class SuggestionBlot extends ParentBlot {
        static blotName = "spck-match";
        static tagName = "quill-spck-match";

        static create(match?: MatchesEntity) {
            const node: HTMLElement = super.create();
            if (match) {
                Object.entries({
                    "data-offset": match.offset,
                    "data-length": match.length,
                    id: `match-${match.id}`,
                }).forEach(([attr, value]) => node.setAttribute(attr, value?.toString() ?? ""));

                // Apply color class if specified
                if (match.color) {
                    node.classList.add(match.color);

                    // Add confidence class for ICE suggestions
                    if (match.color === "blue" && match.replacements?.[0]?.confidence) {
                        node.classList.add(`${match.replacements[0].confidence}-confidence`);
                    }
                }

                debug("SuggestionBlot node created with attributes", { node });
            }
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
