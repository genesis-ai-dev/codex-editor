import { createPopper } from "@popperjs/core";
import { SmartEditsManager } from "./SmartEditsManager";

export class SmartPopupManager {
    private quill: any;
    private currentPopup: HTMLElement | null = null;

    constructor(quill: any) {
        this.quill = quill;
    }

    public showGrammarSuggestionPopup(target: HTMLElement) {
        this.closePopup();

        const popup = document.createElement('div');
        popup.className = 'grammar-suggestion-popup';
        popup.innerHTML = `
            <div>Accept this change?</div>
            <button class="accept">Accept</button>
            <button class="reject">Reject</button>
        `;

        document.body.appendChild(popup);

        createPopper(target, popup, {
            placement: 'top',
        });

        this.currentPopup = popup;

        popup.querySelector('.accept')?.addEventListener('click', () => {
            const index = this.quill.getIndex(target);
            (this.quill.getModule('smartEdits') as SmartEditsManager).acceptSuggestion(index, target.textContent?.length || 0);
            this.closePopup();
        });

        popup.querySelector('.reject')?.addEventListener('click', () => {
            const index = this.quill.getIndex(target);
            (this.quill.getModule('smartEdits') as SmartEditsManager).rejectSuggestion(index, target.textContent?.length || 0);
            this.closePopup();
        });
    }

    private closePopup() {
        if (this.currentPopup) {
            this.currentPopup.remove();
            this.currentPopup = null;
        }
    }
}