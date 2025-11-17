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

/**
 * Checks if a search query can be replaced in HTML content
 * Returns true if the query matches within at least one text node (not spanning HTML boundaries)
 */
export function canReplaceInHtml(htmlContent: string, searchQuery: string): boolean {
    if (!htmlContent || !searchQuery) return false;
    
    if (typeof document === "undefined") {
        // Fallback: assume it can be replaced if DOM not available
        return true;
    }
    
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, "text/html");
        const queryRegex = new RegExp(escapeRegex(searchQuery), "gi");
        
        // Check if query matches in any text node
        const checkTextNodes = (node: Node): boolean => {
            if (node.nodeType === Node.TEXT_NODE) {
                const textNode = node as Text;
                if (textNode.textContent && queryRegex.test(textNode.textContent)) {
                    return true;
                }
            } else {
                for (const child of Array.from(node.childNodes)) {
                    if (checkTextNodes(child)) {
                        return true;
                    }
                }
            }
            return false;
        };
        
        return checkTextNodes(doc.body);
    } catch (error) {
        // Fallback: assume it can be replaced on error
        return true;
    }
}

/**
 * Replaces text in HTML content while preserving HTML tags
 * Only replaces in text nodes - if HTML interrupts the search, it won't match
 */
export function replaceTextPreservingHtml(htmlContent: string, searchQuery: string, replacement: string): string {
    if (!htmlContent || !searchQuery) return htmlContent;
    
    if (typeof document === "undefined") {
        // Fallback: simple string replace if DOM not available
        const queryRegex = new RegExp(escapeRegex(searchQuery), "gi");
        return htmlContent.replace(queryRegex, replacement);
    }
    
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, "text/html");
        const queryRegex = new RegExp(escapeRegex(searchQuery), "gi");
        
        // Replace only in text nodes
        const walkTextNodes = (node: Node): void => {
            if (node.nodeType === Node.TEXT_NODE) {
                const textNode = node as Text;
                if (textNode.textContent) {
                    textNode.textContent = textNode.textContent.replace(queryRegex, replacement);
                }
            } else {
                for (const child of Array.from(node.childNodes)) {
                    walkTextNodes(child);
                }
            }
        };
        
        walkTextNodes(doc.body);
        return doc.body.innerHTML;
    } catch (error) {
        // Fallback: simple string replace on error
        const queryRegex = new RegExp(escapeRegex(searchQuery), "gi");
        return htmlContent.replace(queryRegex, replacement);
    }
}

