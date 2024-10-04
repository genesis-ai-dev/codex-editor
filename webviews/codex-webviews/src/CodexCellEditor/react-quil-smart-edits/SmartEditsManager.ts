import Quill from 'quill';
import { GrammarChecker } from './GrammarChecker';
import { SmartPopupManager } from './smartPopupManager';

export class SmartEditsManager {
    private quill: Quill;
    private grammarChecker: GrammarChecker;
    private popupManager: SmartPopupManager;
    private debounceTimeout: number | undefined;

    constructor(quill: Quill) {
        this.quill = quill;
        this.grammarChecker = new GrammarChecker(quill);
        this.popupManager = new SmartPopupManager(quill);
        this.initialize();
    }

    private initialize() {
        this.quill.on('text-change', (delta, oldDelta, source) => {
            if (source === 'user') {
                this.onTextChange();
            }
        });

        this.quill.root.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.getAttribute('data-grammar-suggestion')) {
                this.popupManager.showGrammarSuggestionPopup(target);
            }
        });
    }

    private onTextChange() {
        // Debounce the grammar check to avoid excessive API calls
        if (this.debounceTimeout !== undefined) {
            clearTimeout(this.debounceTimeout);
        }
        this.debounceTimeout = window.setTimeout(() => {
            this.grammarChecker.checkGrammar();
        }, 1000); // Wait for 1 second of inactivity before checking grammar
    }

    public acceptSuggestion(index: number, length: number) {
        this.grammarChecker.acceptSuggestion(index, length);
    }

    public rejectSuggestion(index: number, length: number) {
        this.grammarChecker.rejectSuggestion(index, length);
    }
}