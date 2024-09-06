import Quill from "quill";
// import LoadingIndicator from "./LoadingIndicator";
import PlainClipboard, { specialCharacters } from "./PlainClipboard";
import PopupManager from "./PopupManager";
import "./QuillSpellChecker.css";
import createSuggestionBlotForQuillInstance from "./SuggestionBlot";
import { SuggestionBoxes } from "./SuggestionBoxes";
import { MatchesEntity, SpellCheckerApi } from "./types";

export type QuillSpellCheckerParams = {
    disableNativeSpellcheck: boolean;
    cooldownTime: number;
    showLoadingIndicator: boolean;
    api: SpellCheckerApi;
};

/**
 * QuillSpellChecker is a Quill plugin that provides spellchecking and grammar checking
 * using the SpellChecker API.
 */
export class QuillSpellChecker {
    static DEFAULTS: QuillSpellCheckerParams = {
        api: {
            url: "https://languagetool.org/api/v2/check",
            body: (text: string) => {
                console.log("QuillSpellChecker", { text });
                const body = <any>{
                    text,
                    language: "auto",
                };
                return Object.keys(body)
                    .map((key) => `${key}=${encodeURIComponent(body[key])}`)
                    .join("&");
            },
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method: "POST",
            mode: "cors",
            mapResponse: async (response) => {
                console.log("mapResponse", { response });
                const json = await response.json();
                console.log("mapResponse", { json });
                return json;
            },
        },
        disableNativeSpellcheck: true,
        cooldownTime: 3000,
        showLoadingIndicator: false,
    };

    protected typingCooldown?: number; // Change from NodeJS.Timeout
    protected loopPreventionCooldown?: number; // Change from NodeJS.Timeout

    // Dependencies
    protected popups = new PopupManager(this);
    // protected loader = new LoadingIndicator(this);

    public boxes = new SuggestionBoxes(this);
    public matches: MatchesEntity[] = [];

    protected onRequestComplete: () => void = () => null;

    /**
     * Create a new QuillSpellChecker instance.
     *
     * @param quill Instance of the Qill editor.
     * @param params Options for the QuillSpellChecker instance.
     */
    constructor(
        public quill: Quill,
        public params: QuillSpellCheckerParams,
    ) {
        if (!quill || !quill.root) {
            console.error("Quill instance or its root is not available");
            return;
        }

        // not allow the insertion of images and texts with formatting
        quill.clipboard.addMatcher(Node.ELEMENT_NODE, function (node) {
            const plaintext = node.innerText;
            const Delta = Quill.import("delta");
            return new Delta().insert(plaintext);
        });

        // break line using enter and
        // do not allow the insertion of <> characters
        this.quill.root.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                const selectionIndex = quill.getSelection()?.index;
                if (typeof selectionIndex !== "undefined") {
                    quill.insertText(selectionIndex, "\n");
                    event.preventDefault();
                }
            } else if (event.key === "<" || event.key === ">") {
                event.preventDefault();
            }
        });

        // copy plain text to clipboard
        this.quill.root.addEventListener("copy", (event: any) => {
            const range = this.quill.getSelection();
            const text = this.quill.getText(range?.index, range?.length);
            event.clipboardData.setData("text/plain", text);
            event.preventDefault();
        });

        this.quill.on("text-change", (_, __, source) => {
            if (source === "user") {
                const content = this.quill.getText();
                if (specialCharacters.test(content)) {
                    const newText = content.replace(specialCharacters, "");
                    this.quill.setText(newText);
                }
                this.onTextChange();
            } else if (this.matches.length > 0 && this.quill.getText().trim()) {
                this.boxes.addSuggestionBoxes();
            }
        });

        // Initialize the PopupManager after Quill is set up
        this.quill.on('editor-change', () => {
            this.popups.initialize();
        });

        this.checkSpelling();
        this.disableNativeSpellcheckIfSet();
    }

    public updateMatches(matches: MatchesEntity[]) {
        this.boxes.removeSuggestionBoxes();
        this.matches = matches;
        this.boxes.addSuggestionBoxes();
    }

    public acceptMatch(id: MatchesEntity["id"]) {
        const match = this.matches.find((match) => match.id === id);
        if (match && match.replacements && match.replacements?.length > 0) {
            const replacement = match.replacements[0].value;
            this.quill.setSelection(match.offset, match.length, "silent");
            this.quill.deleteText(match.offset, match.length, "silent");
            this.quill.insertText(match.offset, replacement, "silent");
            // @ts-expect-error: quill.setSelection is not typed
            this.quill.setSelection(
                match.offset + replacement.length,
                "silent",
            );
            this.boxes.removeCurrentSuggestionBox(match, replacement);
        }
    }

    public ignoreMatch(id: MatchesEntity["id"]) {
        const match = this.matches.find((match) => match.id === id);
        if (match) {
            this.boxes.removeCurrentSuggestionBox(match, match?.text);
        }
    }

    public showMatches(show: boolean = true) {
        if (show) {
            this.boxes.addSuggestionBoxes();
        } else {
            this.boxes.removeSuggestionBoxes();
        }
    }

    private disableNativeSpellcheckIfSet() {
        if (this.params.disableNativeSpellcheck) {
            this.quill.root.setAttribute("spellcheck", "false");
        }
    }

    private onTextChange() {
        if (this.loopPreventionCooldown) return;
        if (this.typingCooldown) {
            clearTimeout(this.typingCooldown);
        }
        this.typingCooldown = window.setTimeout(() => {
            // Use window.setTimeout
            this.checkSpelling();
        }, this.params.cooldownTime);
    }

    public setOnRequestComplete(callback: () => void) {
        this.onRequestComplete = callback;
    }

    public async checkSpelling() {
        if (document.querySelector("spck-toolbar")) {
            return;
        }

        const text = this.quill.getText();

        if (!text.replace(/[\n\t\r]/g, "").trim()) {
            return;
        }
        this.boxes.removeSuggestionBoxes();
        // this.loader.startLoading();
        const json = await this.getSpellCheckerResults(text);

        if (json && json.matches && json.matches.length > 0) {
            this.matches = json.matches
                .filter(
                    (match) =>
                        match.replacements && match.replacements.length > 0,
                )
                .map((match, index) => ({
                    ...match,
                    id: index.toString(),
                }));
            this.boxes.addSuggestionBoxes();
        } else {
            this.matches = [];
        }
        // this.loader.stopLoading();
        this.onRequestComplete();
    }

    private async getSpellCheckerResults(text: string) {
        try {
            const response = await fetch(this.params.api.url, {
                ...this.params.api,
                body: this.params.api.body(text),
            });
            return this.params.api.mapResponse(response);
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    public preventLoop() {
        if (this.loopPreventionCooldown) {
            clearTimeout(this.loopPreventionCooldown);
        }
        this.loopPreventionCooldown = window.setTimeout(() => {
            // Use window.setTimeout
            this.loopPreventionCooldown = undefined;
        }, 100);
    }
}

/**
 * Register all QuillSpellChecker modules with Quill.
 *
 * This needs access to the exact Quill static instance
 * you will be using in your application.
 *
 * Example:
 * ```
 * import Quill from "quill";
 * import registerQuillSpellChecker from "react-quill-spell-checker";
 * registerQuillSpellChecker(Quill);
 * ```
 *
 * @param Quill Quill static instance.
 */
export default function registerQuillSpellChecker(Quill: any) {
    console.log("registerQuillSpellChecker", { Quill });
    Quill.register({
        "modules/spellChecker": QuillSpellChecker,
        "formats/spck-match": createSuggestionBlotForQuillInstance(Quill),
        "modules/clipboard": PlainClipboard,
    });
}

export { getCleanedHtml, removeSuggestionBoxes } from "./SuggestionBoxes";
