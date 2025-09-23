/**
 * Hash utilities for round-trip validation of InDesign files
 * Ensures loss-free editing by comparing file hashes before and after processing
 */

import { HashValidation } from './types';

/**
 * Compute SHA-256 hash of a string or ArrayBuffer
 */
export async function computeSHA256(data: string | ArrayBuffer): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;

    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute MD5 hash of a string or ArrayBuffer (for compatibility)
 */
export async function computeMD5(data: string | ArrayBuffer): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;

    const hashBuffer = await crypto.subtle.digest('MD5', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute SHA-512 hash of a string or ArrayBuffer
 */
export async function computeSHA512(data: string | ArrayBuffer): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;

    const hashBuffer = await crypto.subtle.digest('SHA-512', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate hash match for round-trip testing
 */
export function validateHash(
    originalHash: string,
    computedHash: string,
    algorithm: 'sha256' | 'sha512' | 'md5' = 'sha256'
): HashValidation {
    return {
        algorithm,
        originalHash,
        computedHash,
        match: originalHash === computedHash,
        timestamp: new Date().toISOString()
    };
}

/**
 * Normalize XML content for consistent hashing
 * Removes formatting differences that don't affect content
 */
export function normalizeXMLForHashing(xmlContent: string): string {
    return xmlContent
        // Remove XML declaration
        .replace(/<\?xml[^>]*\?>/g, '')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        // Remove empty lines
        .replace(/\n\s*\n/g, '\n')
        // Trim whitespace
        .trim();
}

/**
 * Create a content hash that ignores formatting but preserves structure
 */
export async function computeContentHash(xmlContent: string): Promise<string> {
    const normalized = normalizeXMLForHashing(xmlContent);
    return computeSHA256(normalized);
}

/**
 * Create a structural hash that preserves all formatting and IDs
 */
export async function computeStructuralHash(xmlContent: string): Promise<string> {
    return computeSHA256(xmlContent);
}

/**
 * Compare two IDML documents for structural equivalence
 */
export async function compareIDMLStructures(
    original: string,
    reconstructed: string
): Promise<{
    contentMatch: boolean;
    structuralMatch: boolean;
    contentHash: string;
    structuralHash: string;
    differences: string[];
}> {
    const originalContentHash = await computeContentHash(original);
    const reconstructedContentHash = await computeContentHash(reconstructed);

    const originalStructuralHash = await computeStructuralHash(original);
    const reconstructedStructuralHash = await computeStructuralHash(reconstructed);

    const contentMatch = originalContentHash === reconstructedContentHash;
    const structuralMatch = originalStructuralHash === reconstructedStructuralHash;

    const differences: string[] = [];
    if (!contentMatch) {
        differences.push('Content hash mismatch - text content differs');
    }
    if (!structuralMatch) {
        differences.push('Structural hash mismatch - formatting or structure differs');
    }

    return {
        contentMatch,
        structuralMatch,
        contentHash: originalContentHash,
        structuralHash: originalStructuralHash,
        differences
    };
}

/**
 * Generate a unique hash for a file based on its content and metadata
 */
export async function generateFileHash(
    content: string | ArrayBuffer,
    metadata?: Record<string, any>
): Promise<string> {
    const contentHash = await computeSHA256(content);

    if (metadata) {
        const metadataString = JSON.stringify(metadata, Object.keys(metadata).sort());
        const metadataHash = await computeSHA256(metadataString);
        return await computeSHA256(contentHash + metadataHash);
    }

    return contentHash;
}
