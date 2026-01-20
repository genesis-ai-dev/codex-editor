import { ProcessedCell } from "../../types/common";
import { v4 as uuidv4 } from "uuid";

interface ParsedSection {
    content: string;
    metadata: Record<string, any>;
}

/**
 * Intelligently parse JSON content into sections
 * @param jsonContent - The raw JSON string
 * @param fileName - The original filename (without extension)
 * @returns Array of processed cells or null if not valid JSON
 */
export function parseJsonIntelligently(
    jsonContent: string,
    fileName: string
): ProcessedCell[] | null {
    try {
        const data = JSON.parse(jsonContent);
        return parseJsonData(data, fileName);
    } catch (error) {
        // Not valid JSON, return null to use regular text parsing
        return null;
    }
}

/**
 * Parse JSON data into cells based on its structure
 */
function parseJsonData(data: any, fileName: string, sectionIndex: number = 1): ProcessedCell[] {
    const cells: ProcessedCell[] = [];

    if (Array.isArray(data)) {
        // Handle array of objects (like the Psalms example)
        if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
            // Array of objects - each object becomes a section
            data.forEach((item, index) => {
                const section = parseObjectToSection(item);
                const legacyId = `${fileName} ${index + 1}:1`;
                const id = uuidv4();
                cells.push({
                    id,
                    content: section.content,
                    metadata: {
                        type: "json-object",
                        ...section.metadata,
                        sectionIndex: index + 1,
                        data: {
                            originalText: section.content,
                            globalReferences: [legacyId],
                        },
                    },
                    images: [],
                });
            });
        } else {
            // Array of primitives or mixed content
            const content = data.map((item, index) => {
                if (typeof item === 'object') {
                    return JSON.stringify(item, null, 2);
                }
                return String(item);
            }).join('\n\n');

            const legacyId = `${fileName} ${sectionIndex}:1`;
            const id = uuidv4();
            cells.push({
                id,
                content: content,
                metadata: {
                    type: "json-array",
                    arrayLength: data.length,
                    data: {
                        originalText: content,
                        globalReferences: [legacyId],
                    },
                },
                images: [],
            });
        }
    } else if (typeof data === 'object' && data !== null) {
        // Single object
        const section = parseObjectToSection(data);
        const legacyId = `${fileName} ${sectionIndex}:1`;
        const id = uuidv4();
        cells.push({
            id,
            content: section.content,
            metadata: {
                type: "json-object",
                ...section.metadata,
                data: {
                    originalText: section.content,
                    globalReferences: [legacyId],
                },
            },
            images: [],
        });
    } else {
        // Primitive value
        const legacyId = `${fileName} ${sectionIndex}:1`;
        const id = uuidv4();
        cells.push({
            id,
            content: String(data),
            metadata: {
                type: "json-primitive",
                valueType: typeof data,
                data: {
                    originalText: String(data),
                    globalReferences: [legacyId],
                },
            },
            images: [],
        });
    }

    return cells;
}

/**
 * Convert an object to a readable section
 */
function parseObjectToSection(obj: any): ParsedSection {
    const metadata: Record<string, any> = {};
    const contentParts: string[] = [];

    // Look for common title/header fields
    const titleFields = ['title', 'name', 'heading', 'label', 'id'];
    let title = '';

    for (const field of titleFields) {
        if (obj[field] && typeof obj[field] === 'string') {
            title = obj[field];
            metadata.title = title;
            break;
        }
    }

    // Look for main content fields
    const contentFields = ['content', 'text', 'body', 'description', 'lyrics', 'message', 'value'];
    const foundContentFields: string[] = [];

    // Add title if found
    if (title) {
        contentParts.push(title);
        contentParts.push(''); // Empty line after title
    }

    // Process all fields
    for (const [key, value] of Object.entries(obj)) {
        // Skip if already used as title
        if (titleFields.includes(key) && value === title) {
            continue;
        }

        if (contentFields.includes(key)) {
            foundContentFields.push(key);
            if (typeof value === 'string') {
                contentParts.push(value);
            } else if (Array.isArray(value)) {
                contentParts.push(value.map(item =>
                    typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)
                ).join('\n'));
            } else if (typeof value === 'object') {
                contentParts.push(JSON.stringify(value, null, 2));
            } else {
                contentParts.push(String(value));
            }
        } else {
            // Store other fields in metadata
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                metadata[key] = value;
            }
        }
    }

    // If no recognized content fields, format all fields
    if (foundContentFields.length === 0) {
        for (const [key, value] of Object.entries(obj)) {
            if (titleFields.includes(key) && value === title) {
                continue;
            }

            if (typeof value === 'string' || typeof value === 'number') {
                contentParts.push(`${formatFieldName(key)}: ${value}`);
            } else if (typeof value === 'boolean') {
                contentParts.push(`${formatFieldName(key)}: ${value ? 'Yes' : 'No'}`);
            } else if (Array.isArray(value)) {
                contentParts.push(`${formatFieldName(key)}:`);
                value.forEach(item => {
                    contentParts.push(`  - ${typeof item === 'object' ? JSON.stringify(item) : item}`);
                });
            } else if (typeof value === 'object' && value !== null) {
                contentParts.push(`${formatFieldName(key)}:`);
                contentParts.push(JSON.stringify(value, null, 2).split('\n').map(line => '  ' + line).join('\n'));
            }
        }
    }

    return {
        content: contentParts.join('\n'),
        metadata,
    };
}

/**
 * Format field names for display (e.g., "firstName" -> "First Name")
 */
function formatFieldName(fieldName: string): string {
    return fieldName
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
        .replace(/_/g, ' ') // snake_case to spaces
        .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize words
}

/**
 * Detect if content might be JSON
 */
export function mightBeJson(content: string): boolean {
    const trimmed = content.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'));
} 