import Quill from "quill";
import PlainClipboard, { specialCharacters } from "./PlainClipboard";
import { createPopupManager } from "./PopupManager";
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

const DEFAULTS: QuillSpellCheckerParams = {
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

export function useQuillSpellChecker(
    quill: Quill,
    params: QuillSpellCheckerParams = DEFAULTS,
) {
    let typingCooldown: NodeJS.Timeout | undefined;
    let loopPreventionCooldown: NodeJS.Timeout | undefined;
    let matches: MatchesEntity[] = [];
    let onRequestComplete: () => void = () => null;

    const boxes = new SuggestionBoxes({ quill, params });
    const popupManager = createPopupManager({ quill, params, matches, boxes });

    const initializeQuill = () => {
        if (!quill || !quill.root) {
            console.error("Quill instance or its root is not available");
            return;
        }

        quill.clipboard.addMatcher(Node.ELEMENT_NODE, function (node) {
            const plaintext = node.innerText;
            const Delta = Quill.import("delta");
            return new Delta().insert(plaintext);
        });

        quill.root.addEventListener("keydown", (event) => {
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

        quill.root.addEventListener("copy", (event: any) => {
            const range = quill.getSelection();
            const text = quill.getText(range?.index, range?.length);
            event.clipboardData.setData("text/plain", text);
            event.preventDefault();
        });

        quill.on("text-change", (_, __, source) => {
            if (source === "user") {
                const content = quill.getText();
                if (specialCharacters.test(content)) {
                    const newText = content.replace(specialCharacters, "");
                    quill.setText(newText);
                }
                onTextChange();
            } else if (matches.length > 0 && quill.getText().trim()) {
                boxes.addSuggestionBoxes();
                // Remove this line as it's no longer applicable
                // popups?.openPopup?.();
            }
        });

        checkSpelling();
        disableNativeSpellcheckIfSet();
    };

    const updateMatches = (newMatches: MatchesEntity[]) => {
        boxes.removeSuggestionBoxes();
        matches = newMatches;
        boxes.addSuggestionBoxes();
    };

    const acceptMatch = (id: MatchesEntity["id"]) => {
        const match = matches.find((match) => match.id === id);
        if (match && match.replacements && match.replacements?.length > 0) {
            const replacement = match.replacements[0].value;
            quill.setSelection(match.offset, match.length, "silent");
            quill.deleteText(match.offset, match.length, "silent");
            quill.insertText(match.offset, replacement, "silent");
            // @ts-expect-error: quill.setSelection is not typed
            quill.setSelection(match.offset + replacement.length, "silent");
            boxes.removeCurrentSuggestionBox(match, replacement);
        }
    };

    const ignoreMatch = (id: MatchesEntity["id"]) => {
        const match = matches.find((match) => match.id === id);
        if (match) {
            boxes.removeCurrentSuggestionBox(match, match?.text);
        }
    };

    const showMatches = (show: boolean = true) => {
        if (show) {
            boxes.addSuggestionBoxes();
        } else {
            boxes.removeSuggestionBoxes();
        }
    };

    const disableNativeSpellcheckIfSet = () => {
        if (params.disableNativeSpellcheck) {
            quill.root.setAttribute("spellcheck", "false");
        }
    };

    const onTextChange = () => {
        if (loopPreventionCooldown) return;
        if (typingCooldown) {
            clearTimeout(typingCooldown);
        }
        typingCooldown = setTimeout(() => {
            checkSpelling();
        }, params.cooldownTime);
    };

    const setOnRequestComplete = (callback: () => void) => {
        onRequestComplete = callback;
    };

    const checkSpelling = async () => {
        if (document.querySelector("spck-toolbar")) {
            return;
        }

        const text = quill.getText();

        if (!text.replace(/[\n\t\r]/g, "").trim()) {
            return;
        }
        boxes.removeSuggestionBoxes();
        const json = await getSpellCheckerResults(text);

        if (json && json.matches && json.matches.length > 0) {
            matches = json.matches
                .filter(
                    (match) =>
                        match.replacements && match.replacements.length > 0,
                )
                .map((match, index) => ({
                    ...match,
                    id: index.toString(),
                }));
            boxes.addSuggestionBoxes();
        } else {
            matches = [];
        }
        onRequestComplete();
    };

    const getSpellCheckerResults = async (text: string) => {
        console.log("getSpellCheckerResults", { text, params });
        try {
            const response = await fetch(params.api.url, {
                ...params.api,
                body: params.api.body(text),
            });
            return params.api.mapResponse(response);
        } catch (e) {
            console.error(e);
            return null;
        }
    };

    const preventLoop = () => {
        if (loopPreventionCooldown) {
            clearTimeout(loopPreventionCooldown);
        }
        loopPreventionCooldown = setTimeout(() => {
            loopPreventionCooldown = undefined;
        }, 100);
    };

    initializeQuill();

    return {
        updateMatches,
        acceptMatch,
        ignoreMatch,
        showMatches,
        setOnRequestComplete,
        checkSpelling,
        preventLoop,
        closePopup: popupManager.closePopup, // Add this line
    };
}

export function registerQuillSpellChecker(Quill: any) {
    console.log("registerQuillSpellChecker", { Quill });
    Quill.register({
        "modules/spellChecker": useQuillSpellChecker,
        "formats/spck-match": createSuggestionBlotForQuillInstance(Quill),
        "modules/clipboard": PlainClipboard,
    });
}

export default registerQuillSpellChecker;

export { getCleanedHtml, removeSuggestionBoxes } from "./SuggestionBoxes";
