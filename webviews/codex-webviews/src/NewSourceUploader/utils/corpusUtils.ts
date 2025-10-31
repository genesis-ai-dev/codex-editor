/**
 * Re-export shared corpus utilities for use in webviews
 * The actual implementation is in sharedUtils/corpusUtils.ts
 */
export {
    getCorpusMarkerForBook,
    standardizeCorpusMarker,
    getCorpusDisplayName,
    isNewTestamentBook,
    isOldTestamentBook,
} from "@sharedUtils/corpusUtils";
