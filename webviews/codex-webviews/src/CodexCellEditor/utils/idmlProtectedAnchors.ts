import {
    IDML_SCHEMA_VERSION,
    validateIdmlTranslation,
} from "@aquilla/idml-roundtrip";
import type { IdmlFormatMetadataV2 } from "@aquilla/idml-roundtrip";

export const IDML_EMPTY_ANCHOR_SENTINEL = "\uFEFF";

export interface IdmlEditorContract {
    readonly metadata: unknown;
    readonly sourceHtml: string;
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
        lineBreak.classList.add("idml-soft-break");
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
    for (const lineBreak of Array.from(
        root.querySelectorAll<HTMLBRElement>("br.idml-soft-break")
    )) {
        lineBreak.classList.remove("idml-soft-break");
        if (lineBreak.classList.length === 0) {
            lineBreak.removeAttribute("class");
        }
    }

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

        for (const textNode of Array.from(node.childNodes)) {
            if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
                textNode.textContent = textNode.textContent.replaceAll(
                    IDML_EMPTY_ANCHOR_SENTINEL,
                    ""
                );
            }
        }
    }
    return root.outerHTML;
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
