import {
    IDML_SCHEMA_VERSION,
    validateIdmlTranslation,
} from "@aquilla/idml-roundtrip";
import type { IdmlFormatMetadataV2 } from "@aquilla/idml-roundtrip";

export const IDML_EMPTY_ANCHOR_SENTINEL = "\uFEFF";
export const IDML_SOFT_BREAK_SENTINEL = "\u2028";

export interface IdmlEditorContract {
    readonly metadata: unknown;
    readonly sourceHtml: string;
}

interface IdmlPasteEditor {
    deleteText: (index: number, length: number, source: "user") => unknown;
    insertText: (
        index: number,
        text: string,
        formats: Record<string, unknown>,
        source: "user"
    ) => unknown;
    setSelection: (
        index: number,
        length: number,
        source: "silent"
    ) => unknown;
}

export function insertIdmlClipboardText(
    editor: IdmlPasteEditor,
    text: string,
    selection: { index: number; length: number },
    idmlAnchor: Record<string, string>
): void {
    const normalizedText = text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .join(IDML_SOFT_BREAK_SENTINEL);
    if (selection.length > 0) {
        editor.deleteText(selection.index, selection.length, "user");
    }
    if (normalizedText.length > 0) {
        editor.insertText(
            selection.index,
            normalizedText,
            { idmlAnchor },
            "user"
        );
    }
    editor.setSelection(selection.index + normalizedText.length, 0, "silent");
}

export function unsupportedIdmlNotebookVersionMessage(
    metadata: unknown
): string | null {
    const version = Number(
        (metadata as { readonly idmlSchemaVersion?: unknown } | null)
            ?.idmlSchemaVersion
    );
    if (Number.isFinite(version) && version > IDML_SCHEMA_VERSION) {
        return `This IDML project uses metadata version ${version}. Update Codex Editor before opening or editing it.`;
    }
    return null;
}

export function assertSupportedIdmlContract(
    contract: IdmlEditorContract
): asserts contract is {
    readonly metadata: IdmlFormatMetadataV2;
    readonly sourceHtml: string;
} {
    const version = Number(
        (contract.metadata as { readonly version?: unknown } | null)?.version
    );
    if (version !== IDML_SCHEMA_VERSION) {
        throw new Error(
            Number.isFinite(version) && version > IDML_SCHEMA_VERSION
                ? `Unsupported future IDML metadata version ${version}; update Codex Editor.`
                : "Legacy or invalid IDML metadata; repair or re-import this file."
        );
    }
}

/**
 * Quill removes empty inline formats. Turn every slot/token into a dedicated
 * inline blot carrying an invisible sentinel; canonical serialization removes
 * the editor-only class and sentinel again.
 */
export function prepareIdmlHtmlForQuill(html: string): string {
    const document = new DOMParser().parseFromString(html, "text/html");
    const root = document.body.firstElementChild;
    if (!root || root.tagName !== "P") {
        throw new Error("IDML cell HTML must contain one protected paragraph.");
    }

    root.removeAttribute("data-idml-version");
    for (const lineBreak of Array.from(
        root.querySelectorAll<HTMLBRElement>(
            '[data-idml-protected="slot"] br:not([data-idml-protected])'
        )
    )) {
        lineBreak.replaceWith(document.createTextNode(IDML_SOFT_BREAK_SENTINEL));
    }
    for (const node of Array.from(
        root.querySelectorAll<HTMLElement>("[data-idml-protected]")
    )) {
        node.classList.add("idml-anchor");
        if (node.dataset.idmlProtected === "token") {
            const replacement =
                node.tagName === "SPAN"
                    ? node
                    : document.createElement("span");
            if (replacement !== node) {
                for (const attribute of Array.from(node.attributes)) {
                    replacement.setAttribute(attribute.name, attribute.value);
                }
                node.replaceWith(replacement);
            }
            replacement.classList.add("idml-anchor");
            replacement.textContent = IDML_EMPTY_ANCHOR_SENTINEL;
        } else if (!node.textContent && node.children.length === 0) {
            node.textContent = IDML_EMPTY_ANCHOR_SENTINEL;
        }
    }
    return root.outerHTML;
}

export function canonicalizeIdmlQuillHtml(html: string): string {
    const document = new DOMParser().parseFromString(html, "text/html");
    const paragraphs = Array.from(document.body.children);
    if (paragraphs.length !== 1 || paragraphs[0].tagName !== "P") {
        throw new Error(
            "IDML editing must remain within its original InDesign paragraph."
        );
    }
    const root = paragraphs[0] as HTMLElement;
    root.setAttribute("data-idml-version", String(IDML_SCHEMA_VERSION));
    mergeAdjacentIdmlSlotAnchors(root);
    for (const node of Array.from(
        root.querySelectorAll<HTMLElement>(".idml-anchor")
    )) {
        node.classList.remove("idml-anchor");
        if (node.classList.length === 0) {
            node.removeAttribute("class");
        }

        if (node.dataset.idmlProtected === "token") {
            const kind = node.dataset.idmlTokenKind;
            node.textContent = "";
            if (kind === "br") {
                const replacement = document.createElement("br");
                for (const attribute of Array.from(node.attributes)) {
                    replacement.setAttribute(attribute.name, attribute.value);
                }
                node.replaceWith(replacement);
            }
            continue;
        }

        replaceEditorSentinels(node, document);
    }
    return root.outerHTML;
}

function mergeAdjacentIdmlSlotAnchors(root: HTMLElement): void {
    const attributeSignature = (node: HTMLElement): string =>
        [
            node.dataset.idmlProtected,
            node.dataset.idmlSlot,
            node.dataset.idmlCharacterStyle,
            node.getAttribute("contenteditable") ?? "",
        ].join("\u0000");
    for (const node of Array.from(
        root.querySelectorAll<HTMLElement>(
            '.idml-anchor[data-idml-protected="slot"]'
        )
    )) {
        let next = node.nextElementSibling as HTMLElement | null;
        while (
            next?.matches('.idml-anchor[data-idml-protected="slot"]') &&
            attributeSignature(next) === attributeSignature(node)
        ) {
            const following = next.nextElementSibling as HTMLElement | null;
            node.append(...Array.from(next.childNodes));
            next.remove();
            next = following;
        }
    }
}

function replaceEditorSentinels(node: HTMLElement, document: Document): void {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text);
    }
    for (const textNode of textNodes) {
        const text = textNode.data
            .split(IDML_EMPTY_ANCHOR_SENTINEL)
            .join("");
        if (!text.includes(IDML_SOFT_BREAK_SENTINEL)) {
            textNode.data = text;
            continue;
        }
        const fragment = document.createDocumentFragment();
        const parts = text.split(IDML_SOFT_BREAK_SENTINEL);
        parts.forEach((part: string, index: number) => {
            if (index > 0) fragment.append(document.createElement("br"));
            if (part) fragment.append(document.createTextNode(part));
        });
        textNode.replaceWith(fragment);
    }
}

export function validateAndCanonicalizeIdmlHtml(
    html: string,
    contract: IdmlEditorContract
): string {
    assertSupportedIdmlContract(contract);
    const canonical = canonicalizeIdmlQuillHtml(html);
    const validation = validateIdmlTranslation(
        contract.sourceHtml,
        canonical,
        contract.metadata
    );
    if (!validation.valid) {
        throw new Error(
            validation.diagnostics.map((diagnostic) => diagnostic.message).join("; ")
        );
    }
    return canonical;
}

export function validateCanonicalIdmlTranslation(
    targetHtml: string,
    contract: IdmlEditorContract
): void {
    assertSupportedIdmlContract(contract);
    const validation = validateIdmlTranslation(
        contract.sourceHtml,
        targetHtml,
        contract.metadata
    );
    if (!validation.valid) {
        throw new Error(
            validation.diagnostics.map((diagnostic) => diagnostic.message).join("; ")
        );
    }
}
