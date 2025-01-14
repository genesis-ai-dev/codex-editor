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
        match.replacements?.slice(0, 5).forEach((replacement, index) => {
            const button = this.createActionButton(this.formatReplacementLabel(replacement), () =>
                this.applySuggestion(match, replacement.value, index)
            );
            actionsDiv.appendChild(button);
        });

        // Add "Add to dictionary" button only if the match is not a special phrase
        if (match.color !== "purple" && match.color !== "blue") {
            const addToDictionaryButton = this.createActionButton(`${match.text} → 📖`, () =>
                this.addWordToDictionary(match.text)
            );
            actionsDiv.appendChild(addToDictionaryButton);
        }

        // Add reject button for smart edits (purple) and ice edits (blue)
        if (match.color === "purple" || match.color === "blue") {
            const rejectButton = document.createElement("button");
            rejectButton.className = "quill-spck-match-popup-action reject-action";
            rejectButton.innerHTML = '<i class="codicon codicon-thumbsdown"></i>';
            rejectButton.title = "Reject this suggestion";
            rejectButton.addEventListener("click", () => {
                this.rejectSuggestion(match);
                this.closePopup();
            });
            actionsDiv.appendChild(rejectButton);
        }

        popupContent.appendChild(actionsDiv);

        // Add source and confidence information
        const reasonLabel = document.createElement("div");
        reasonLabel.className = "quill-spck-match-popup-reason";

        if (match.color === "purple") {
            reasonLabel.textContent = "AI suggestion based on similar texts";
        } else if (match.color === "blue") {
            const firstReplacement = match.replacements?.[0];
            const confidence = firstReplacement?.confidence || "low";
            const frequency = firstReplacement?.frequency || 1;
            reasonLabel.innerHTML = `From your previous edits (${confidence} confidence) <span class="quill-spck-match-popup-frequency">${frequency}×</span>`;
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

    private rejectSuggestion(match: MatchesEntity) {
        // if (!match.replacements?.[0]) return;

        const content = {
            source: match.replacements?.[0]?.source || "llm",
            cellId: match.cellId,
            oldString: match.text,
            newString: match.replacements?.[0]?.value || "",
            leftToken: match.leftToken || "",
            rightToken: match.rightToken || "",
        };

        console.log("[RYDER*]", content);

        const message: EditorPostMessages = {
            command: "rejectEditSuggestion",
            content: content,
        };

        window.vscodeApi?.postMessage(message);
    }
}
