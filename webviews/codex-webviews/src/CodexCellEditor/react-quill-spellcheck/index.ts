import Quill from "quill";
import { specialCharacters } from "./PlainClipboard";
import PopupManager from "./PopupManager";
import "./QuillSpellChecker.css";
import createSuggestionBlotForQuillInstance from "./SuggestionBlot";
import { SuggestionBoxes } from "./SuggestionBoxes";
import { MatchesEntity, SpellCheckerApi } from "./types";

const DEBUG_MODE = false;
const debug = (...args: any[]) => DEBUG_MODE && console.log("spell-checker-debug", ...args);

export type QuillSpellCheckerParams = {
    disableNativeSpellcheck: boolean;
    cooldownTime: number;
    showLoadingIndicator: boolean;
    api: SpellCheckerApi;
};

export class QuillSpellChecker {
    protected typingCooldown?: number;
    protected loopPreventionCooldown?: number;
    protected popups = new PopupManager(this);
    public boxes = new SuggestionBoxes(this);
    public matches: MatchesEntity[] = [];
    protected onRequestComplete: () => void = () => null;
    private typingTimer: number | undefined;
    private typingDelay = 500; // Delay in milliseconds
    private lastSpellCheckTime: number = 0;
    private spellCheckCooldown: number = 1000; // Minimum time between spellchecks in ms

    constructor(
        public quill: Quill,
        public params: QuillSpellCheckerParams = {
            disableNativeSpellcheck: false,
            cooldownTime: 1000,
            showLoadingIndicator: true,
            api: {} as SpellCheckerApi,
        }
    ) {
        debug("QuillSpellChecker constructor", { quill, params });
        if (!quill?.root) {
            console.error("Quill instance or its root is not available");
            return;
        }

        this.setupEventListeners();
        this.disableNativeSpellcheckIfSet();
        setTimeout(() => {
            this.checkSpelling();
        }, 100);
    }

    private setupEventListeners() {
        this.quill.root.addEventListener("copy", this.handleCopy);
        this.quill.on("text-change", this.handleTextChange);
        this.quill.on("editor-change", this.handleEditorChange);
        window.addEventListener("message", this.handleVSCodeMessage);
    }

    private handleCopy = (event: ClipboardEvent) => {
        const range = this.quill.getSelection();
        const text = this.quill.getText(range?.index, range?.length);
        debug("copy event", { text });
        event.clipboardData?.setData("text/plain", text);
        event.preventDefault();
    };

    private handleTextChange = (delta: any, oldDelta: any, source: string) => {
        debug("text-change event", { delta, oldDelta, source });
        if (source === "user") {
            const content = this.quill.getText();
            debug("text-change content", { content });
            if (specialCharacters.test(content)) {
                this.quill.setText(content.replace(specialCharacters, ""));
            }
            this.onTextChange();
        } else if (this.matches.length > 0 && this.quill.getText().trim()) {
            this.boxes.addSuggestionBoxes();
        }
    };

    private handleEditorChange = (eventName: string, ...args: any[]) => {
        debug("editor-change event", { eventName, args });
        this.popups.initialize();
    };

    private handleVSCodeMessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === "wordAdded") {
            this.checkSpelling();
        }
    };

    public updateMatches(matches: MatchesEntity[]) {
        debug("updateMatches", { matches });
        this.boxes.removeSuggestionBoxes();
        this.matches = matches;
        this.boxes.addSuggestionBoxes();
    }

    public acceptMatch(id: MatchesEntity["id"], replacementIndex: number = 0) {
        debug("acceptMatch", { id, replacementIndex });
        const match = this.matches.find((m) => m.id === id);
        const mode = "silent";
        if (match?.replacements?.length && replacementIndex < match.replacements.length) {
            // Remove just the specific underline by setting the text without the format
            this.quill.formatText(match.offset, match.length, "spck-match", false, mode);

            // Replace the text
            this.quill.deleteText(match.offset, match.length, mode);
            this.quill.insertText(match.offset, match.replacements[replacementIndex].value, mode);
            this.quill.setSelection(
                match.offset + match.replacements[replacementIndex].value.length,
                mode
            );

            // Remove just this match from the matches array
            this.matches = this.matches.filter((m) => m.id !== id);

            // Remove only this suggestion box
            this.boxes.removeCurrentSuggestionBox(
                match,
                match.replacements[replacementIndex].value
            );

            // Trigger a text-change event to update the editor state
            this.quill.updateContents([{ retain: this.quill.getLength() }], "api");
        }
    }

    public ignoreMatch(id: MatchesEntity["id"]) {
        debug("ignoreMatch", { id });
        const match = this.matches.find((m) => m.id === id);
        if (match) {
            this.boxes.removeCurrentSuggestionBox(match, match.text);
        }
    }

    public showMatches(show: boolean = true) {
        debug("showMatches", { show });
        show ? this.boxes.addSuggestionBoxes() : this.boxes.removeSuggestionBoxes();
    }

    private disableNativeSpellcheckIfSet() {
        debug("disableNativeSpellcheckIfSet");
        if (this.params.disableNativeSpellcheck) {
            this.quill.root.setAttribute("spellcheck", "false");
        }
    }

    private onTextChange() {
        debug("onTextChange");

        // Clear the previous timer
        if (this.typingTimer) {
            clearTimeout(this.typingTimer);
        }

        // Set a new timer
        this.typingTimer = window.setTimeout(() => {
            this.checkSpelling();
        }, this.typingDelay);
    }

    public setOnRequestComplete(callback: () => void) {
        debug("setOnRequestComplete");
        this.onRequestComplete = callback;
    }

    public forceCheckSpelling() {
        // Reset the last check time to ensure it runs
        this.lastSpellCheckTime = 0;
        return this.checkSpelling();
    }

    public async checkSpelling(force: boolean = false) {
        debug("checkSpelling");
        const now = Date.now();
        if (!force && now - this.lastSpellCheckTime < this.spellCheckCooldown) {
            return;
        }

        this.lastSpellCheckTime = now;

        if (document.querySelector("spck-toolbar")) return;

        const text = this.quill.getText().trim();
        debug("checkSpelling text", { text });

        if (!text) return;

        const results = await this.getSpellCheckerResults(text);
        this.boxes.removeSuggestionBoxes();
        debug("checkSpelling results", { results });

        if (results?.length) {
            this.matches = results
                .filter((match) => match.replacements?.length)
                .map((match, index) => ({ ...match, id: index.toString() }));
            debug("checkSpelling matches", { matches: this.matches });
            this.boxes.addSuggestionBoxes();
        } else {
            this.matches = [];
            this.boxes.removeSuggestionBoxes();
        }

        this.onRequestComplete();
    }

    private async getSpellCheckerResults(text: string): Promise<MatchesEntity[] | null> {
        debug("getSpellCheckerResults", { text });
        if (!(window as any).vscodeApi) return null;

        try {
            return new Promise((resolve, reject) => {
                const messageListener = (event: MessageEvent) => {
                    const message = event.data;
                    if (message.type === "providerSendsSpellCheckResponse") {
                        (window as any).removeEventListener("message", messageListener);
                        debug("from-provider-getSpellCheckResponse", message.content);
                        resolve(message.content);
                    }
                };

                (window as any).addEventListener("message", messageListener);

                (window as any).vscodeApi.postMessage({
                    command: "from-quill-spellcheck-getSpellCheckResponse",
                    content: { cellContent: text },
                });

                setTimeout(() => {
                    (window as any).removeEventListener("message", messageListener);
                    reject(new Error("Spell check request timed out"));
                }, 10000);
            });
        } catch (e) {
            console.error("getSpellCheckerResults error", e);
            return null;
        }
    }

    public preventLoop() {
        debug("preventLoop");
        if (this.loopPreventionCooldown) clearTimeout(this.loopPreventionCooldown);
        this.loopPreventionCooldown = window.setTimeout(() => {
            this.loopPreventionCooldown = undefined;
        }, 100);
    }
}
export default function registerQuillSpellChecker(Quill: any, vscodeApi: any) {
    debug("spell-checker-debug: registerQuillSpellChecker", {
        Quill,
        vscodeApi,
    });

    // Store the VSCode API in the global variable
    (window as any).vscodeApi = vscodeApi;

    // Check if the module is already registered
    if (!(Quill as any).imports?.["modules/spellChecker"]) {
        (Quill as any).register({
            "modules/spellChecker": QuillSpellChecker,
            "formats/spck-match": createSuggestionBlotForQuillInstance(Quill),
        });
    } else {
        console.warn("SpellChecker module is already registered. Skipping registration.");
    }
}

export { getCleanedHtml, removeSuggestionBoxes } from "./SuggestionBoxes";

// Declare a global variable to store the VSCode API
declare global {
    interface Window {
        vscodeApi: any;
    }
}
