import Quill from "quill";

const Inline = Quill.import("blots/inline") as any;

export const IDML_ANCHOR_ATTRIBUTE_NAMES = new Set([
    "contenteditable",
    "data-idml-character-style",
    "data-idml-protected",
    "data-idml-slot",
    "data-idml-token",
    "data-idml-token-kind",
]);

export class IdmlAnchorFormat extends Inline {
    static blotName = "idmlAnchor";
    static tagName = "span";
    static className = "idml-anchor";

    static create(value: Record<string, string>): HTMLElement {
        const node = super.create() as HTMLElement;
        for (const [name, attributeValue] of Object.entries(value ?? {})) {
            if (IDML_ANCHOR_ATTRIBUTE_NAMES.has(name)) {
                node.setAttribute(name, attributeValue);
            }
        }
        return node;
    }

    static formats(node: HTMLElement): Record<string, string> {
        return Array.from(node.attributes).reduce<Record<string, string>>(
            (attributes, attribute) => {
                if (IDML_ANCHOR_ATTRIBUTE_NAMES.has(attribute.name)) {
                    attributes[attribute.name] = attribute.value;
                }
                return attributes;
            },
            {}
        );
    }
}

export function registerIdmlQuillFormats(): void {
    Quill.register("formats/idmlAnchor", IdmlAnchorFormat, true);
}
