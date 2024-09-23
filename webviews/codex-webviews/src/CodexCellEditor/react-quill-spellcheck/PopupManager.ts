import { createPopper } from "@popperjs/core";
// import html from "nanohtml/lib/browser";
import { QuillSpellChecker } from ".";
import { MatchesEntity } from "./types";

/**
 * Manager for popups.
 *
 * This handles opening and closing suggestion popups in the editor
 * when a suggestion is selected.
 */
export default class PopupManager {
    private openPopup?: HTMLElement;
    private currentSuggestionElement?: HTMLElement;
    private eventListenerAdded: boolean = false;

    constructor(private readonly parent: QuillSpellChecker) {
        this.closePopup = this.closePopup.bind(this);
        // Remove the immediate call to addEventHandler
        // this.addEventHandler();
    }

    public initialize() {
        if (!this.eventListenerAdded && this.parent.quill && this.parent.quill.root) {
            this.addEventHandler();
            this.eventListenerAdded = true;
        }
    }

    private addEventHandler() {
        console.log("addEventHandler", { parent: this.parent });
        if (!this.parent.quill || !this.parent.quill.root) {
            console.warn("Quill instance or its root is not available yet");
            return;
        }

        this.findRoot(this.parent.quill.root).addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "QUILL-SPCK-MATCH") {
                this.handleSuggestionClick(target);
            } else if (this.openPopup && !this.openPopup?.contains(target)) {
                this.closePopup();
            }
        });

        window.addEventListener("resize", () => {
            if (this.currentSuggestionElement) {
                this.handleSuggestionClick(this.currentSuggestionElement);
            }
        });
    }

    private closePopup() {
        if (this.openPopup) {
            this.openPopup.remove();
            this.openPopup = undefined;
        }
        this.currentSuggestionElement = undefined;
    }

    private handleSuggestionClick(suggestion: HTMLElement) {
        const offset = parseInt(suggestion.getAttribute("data-offset") || "0");
        const length = parseInt(suggestion.getAttribute("data-length") || "0");
        const id = suggestion?.id?.replace("match-", "");
        const rule = this.parent.matches.find(
            (r) => r.offset === offset && r.length === length && r.id === id
        );
        if (!rule) {
            return;
        }
        this.createSuggestionPopup(rule, suggestion);
    }

    private createSuggestionPopup(match: MatchesEntity, suggestion: HTMLElement) {
        if (this.openPopup) {
            this.closePopup();
        }
        this.currentSuggestionElement = suggestion;

        const applySuggestion = (replacement: string) => {
            this.parent.preventLoop();
            this.parent.quill.setSelection(match.offset, match.length, "silent");
            this.parent.quill.deleteText(match.offset, match.length, "silent");
            this.parent.quill.insertText(match.offset, replacement, "silent");
            this.parent.quill.setSelection(match.offset + replacement.length, "silent");
            this.parent.boxes.removeCurrentSuggestionBox(match, replacement);

            this.closePopup();
        };

        const popup = document.createElement("quill-spck-popup");
        popup.setAttribute("role", "tooltip");

        const popupContent = document.createElement("div");
        popupContent.className = "quill-spck-match-popup";

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "quill-spck-match-popup-actions";

        match.replacements?.slice(0, 3).forEach((replacement) => {
            const button = document.createElement("button");
            button.className = "quill-spck-match-popup-action";
            button.setAttribute("data-replacement", replacement.value);
            button.textContent = replacement.value;
            button.onclick = () => applySuggestion(replacement.value);
            actionsDiv.appendChild(button);
        });

        const button = document.createElement("button");
        button.className = "quill-spck-match-popup-action";
        // button.setAttribute("data-replacement", replacement.value);
        button.textContent = `${match.text} → 📖`;
        button.onclick = () => {
            console.log("add to dictionary spellcheck.addWord", window.vscodeApi);
            try {
                window.vscodeApi.postMessage({
                    command: "addWord",
                    text: match.text,
                });

                this.closePopup();
                // Trigger a spell check refresh
                this.parent.checkSpelling();
            } catch (error) {
                console.error("spellcheck.addWord Error adding word to dictionary:", error);
                // Optionally, you could show an error message to the user here
            }
        };

        actionsDiv.appendChild(button);

        popupContent.appendChild(actionsDiv);
        popup.appendChild(popupContent);

        document.body.appendChild(popup);

        createPopper(suggestion, popup, {
            placement: "top",
            modifiers: [
                {
                    name: "offset",
                    options: {
                        offset: [0, 0],
                    },
                },
            ],
        });

        this.openPopup = popup;
    }

    private findRoot(element: HTMLElement): HTMLElement {
        let currentElement = element;
        while (currentElement.parentNode) {
            currentElement = currentElement.parentNode as HTMLElement;
        }
        return currentElement;
    }
}
