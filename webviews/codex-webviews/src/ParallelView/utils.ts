/**
 * Strips HTML tags and entities from text for search/replace operations
 * Uses DOM parsing when available for accuracy, falls back to regex
 */
export function stripHtml(text: string): string {
    if (!text) return "";

    // Use DOM parsing when available (browser context)
    if (typeof document !== "undefined") {
        try {
            const doc = new DOMParser().parseFromString(text, "text/html");
            const textContent = doc.body.textContent || "";
            // Normalize whitespace
            return textContent.replace(/\s+/g, " ").trim();
        } catch (error) {
            // Fall through to regex fallback
        }
    }

    // Regex fallback (works in all contexts)
    let strippedText = text.replace(/<[^>]*>/g, "");
    strippedText = strippedText.replace(/&nbsp; ?/g, " ");
    strippedText = strippedText.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#34;/g, "");
    strippedText = strippedText.replace(/&#\d+;/g, "");
    strippedText = strippedText.replace(/&[a-zA-Z]+;/g, "");
    return strippedText.trim();
}

/**
 * Escapes regex special characters in a string
 */
export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escapes HTML special characters for safe display
 */
export function escapeHtml(text: string): string {
    if (typeof document === "undefined") {
        // Fallback for non-browser contexts
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

