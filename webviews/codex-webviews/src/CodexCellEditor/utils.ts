import type React from "react";
import type { QuillCellContent } from "../../../../types";
import type { ProgressPercentages } from "../lib/types";

export const processVerseContent = (cellContent: string) => {
    const verseRefRegex = /(?<=^|\s)(?=[A-Z, 1-9]{3} \d{1,3}:\d{1,3})/;
    const lines = cellContent.split(verseRefRegex);
    return lines
        .map((line) => {
            const verseMarker = line.match(/(\b[A-Z, 1-9]{3}\s\d+:\d+\b)/)?.[0];
            if (verseMarker) {
                const lineWithoutVerseRefMarker = line
                    .replace(`${verseMarker} `, "")
                    .replace(`${verseMarker}\n`, "")
                    .replace(`${verseMarker}`, "");
                return {
                    verseMarkers: [verseMarker],
                    verseContent: lineWithoutVerseRefMarker,
                };
            }
            return null;
        })
        .filter((line) => line !== null);
};

/**
 * @deprecated This function has been replaced with proper utilities in footnoteUtils.ts
 * Use `processHtmlContent` from footnoteUtils.ts instead for better maintainability and type safety.
 * 
 * This function is kept temporarily for backward compatibility but should not be used in new code.
 */
export const HACKY_removeContiguousSpans = (html: string) => {
    console.warn('HACKY_removeContiguousSpans is deprecated. Use processHtmlContent from footnoteUtils.ts instead.');

    // Import the proper function dynamically to avoid circular dependencies
    try {
        // For now, provide basic functionality while migration is complete
        return html.replace(/<\/span><span>/g, "");
    } catch (error) {
        console.error('Error in deprecated HACKY_removeContiguousSpans:', error);
        return html;
    }
};

export const sanitizeQuillHtml = (originalHTML: string) => {
    return originalHTML.replace(/<div>/g, "<span>").replace(/<\/div>/g, "</span>");
};

/**
 * LRU Cache helper functions for milestone pagination
 */

export interface CacheHelpers {
    getCachedCells: (pageKey: string) => QuillCellContent[] | undefined;
    setCachedCells: (pageKey: string, cells: QuillCellContent[]) => void;
}

/**
 * Creates cache helper functions for managing an LRU cache with a maximum size
 * @param cacheRef - Ref to the Map storing cached cells
 * @param loadedPagesRef - Ref to the Set tracking loaded pages
 * @param maxCacheSize - Maximum number of entries to keep in cache (default: 10)
 * @param debugFn - Optional debug function for logging cache evictions
 * @returns Object with getCachedCells and setCachedCells functions
 */
export function createCacheHelpers(
    cacheRef: React.MutableRefObject<Map<string, QuillCellContent[]>>,
    loadedPagesRef: React.MutableRefObject<Set<string>>,
    maxCacheSize: number = 10,
    debugFn?: (category: string, message: string | object, ...args: any[]) => void
): CacheHelpers {
    const getCachedCells = (pageKey: string): QuillCellContent[] | undefined => {
        const cache = cacheRef.current;
        if (cache.has(pageKey)) {
            // Re-insert to mark as recently used (Map maintains insertion order)
            const cells = cache.get(pageKey)!;
            cache.delete(pageKey);
            cache.set(pageKey, cells);
            return cells;
        }
        return undefined;
    };

    const setCachedCells = (pageKey: string, cells: QuillCellContent[]) => {
        const cache = cacheRef.current;

        // If key already exists, remove it first to update position
        if (cache.has(pageKey)) {
            cache.delete(pageKey);
        }

        // If at limit, remove oldest entry (first in Map)
        if (cache.size >= maxCacheSize) {
            const firstKey = cache.keys().next().value;
            if (firstKey) {
                cache.delete(firstKey);
                loadedPagesRef.current.delete(firstKey);
                if (debugFn) {
                    debugFn("pagination", `Evicting oldest cache entry: ${firstKey}`);
                }
            }
        }

        // Add new entry (will be at end, most recent)
        cache.set(pageKey, cells);
    };

    return { getCachedCells, setCachedCells };
}

/**
 * LRU Cache helper functions for milestone progress caching
 */

export interface ProgressCacheHelpers {
    getCachedProgress: (milestoneIdx: number) => Record<number, ProgressPercentages> | undefined;
    setCachedProgress: (milestoneIdx: number, progress: Record<number, ProgressPercentages>) => void;
}

/**
 * Creates cache helper functions for managing an LRU cache for milestone progress with a maximum size
 * @param cacheRef - Ref to the Map storing cached progress
 * @param maxCacheSize - Maximum number of entries to keep in cache (default: 10)
 * @param setSubsectionProgress - State setter function to update subsection progress state
 * @param debugFn - Optional debug function for logging cache evictions
 * @returns Object with getCachedProgress and setCachedProgress functions
 */
export function createProgressCacheHelpers(
    cacheRef: React.MutableRefObject<Map<number, Record<number, ProgressPercentages>>>,
    maxCacheSize: number = 10,
    setSubsectionProgress: React.Dispatch<React.SetStateAction<Record<number, Record<number, ProgressPercentages>>>>,
    debugFn?: (category: string, message: string | object, ...args: any[]) => void
): ProgressCacheHelpers {
    const getCachedProgress = (milestoneIdx: number): Record<number, ProgressPercentages> | undefined => {
        const cache = cacheRef.current;
        if (cache.has(milestoneIdx)) {
            // Re-insert to mark as recently used (Map maintains insertion order)
            const progress = cache.get(milestoneIdx)!;
            cache.delete(milestoneIdx);
            cache.set(milestoneIdx, progress);
            return progress;
        }
        return undefined;
    };

    const setCachedProgress = (milestoneIdx: number, progress: Record<number, ProgressPercentages>) => {
        const cache = cacheRef.current;

        // If key already exists, remove it first to update position
        if (cache.has(milestoneIdx)) {
            cache.delete(milestoneIdx);
        }

        // If at limit, remove oldest entry (first in Map)
        if (cache.size >= maxCacheSize) {
            const firstKey = cache.keys().next().value;
            if (firstKey !== undefined) {
                cache.delete(firstKey);
                if (debugFn) {
                    debugFn("pagination", `Evicting oldest progress cache entry: milestone ${firstKey}`);
                }
            }
        }

        // Add new entry (will be at end, most recent)
        cache.set(milestoneIdx, progress);

        // Update state from cache
        setSubsectionProgress(Object.fromEntries(cache));
    };

    return { getCachedProgress, setCachedProgress };
}
