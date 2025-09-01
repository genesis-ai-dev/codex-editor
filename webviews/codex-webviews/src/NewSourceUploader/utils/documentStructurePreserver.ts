/**
 * Document Structure Preservation System
 * 
 * This module implements CAT/TMS best practices for preserving document structure
 * during import/export cycles. It stores segment offsets, structural metadata,
 * and manages original file references to enable lossless round-tripping.
 */

export interface SegmentMetadata {
    /** Character offset in the original document */
    originalStart: number;
    /** Character offset end in the original document */
    originalEnd: number;
    /** Original HTML/XML content before any processing */
    originalContent: string;
    /** XPath or DOM path to the element in the document structure */
    structuralPath?: string;
    /** Style information (for Word docs: paragraph/run styles) */
    styles?: {
        paragraphStyle?: string;
        runStyles?: string[];
        formatting?: Record<string, any>;
    };
    /** Parent element context */
    parentContext?: {
        tagName: string;
        attributes?: Record<string, string>;
    };
    /** Inline markup that may have been modified */
    inlineMarkup?: {
        bold?: number[][];      // Array of [start, end] positions
        italic?: number[][];
        underline?: number[][];
        superscript?: number[][];
        subscript?: number[][];
        links?: Array<{
            start: number;
            end: number;
            href: string;
        }>;
    };
    /** Checksum of original content for integrity verification */
    checksum?: string;
}

export interface DocumentStructureMetadata {
    /** Reference to the original document stored in attachments */
    originalFileRef: string;
    /** MIME type of the original document */
    originalMimeType: string;
    /** SHA-256 hash of the original file for integrity */
    originalFileHash: string;
    /** Timestamp when the document was imported */
    importedAt: string;
    /** Document-level metadata */
    documentMetadata?: {
        title?: string;
        author?: string;
        createdDate?: string;
        modifiedDate?: string;
        customProperties?: Record<string, any>;
    };
    /** Mapping of segment IDs to their structural metadata */
    segments: Map<string, SegmentMetadata>;
    /** Document structure tree for reconstruction */
    structureTree?: DocumentNode;
    /** Version of the preservation format */
    preservationFormatVersion: string;
}

export interface DocumentNode {
    type: 'element' | 'text' | 'comment';
    name?: string;
    attributes?: Record<string, string>;
    children?: DocumentNode[];
    segmentId?: string; // Reference to cell ID if this node contains translatable content
    content?: string;   // For text nodes
}

/**
 * Creates segment metadata for a piece of content
 */
export async function createSegmentMetadata(
    content: string,
    startOffset: number,
    endOffset: number,
    structuralInfo?: Partial<SegmentMetadata>
): Promise<SegmentMetadata> {
    return {
        originalStart: startOffset,
        originalEnd: endOffset,
        originalContent: content,
        checksum: await generateChecksum(content),
        ...structuralInfo
    };
}

/**
 * Generates a SHA-256 checksum for content verification
 */
export async function generateChecksum(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Tracks character offsets while processing HTML/XML content
 */
export class OffsetTracker {
    private currentOffset: number = 0;
    private segments: Map<string, SegmentMetadata> = new Map();

    /**
 * Records a segment with its position in the original document
 */
    recordSegment(
        segmentId: string,
        content: string,
        structuralInfo?: Partial<SegmentMetadata>
    ): void {
        const startOffset = this.currentOffset;
        const endOffset = startOffset + content.length;

        // For simplicity in the tracker, we don't generate checksum here
        // It can be added later if needed
        this.segments.set(segmentId, {
            originalStart: startOffset,
            originalEnd: endOffset,
            originalContent: content,
            ...structuralInfo
        } as SegmentMetadata);

        this.currentOffset = endOffset;
    }

    /**
     * Advances the offset without recording a segment (for non-translatable content)
     */
    advanceOffset(length: number): void {
        this.currentOffset += length;
    }

    /**
     * Gets all recorded segments
     */
    getSegments(): Map<string, SegmentMetadata> {
        return new Map(this.segments);
    }

    /**
     * Gets the current offset position
     */
    getCurrentOffset(): number {
        return this.currentOffset;
    }
}

/**
 * Builds a structure tree from parsed HTML/XML
 */
export function buildStructureTree(
    parsedContent: any[], // From XML parser
    segmentMap: Map<string, string> // Maps content to segment IDs
): DocumentNode {
    // Handle empty or invalid input
    if (!parsedContent || !Array.isArray(parsedContent) || parsedContent.length === 0) {
        // Return a simple structure tree with segments as direct children
        const children: DocumentNode[] = [];
        let index = 0;
        segmentMap.forEach((segmentId, content) => {
            children.push({
                type: 'element',
                name: 'div',
                children: [{
                    type: 'text',
                    content,
                    segmentId
                }]
            });
            index++;
        });

        return {
            type: 'element',
            name: 'root',
            children
        };
    }

    function processNode(node: any): DocumentNode | null {
        if (typeof node === 'string') {
            return {
                type: 'text',
                content: node
            };
        }

        if (node['#text']) {
            const content = node['#text'];
            const segmentId = segmentMap.get(content);
            return {
                type: 'text',
                content,
                segmentId
            };
        }

        // Process element nodes
        const elementName = Object.keys(node).find(key => !key.startsWith('@_') && key !== '#text');
        if (!elementName) return null;

        const attributes: Record<string, string> = {};
        Object.keys(node).forEach(key => {
            if (key.startsWith('@_')) {
                attributes[key.substring(2)] = node[key];
            }
        });

        const children: DocumentNode[] = [];
        const elementContent = node[elementName];

        if (Array.isArray(elementContent)) {
            elementContent.forEach(child => {
                const processed = processNode(child);
                if (processed) children.push(processed);
            });
        } else if (typeof elementContent === 'object') {
            const processed = processNode(elementContent);
            if (processed) children.push(processed);
        } else if (typeof elementContent === 'string') {
            const segmentId = segmentMap.get(elementContent);
            children.push({
                type: 'text',
                content: elementContent,
                segmentId
            });
        }

        return {
            type: 'element',
            name: elementName,
            attributes,
            children
        };
    }

    // Process root nodes
    const rootChildren: DocumentNode[] = [];
    parsedContent.forEach(item => {
        const processed = processNode(item);
        if (processed) rootChildren.push(processed);
    });

    return {
        type: 'element',
        name: 'root',
        children: rootChildren
    };
}

/**
 * Reconstructs the original document structure with updated content
 */
export function reconstructDocument(
    structureTree: DocumentNode,
    updatedSegments: Map<string, string>
): string {
    function nodeToString(node: DocumentNode): string {
        if (node.type === 'text') {
            // If this text node has a segment ID, use the updated content
            if (node.segmentId && updatedSegments.has(node.segmentId)) {
                return updatedSegments.get(node.segmentId) || node.content || '';
            }
            return node.content || '';
        }

        if (node.type === 'comment') {
            return `<!-- ${node.content || ''} -->`;
        }

        if (node.type === 'element' && node.name) {
            // Skip root wrapper
            if (node.name === 'root') {
                return node.children?.map(nodeToString).join('') || '';
            }

            const attrs = node.attributes
                ? ' ' + Object.entries(node.attributes)
                    .map(([key, value]) => `${key}="${value}"`)
                    .join(' ')
                : '';

            const children = node.children?.map(nodeToString).join('') || '';

            // Self-closing tags
            if (!children && ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(node.name.toLowerCase())) {
                return `<${node.name}${attrs} />`;
            }

            return `<${node.name}${attrs}>${children}</${node.name}>`;
        }

        return '';
    }

    return nodeToString(structureTree);
}

/**
 * Validates that content can be successfully round-tripped
 */
export async function validateRoundTrip(
    original: string,
    reconstructed: string,
    allowedDifferences?: {
        whitespaceNormalization?: boolean;
        selfClosingTags?: boolean;
        attributeOrder?: boolean;
    }
): Promise<{
    isValid: boolean;
    differences?: string[];
    similarity: number;
}> {
    let normalizedOriginal = original;
    let normalizedReconstructed = reconstructed;

    // Apply allowed normalizations
    if (allowedDifferences?.whitespaceNormalization) {
        normalizedOriginal = normalizedOriginal.replace(/\s+/g, ' ').trim();
        normalizedReconstructed = normalizedReconstructed.replace(/\s+/g, ' ').trim();
    }

    if (allowedDifferences?.selfClosingTags) {
        // Normalize self-closing tags
        normalizedOriginal = normalizedOriginal.replace(/<(\w+)(\s[^>]*)?\s*\/>/g, '<$1$2></$1>');
        normalizedReconstructed = normalizedReconstructed.replace(/<(\w+)(\s[^>]*)?\s*\/>/g, '<$1$2></$1>');
    }

    // Calculate similarity percentage
    const similarity = calculateSimilarity(normalizedOriginal, normalizedReconstructed);

    // Exact match after normalization
    if (normalizedOriginal === normalizedReconstructed) {
        return { isValid: true, similarity: 1.0 };
    }

    // Find differences
    const differences: string[] = [];
    const lines1 = normalizedOriginal.split('\n');
    const lines2 = normalizedReconstructed.split('\n');

    for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
        if (lines1[i] !== lines2[i]) {
            differences.push(`Line ${i + 1}: "${lines1[i] || '(missing)'}" !== "${lines2[i] || '(missing)'}"`);
        }
    }

    return {
        isValid: similarity > 0.95, // 95% similarity threshold
        differences: differences.slice(0, 10), // Limit to first 10 differences
        similarity
    };
}

/**
 * Calculates string similarity using Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

/**
 * Calculates Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Serializes document structure metadata for storage
 */
export function serializeDocumentStructure(
    metadata: DocumentStructureMetadata
): string {
    const serializable = {
        ...metadata,
        segments: Array.from(metadata.segments.entries())
    };
    return JSON.stringify(serializable, null, 2);
}

/**
 * Deserializes document structure metadata from storage
 */
export function deserializeDocumentStructure(
    json: string
): DocumentStructureMetadata {
    const parsed = JSON.parse(json);
    return {
        ...parsed,
        segments: new Map(parsed.segments)
    };
}
