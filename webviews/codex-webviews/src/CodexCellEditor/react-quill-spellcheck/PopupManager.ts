import { createPopper } from "@popperjs/core";
import { QuillSpellChecker } from ".";
import { MatchesEntity } from "./types";

/**
 * Manager for popups.
 *
 * Handles opening and closing suggestion popups in the editor
 * when a suggestion is selected.
 */
export default class PopupManager {
    private openPopup?: HTMLElement;
    private currentSuggestionElement?: HTMLElement;
    private eventListenerAdded = false;

    constructor(private readonly parent: QuillSpellChecker) {
        this.closePopup = this.closePopup.bind(this);
    }

    public initialize() {
        if (!this.eventListenerAdded && this.parent.quill?.root) {
            this.addEventHandler();
            this.eventListenerAdded = true;
        }
    }

    private addEventHandler() {
        const root = this.findRoot(this.parent.quill.root);
        root.addEventListener("click", this.handleClick);
        window.addEventListener("resize", this.handleResize);
    }

    private handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "QUILL-SPCK-MATCH") {
            this.handleSuggestionClick(target);
        } else if (this.openPopup && !this.openPopup.contains(target)) {
            this.closePopup();
        }
    };

    private handleResize = () => {
        if (this.currentSuggestionElement) {
            this.handleSuggestionClick(this.currentSuggestionElement);
        }
    };

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
        if (rule) {
            this.createSuggestionPopup(rule, suggestion);
        }
    }

    private createSuggestionPopup(match: MatchesEntity, suggestion: HTMLElement) {
        this.closePopup();
        this.currentSuggestionElement = suggestion;

        const popup = document.createElement("quill-spck-popup");
        popup.setAttribute("role", "tooltip");

        const popupContent = document.createElement("div");
        popupContent.className = "quill-spck-match-popup";

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "quill-spck-match-popup-actions";

        // Only add replacement suggestions if they exist
        match.replacements?.slice(0, 3).forEach((replacement, index) => {
            const button = this.createActionButton(replacement.value, () =>
                this.applySuggestion(match, replacement.value, index)
            );
            actionsDiv.appendChild(button);
        });

        // Add "Add to dictionary" button only if the match is not a special phrase
        if (match.color !== "purple") {
            const addToDictionaryButton = this.createActionButton(`${match.text} → 📖`, () =>
                this.addWordToDictionary(match.text)
            );
            actionsDiv.appendChild(addToDictionaryButton);
        }

        popupContent.appendChild(actionsDiv);
        popup.appendChild(popupContent);

        document.body.appendChild(popup);

        createPopper(suggestion, popup, {
            placement: "top",
            modifiers: [{ name: "offset", options: { offset: [0, 0] } }],
        });

        this.openPopup = popup;
    }

    private createActionButton(label: string, onClick: () => void): HTMLElement {
        const button = document.createElement("button");
        button.className = "quill-spck-match-popup-action";
        button.textContent = label;
        button.addEventListener("click", () => {
            onClick();
            this.hideDiagnostic();
        });
        return button;
    }

    private applySuggestion(match: MatchesEntity, replacement: string, index: number) {
        this.parent.acceptMatch(match.id, index);
        this.closePopup();
    }

    private addWordToDictionary(word: string) {
        console.log(`Attempting to add word to dictionary: ${word}`);
        window.vscodeApi?.postMessage({
            command: "addWord",
            words: [word],
        });
        this.closePopup();
        console.log(`Requested to add word: ${word}`);
    }

    private hideDiagnostic() {
        if (this.currentSuggestionElement) {
            this.currentSuggestionElement.style.textDecoration = "none";
            this.currentSuggestionElement.style.borderBottom = "none";
        }
    }

    private findRoot(element: HTMLElement): HTMLElement {
        while (element.parentElement) {
            element = element.parentElement;
        }
        return element;
    }
}
