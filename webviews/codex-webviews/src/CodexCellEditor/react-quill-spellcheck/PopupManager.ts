import { createPopper } from "@popperjs/core";
import { QuillSpellChecker } from ".";
import { MatchesEntity } from "./types";
import { EditorPostMessages } from "../../../../../types";

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
    private activeButtons: HTMLElement[] = []; // Track active buttons for cleanup

    constructor(private readonly parent: QuillSpellChecker) {
        this.closePopup = this.closePopup.bind(this);
    }

    public initialize() {
        if (!this.eventListenerAdded && this.parent.quill?.root) {
            this.addEventHandler();
            this.eventListenerAdded = true;
        }
    }

    public dispose() {
        // Clean up global event listeners
        if (this.eventListenerAdded && this.parent.quill?.root) {
            const root = this.findRoot(this.parent.quill.root);
            root.removeEventListener("click", this.handleClick);
            window.removeEventListener("resize", this.handleResize);
            this.eventListenerAdded = false;
        }

        // Clean up any open popup
        this.closePopup();

        // Clean up any remaining button listeners
        this.activeButtons.forEach((button) => {
            button.replaceWith(button.cloneNode(true));
        });
        this.activeButtons = [];
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
            // Clean up button event listeners before removing popup
            const buttons = this.openPopup.querySelectorAll("button");
            buttons.forEach((button) => {
                button.replaceWith(button.cloneNode(true));
            });

            this.openPopup.remove();
            this.openPopup = undefined;
        }
        this.currentSuggestionElement = undefined;
        this.activeButtons = []; // Clear the active buttons array
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

        // Create a scrollable container for suggestion buttons
        const suggestionsDiv = document.createElement("div");
        suggestionsDiv.className = "quill-spck-match-popup-suggestions";

        // Add up to 5 replacement suggestions into the scrollable list
        match.replacements?.slice(0, 5).forEach((replacement, index) => {
            const button = this.createActionButton(
                this.formatReplacementLabel(replacement),
                () => this.applySuggestion(match, replacement.value, index)
            );
            suggestionsDiv.appendChild(button);
            this.activeButtons.push(button);
        });

        // Create a footer for dictionary and reject actions
        const footerDiv = document.createElement("div");
        footerDiv.className = "quill-spck-match-popup-footer";

        // Add "Add to dictionary" button only if it's a dictionary error
        if (match.color !== "purple" && match.color !== "blue") {
            const addToDictionaryButton = this.createActionButton(
                `${match.text} → 📖`,
                () => this.addWordToDictionary(match.text)
            );
            footerDiv.appendChild(addToDictionaryButton);
            this.activeButtons.push(addToDictionaryButton);
        }

        // Add reject button for LLM (purple) and ICE (blue) suggestions
        if (match.color === "purple" || match.color === "blue") {
            const rejectButton = document.createElement("button");
            rejectButton.className = "quill-spck-match-popup-action reject-action";
            rejectButton.innerHTML = '<i class="codicon codicon-thumbsdown"></i>';
            rejectButton.title = "Reject this suggestion";
            rejectButton.addEventListener("click", () => {
                this.rejectSuggestion({ match, suggestion });
                this.closePopup();
            });
            footerDiv.appendChild(rejectButton);
            this.activeButtons.push(rejectButton);
        }

        // Append the suggestions list and the footer
        popupContent.appendChild(suggestionsDiv);
        popupContent.appendChild(footerDiv);

        // Add source and confidence information
        const reasonLabel = document.createElement("div");
        reasonLabel.className = "quill-spck-match-popup-reason";

        if (match.color === "purple") {
            reasonLabel.innerHTML =
                '<i class="codicon codicon-sparkle"></i> AI suggestion based on similar texts';
        } else if (match.color === "blue") {
            const firstReplacement = match.replacements?.[0];
            const confidence = firstReplacement?.confidence || "low";
            const frequency = firstReplacement?.frequency || 1;
            reasonLabel.innerHTML = `<i class="codicon codicon-sparkle"></i> From your previous edits (${confidence} confidence) <span class="quill-spck-match-popup-frequency">${frequency}×</span>`;
        }

        popupContent.appendChild(reasonLabel);

        popup.appendChild(popupContent);
        document.body.appendChild(popup);

        createPopper(suggestion, popup, {
            placement: "top",
            modifiers: [{ name: "offset", options: { offset: [0, 0] } }],
        });

        this.openPopup = popup;
    }

    private formatReplacementLabel(
        replacement: NonNullable<MatchesEntity["replacements"]>[number]
    ): string {
        if (!replacement) return "";

        let label = replacement.value;

        // Add confidence indicator for ICE suggestions
        if (replacement.source === "ice") {
            if (replacement.confidence === "high") {
                label += " ✓✓"; // Double check for high confidence
            } else {
                label += " ✓"; // Single check for low confidence
            }
        }

        return label;
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

    private rejectSuggestion({
        match,
        suggestion,
    }: {
        match: MatchesEntity;
        suggestion: HTMLElement;
    }) {
        const getCurrentEditingCellId = (window as any).getCurrentEditingCellId;
        const currentCellId = getCurrentEditingCellId?.();

        if (!currentCellId) {
            console.error("No cell ID found for current edit");
            return;
        }

        const content = {
            source: match.replacements?.[0]?.source || "llm",
            cellId: currentCellId,
            oldString: match.text,
            newString: match.replacements?.[0]?.value || "",
            leftToken: match.leftToken || "",
            rightToken: match.rightToken || "",
        };

        // FIXME: how did we lose the leftToken and rightToken? check ./index.ts

        const message: EditorPostMessages = {
            command: "rejectEditSuggestion",
            content: content,
        };

        window.vscodeApi?.postMessage(message);

        // Close popup and hide diagnostic
        this.closePopup();
        this.hideDiagnostic();

        // Force a new spell check immediately
        this.parent.forceCheckSpelling();
    }
}
