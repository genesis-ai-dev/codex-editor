/**
 * Importer types whose notebooks contain scripture organized by book/chapter/verse.
 * Single source of truth shared by the NewSourceUploader (milestone insertion) and the
 * extension host (verse-range reorder during migration and sync merges).
 *
 * All entries must be lowercase — callers normalize before comparing.
 */
export const BIBLE_TYPE_IMPORTERS: readonly string[] = [
    "usfm",
    "usfm-experimental",
    "paratext",
    "ebiblecorpus",
    "ebible",
    "ebible-download",
    "maculabible",
    "macula",
    "biblica",
    "obs",
    "pdf", // PDF can contain Bible content
    "indesign", // InDesign can contain Bible content
];

/**
 * Returns true when the importer type produces scripture-shaped notebooks (per-chapter
 * milestones and verse-level globalReferences). Unknown or missing types return false.
 */
export function isBibleTypeImporter(importerType: string | undefined | null): boolean {
    if (!importerType) {
        return false;
    }
    return BIBLE_TYPE_IMPORTERS.includes(importerType.toLowerCase().trim());
}
