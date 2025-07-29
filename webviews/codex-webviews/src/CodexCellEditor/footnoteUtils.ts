/**
 * Footnote processing utilities for clean HTML manipulation
 * This replaces the HACKY_removeContiguousSpans approach with proper DOM manipulation
 */

export interface FootnoteInfo {
    id: string;
    content: string;
    position: number;
    element: Element;
}

/**
 * Processes HTML content to clean up contiguous spans and handle footnote spacing
 * @param html - Raw HTML content
 * @returns Cleaned HTML with proper footnote spacing
 */
export function processHtmlContent(html: string): string {
    if (!html || !html.trim()) {
        return html;
    }

    // Create a temporary DOM element for manipulation
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Step 1: Remove VSCode selection background styles
    removeVSCodeSelectionStyles(tempDiv);

    // Step 2: Remove contiguous spans (replacement for HACKY function)
    removeContiguousSpans(tempDiv);

    // Step 3: Process footnote spacing
    processFootnoteSpacing(tempDiv);

    return tempDiv.innerHTML;
}

/**
 * Removes VSCode selection background and foreground styles that can get persisted
 * when users save while the editor has selection highlighting active.
 * 
 * This fixes an issue where pressing backspace near footnotes can cause Quill/VSCode
 * to add selection highlighting styles (--vscode-editor-selectionBackground, 
 * --vscode-editor-selectionForeground) that get saved into the cell content.
 * 
 * Example of styles removed:
 * - background-color: var(--vscode-editor-selectionBackground, #0078d4);
 * - color: var(--vscode-editor-selectionForeground, white);
 */
function removeVSCodeSelectionStyles(container: Element): void {
    // Find all elements with style attributes
    const elementsWithStyle = container.querySelectorAll('[style]');
    
    elementsWithStyle.forEach(element => {
        const styleAttr = element.getAttribute('style');
        if (styleAttr) {
            // Remove VSCode selection background and foreground styles
            const cleanedStyle = styleAttr
                .replace(/background-color:\s*var\(--vscode-editor-selectionBackground[^)]*\)[^;]*;?/gi, '')
                .replace(/color:\s*var\(--vscode-editor-selectionForeground[^)]*\)[^;]*;?/gi, '')
                .trim()
                // Clean up any leftover semicolons or whitespace
                .replace(/^;+|;+$/g, '')
                .replace(/;{2,}/g, ';');
            
            if (cleanedStyle) {
                element.setAttribute('style', cleanedStyle);
            } else {
                element.removeAttribute('style');
            }
        }
    });
}

/**
 * Removes contiguous spans by merging their content
 * This is a clean replacement for HACKY_removeContiguousSpans
 */
function removeContiguousSpans(container: Element): void {
    const spans = container.querySelectorAll('span');

    spans.forEach(span => {
        const nextSibling = span.nextElementSibling;

        // If the next sibling is also a span with no special attributes
        if (nextSibling &&
            nextSibling.tagName === 'SPAN' &&
            !hasSpecialAttributes(span) &&
            !hasSpecialAttributes(nextSibling)) {

            // Merge the content
            span.innerHTML += nextSibling.innerHTML;
            nextSibling.remove();

            // Recursively check for more contiguous spans
            removeContiguousSpans(container);
        }
    });
}

/**
 * Checks if a span has special attributes that should prevent merging
 */
function hasSpecialAttributes(element: Element): boolean {
    const specialAttributes = ['class', 'id', 'style', 'data-'];

    return Array.from(element.attributes).some(attr =>
        specialAttributes.some(special =>
            attr.name === special || attr.name.startsWith('data-')
        )
    );
}

/**
 * Processes footnote spacing to ensure consecutive footnotes are properly separated
 */
function processFootnoteSpacing(container: Element): void {
    const footnoteMarkers = container.querySelectorAll('sup.footnote-marker');

    for (let i = 0; i < footnoteMarkers.length - 1; i++) {
        const currentMarker = footnoteMarkers[i];
        const nextMarker = footnoteMarkers[i + 1];

        // Check if markers are adjacent (no meaningful content between them)
        if (areFootnotesAdjacent(currentMarker, nextMarker)) {
            insertSpacingBetweenFootnotes(currentMarker, nextMarker);
        }
    }
}

/**
 * Determines if two footnote markers are adjacent and need spacing
 */
function areFootnotesAdjacent(current: Element, next: Element): boolean {
    let walker = current.nextSibling;

    while (walker && walker !== next) {
        // If we find meaningful text content, they're not adjacent
        if (walker.nodeType === Node.TEXT_NODE && walker.textContent?.trim()) {
            return false;
        }

        // If we find other meaningful elements, they're not adjacent
        if (walker.nodeType === Node.ELEMENT_NODE &&
            !(walker as Element).classList.contains('footnote-marker')) {
            return false;
        }

        walker = walker.nextSibling;
    }

    return walker === next;
}

/**
 * Inserts proper spacing between adjacent footnote markers
 */
function insertSpacingBetweenFootnotes(current: Element, next: Element): void {
    // Check if spacing already exists
    let walker = current.nextSibling;
    let hasSpacing = false;

    while (walker && walker !== next) {
        if (walker.nodeType === Node.TEXT_NODE &&
            (walker.textContent?.includes('\u00A0') || walker.textContent?.includes('\u2009'))) {
            hasSpacing = true;
            break;
        }
        walker = walker.nextSibling;
    }

    // Insert spacing if it doesn't exist
    if (!hasSpacing) {
        const spacingNode = document.createTextNode('\u2009'); // Thin space (much smaller than non-breaking space)
        current.parentNode?.insertBefore(spacingNode, next);
    }
}

/**
 * Extracts footnote information from HTML content in document order
 */
export function extractFootnotes(html: string): FootnoteInfo[] {
    if (!html) return [];

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const footnotes: FootnoteInfo[] = [];

    // Find all footnote markers
    const footnoteMarkers = doc.querySelectorAll('sup.footnote-marker');

    footnoteMarkers.forEach((marker, index) => {
        const id = marker.textContent || `fn${index + 1}`;
        const content = marker.getAttribute('data-footnote') || '';

        // Calculate position using TreeWalker for accurate document order
        const treeWalker = doc.createTreeWalker(
            doc.body,
            NodeFilter.SHOW_ALL
        );

        let position = 0;
        let current = treeWalker.nextNode();

        while (current && current !== marker) {
            position++;
            current = treeWalker.nextNode();
        }

        footnotes.push({
            id,
            content,
            position,
            element: marker
        });
    });

    // Sort by document position
    footnotes.sort((a, b) => a.position - b.position);

    return footnotes;
}

/**
 * Updates footnote numbering with proper section-based sequence
 */
export function updateFootnoteNumbering(
    container: Element,
    startNumber: number = 1,
    showFnPrefix: boolean = false
): number {
    const footnoteMarkers = container.querySelectorAll('sup.footnote-marker');
    let currentNumber = startNumber;

    footnoteMarkers.forEach((marker, index) => {
        const nextMarker = footnoteMarkers[index + 1];
        const isFollowedByAnotherFootnote = nextMarker &&
            areFootnotesAdjacent(marker, nextMarker);

        // Set the footnote number with optional "fn" prefix
        // No need to add space here since spacing is handled by processFootnoteSpacing
        const numberText = showFnPrefix ? `fn${currentNumber}` : `${currentNumber}`;
        const displayText = numberText;

        if (marker.textContent !== displayText) {
            marker.textContent = displayText;
        }

        currentNumber++;
    });

    return currentNumber; // Return next available number
} 