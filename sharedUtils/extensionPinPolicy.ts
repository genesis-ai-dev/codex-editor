import { EXTENSION_PIN_POLICY } from "./extensionPinFeatureFlag";
/** Temporary compatibility policy: project extension pins are disabled.
 * Keep the legacy empty-map representation understood by existing binaries.
 * Do not use empty version/url entries: older Conductors treat those as pins.
 */
export function clearMetadataPins(metadata: unknown): boolean {
    if (!EXTENSION_PIN_POLICY.ignoreProjectPins) { return false; }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("Cannot clear extension pins: metadata.json must contain an object");
    }
    const document = metadata as Record<string, unknown>;
    if (document.meta === undefined) {
        document.meta = {};
    }
    if (!document.meta || typeof document.meta !== "object" || Array.isArray(document.meta)) {
        throw new Error("Cannot clear extension pins: metadata.meta must be an object");
    }
    const meta = document.meta as Record<string, unknown>;
    const pins = meta.pinnedExtensions;
    if (pins && typeof pins === "object" && !Array.isArray(pins) && Object.keys(pins).length === 0) {
        return false;
    }
    meta.pinnedExtensions = {};
    return true;
}
