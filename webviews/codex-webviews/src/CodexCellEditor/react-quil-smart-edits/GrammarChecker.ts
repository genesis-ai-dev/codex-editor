import Quill from 'quill';
import Delta from 'quill-delta';

export class GrammarChecker {
    private quill: Quill;

    constructor(quill: Quill) {
        this.quill = quill;
    }

    public checkGrammar() {
        const text = this.quill.getText();
        const correctedText = this.applyGrammarCorrection(text);
        this.highlightGrammarChanges(text, correctedText);
    }

    private applyGrammarCorrection(text: string): string {
        // For testing purposes, simply add "hello" at the end
        return text + " hello";
    }

    private highlightGrammarChanges(originalText: string, correctedText: string) {
        const diff = this.getDiff(originalText, correctedText);
        const delta = new Delta();

        let currentIndex = 0;

        diff.forEach((part) => {
            if (part.added) {
                delta.retain(currentIndex);
                delta.insert(part.value, { 'grammar-suggestion': true });
            } else if (!part.removed) {
                currentIndex += part.value.length;
            }
        });

        this.quill.updateContents(delta);
    }

    private getDiff(text1: string, text2: string): Array<{value: string, added?: boolean, removed?: boolean}> {
        // This is a simple diff implementation. For a real-world scenario, 
        // you might want to use a more sophisticated diff algorithm.
        if (text2.endsWith(text1)) {
            return [
                { value: text1 },
                { value: text2.slice(text1.length), added: true }
            ];
        }
        return [];
    }

    public acceptSuggestion(index: number, length: number) {
        const delta = new Delta().retain(index).retain(length, { 'grammar-suggestion': null });
        this.quill.updateContents(delta);
    }

    public rejectSuggestion(index: number, length: number) {
        const delta = new Delta().retain(index).delete(length);
        this.quill.updateContents(delta);
    }
}