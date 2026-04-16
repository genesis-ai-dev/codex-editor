/**
 * Export format visibility by notebook "group key" (see getGroupKeyFromMetadata in exportViewUtils).
 * Must stay aligned with projectExportView initStep2Options: missing key ⇒ always visible.
 */
export const EXPORT_OPTIONS_BY_FILE_TYPE: Record<string, string[]> = {
    roundTrip: [
        "docx",
        "indesign",
        "biblica",
        "reach4life",
        "pdf",
        "obs",
        "markdown",
        "tms",
        "usfm",
        "spreadsheet",
    ],
    usfm: ["ebible", "usfm", "maculabible", "unknown", "paratext"],
    html: ["ebible", "usfm", "maculabible", "unknown", "paratext"],
    subtitles: ["subtitles", "unknown"],
};

/**
 * Same rule as projectExportView show(option): unrestricted if not listed in EXPORT_OPTIONS_BY_FILE_TYPE.
 */
export function isExportCategoryVisibleForGroup(optionKey: string, groupKey: string): boolean {
    const allowed = EXPORT_OPTIONS_BY_FILE_TYPE[optionKey];
    if (!allowed) {
        return true;
    }
    return allowed.includes(groupKey);
}

/**
 * Maps NewSourceUploader importer plugin id → export group key used in EXPORT_OPTIONS_BY_FILE_TYPE.
 * Align with metadata written at import where possible (see getGroupKeyFromMetadata).
 */
export const IMPORTER_PLUGIN_ID_TO_EXPORT_GROUP_KEY: Record<string, string> = {
    audio: "audio",
    subtitles: "subtitles",
    docx: "docx",
    markdown: "markdown",
    "translation-importer": "tms",
    "indesign-importer": "indesign",
    "usfm-experimental": "usfm",
    paratext: "paratext",
    "ebible-download": "ebible",
    "macula-bible": "maculabible",
    obs: "obs",
    spreadsheet: "spreadsheet",
    "biblica-importer": "biblica",
};

export function getExportGroupKeyForImporterPlugin(pluginId: string): string {
    return IMPORTER_PLUGIN_ID_TO_EXPORT_GROUP_KEY[pluginId] ?? "unknown";
}
