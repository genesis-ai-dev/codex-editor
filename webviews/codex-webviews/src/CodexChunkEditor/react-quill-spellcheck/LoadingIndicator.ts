import { QuillSpellChecker } from ".";

/**
 * Manager for the loading indicator.
 *
 * This handles showing and hiding the loading indicator in the editor.
 */
export default class LoadingIndicator {
    private currentLoader?: HTMLElement;

    constructor(private readonly parent: QuillSpellChecker) {}

    public startLoading() {
        this.currentLoader?.remove();

        if (this.parent.params.showLoadingIndicator) {
            const loadingIndicator = this.createLoadingIndicator();
            this.currentLoader = loadingIndicator;
            this.parent.quill.root.parentElement?.appendChild(loadingIndicator);
        }
    }

    public stopLoading() {
        this.currentLoader?.remove();
    }

    private createLoadingIndicator(): HTMLElement {
        const loadingIndicator = document.createElement("div");
        loadingIndicator.className = "quill-spck-loading-indicator";

        const spinner = document.createElement("div");
        spinner.className = "quill-spck-loading-indicator-spinner";

        loadingIndicator.appendChild(spinner);
        return loadingIndicator;
    }
}
