/**
 * Utility functions for normalizing corpusMarker values to ensure consistent grouping.
 * Handles case-insensitive matching and plural/singular variations.
 */

export type CorpusMarker = string | undefined | null;

/**
 * Normalizes a corpusMarker value for comparison.
 * - Trims whitespace
 * - Converts to lowercase
 * - Handles plural/singular variations
 * 
 * @param corpusMarker - The corpusMarker value to normalize
 * @returns Normalized corpusMarker value
 */
export function normalizeCorpusMarker(corpusMarker: CorpusMarker): string | undefined {
    if (!corpusMarker) return undefined;

    // Trim whitespace and convert to lowercase
    const trimmed = corpusMarker.trim().toLowerCase();
    if (!trimmed) return undefined;

    // Handle special cases for Bible markers (OT/NT)
    if (trimmed === 'ot' || trimmed === 'old testament') return 'OT';
    if (trimmed === 'nt' || trimmed === 'new testament') return 'NT';

    // For other markers, return the trimmed lowercase version
    // This ensures "subtitle" and "subtitles" are treated as different
    // We'll handle plural/singular matching in the comparison function
    return trimmed;
}

/**
 * Checks if two corpusMarker values are equivalent (case-insensitive, handles plural/singular).
 * 
 * @param marker1 - First corpusMarker value
 * @param marker2 - Second corpusMarker value
 * @returns True if the markers are equivalent
 */
export function areCorpusMarkersEquivalent(marker1: CorpusMarker, marker2: CorpusMarker): boolean {
    const norm1 = normalizeCorpusMarker(marker1);
    const norm2 = normalizeCorpusMarker(marker2);

    if (!norm1 || !norm2) return false;

    // Exact match after normalization
    if (norm1 === norm2) return true;

    // Check for plural/singular variations
    // Handle common plural/singular patterns
    const singular1 = norm1.replace(/s$/, '');
    const singular2 = norm2.replace(/s$/, '');

    // If removing 's' makes them match, they're equivalent
    if (singular1 === singular2 && singular1.length > 0) {
        return true;
    }

    // Also check if one is the plural of the other
    if (norm1 === `${norm2}s` || norm2 === `${norm1}s`) {
        return true;
    }

    return false;
}

/**
 * Finds the canonical corpusMarker value from a list of existing markers.
 * Normalizes equivalent markers to the same casing for consistent grouping.
 * 
 * @param existingMarkers - Array of existing corpusMarker values
 * @param incomingMarker - The incoming corpusMarker value to normalize
 * @returns The canonical corpusMarker value to use (normalized to lowercase except OT/NT)
 */
export function findCanonicalCorpusMarker(
    existingMarkers: CorpusMarker[],
    incomingMarker: CorpusMarker
): CorpusMarker {
    if (!incomingMarker) return incomingMarker;

    const normalizedIncoming = normalizeCorpusMarker(incomingMarker);
    if (!normalizedIncoming) return incomingMarker.trim();

    // Find all existing markers that are equivalent to the incoming one
    const equivalentMarkers = existingMarkers.filter(m =>
        areCorpusMarkersEquivalent(m, incomingMarker)
    );

    if (equivalentMarkers.length === 0) {
        // No equivalent markers found, normalize to lowercase for consistency
        // (except OT/NT which should be uppercase)
        if (normalizedIncoming === 'ot') return 'OT';
        if (normalizedIncoming === 'nt') return 'NT';
        return normalizedIncoming;
    }

    // Count occurrences of each equivalent marker (case-sensitive original)
    const markerCounts = new Map<string, number>();
    equivalentMarkers.forEach(m => {
        if (m) {
            const key = m.trim();
            markerCounts.set(key, (markerCounts.get(key) || 0) + 1);
        }
    });

    // Find the most common marker (or first one if tied)
    let canonicalMarker: string | undefined;
    let maxCount = 0;

    markerCounts.forEach((count, marker) => {
        if (count > maxCount) {
            maxCount = count;
            canonicalMarker = marker;
        }
    });

    // Normalize the canonical marker to lowercase for consistency
    // (except OT/NT which should be uppercase)
    if (canonicalMarker) {
        const normalizedCanonical = normalizeCorpusMarker(canonicalMarker);
        if (normalizedCanonical === 'ot') return 'OT';
        if (normalizedCanonical === 'nt') return 'NT';
        return normalizedCanonical;
    }

    // Fallback: normalize incoming marker
    if (normalizedIncoming === 'ot') return 'OT';
    if (normalizedIncoming === 'nt') return 'NT';
    return normalizedIncoming;
}

