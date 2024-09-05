import { createPopper } from "@popperjs/core";
import { MatchesEntity } from "./types";

export function createPopupManager(parent: any) {
    let openPopup: HTMLElement | undefined;
    let currentSuggestionElement: HTMLElement | undefined;

    function closePopup() {
        if (openPopup) {
            openPopup.remove();
            openPopup = undefined;
        }
        currentSuggestionElement = undefined;
    }

    function handleSuggestionClick(suggestion: HTMLElement) {
        const offset = parseInt(suggestion.getAttribute("data-offset") || "0");
        const length = parseInt(suggestion.getAttribute("data-length") || "0");
        const id = suggestion?.id?.replace("match-", "");
        const rule = parent.matches.find(
            (r: MatchesEntity) =>
                r.offset === offset && r.length === length && r.id === id,
        );
        if (!rule) {
            return;
        }
        createSuggestionPopup(rule, suggestion);
    }

    function createSuggestionPopup(
        match: MatchesEntity,
        suggestion: HTMLElement,
    ) {
        if (openPopup) {
            closePopup();
        }
        currentSuggestionElement = suggestion;

        const applySuggestion = (replacement: string) => {
            parent.preventLoop();
            parent.quill.setSelection(match.offset, match.length, "silent");
            parent.quill.deleteText(match.offset, match.length, "silent");
            parent.quill.insertText(match.offset, replacement, "silent");
            // @ts-expect-error: this exists but is not typed according to the original author
            parent.quill.setSelection(
                match.offset + replacement.length,
                "silent",
            );
            parent.boxes.removeCurrentSuggestionBox(match, replacement);

            closePopup();
        };

        const popup = document.createElement("quill-spck-popup");
        popup.setAttribute("role", "tooltip");

        const popupContent = document.createElement("div");
        popupContent.className = "quill-spck-match-popup";

        const actionsContainer = document.createElement("div");
        actionsContainer.className = "quill-spck-match-popup-actions";

        match.replacements?.slice(0, 3).forEach((replacement) => {
            const button = document.createElement("button");
            button.className = "quill-spck-match-popup-action";
            button.setAttribute("data-replacement", replacement.value);
            button.textContent = replacement.value;
            button.onclick = () => applySuggestion(replacement.value);
            actionsContainer.appendChild(button);
        });

        popupContent.appendChild(actionsContainer);
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

        openPopup = popup;
    }

    function findRoot(element: HTMLElement): HTMLElement {
        let currentElement = element;
        while (currentElement.parentNode) {
            currentElement = currentElement.parentNode as HTMLElement;
        }
        return currentElement;
    }

    function addEventHandler() {
        if (parent.quill && parent.quill.root) {
            findRoot(parent.quill.root).addEventListener("click", (e) => {
                const target = e.target as HTMLElement;
                if (target.tagName === "QUILL-SPCK-MATCH") {
                    handleSuggestionClick(target);
                } else if (openPopup && !openPopup?.contains(target)) {
                    closePopup();
                }
            });
        } else {
            console.warn("Quill editor or its root is not available");
        }

        window.addEventListener("resize", () => {
            if (currentSuggestionElement) {
                handleSuggestionClick(currentSuggestionElement);
            }
        });
    }

    addEventHandler();

    return {
        closePopup,
        handleSuggestionClick,
    };
}
