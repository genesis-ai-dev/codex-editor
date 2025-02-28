import { FrontierAPI } from "../../../../webviews/codex-webviews/src/StartupFLow/types";

export enum ConflictResolutionStrategy {
    OVERRIDE = "override", // Keep newest version (timestamp-based)
    SOURCE = "source", // Keep newest version (read-only files)
    IGNORE = "ignore", // Always keep our version (HEAD) for auto-generated files
    ARRAY = "array", // Combine arrays and deduplicate
    SPECIAL = "special", // Merge based on timestamps/rules
    CODEX_CUSTOM_MERGE = "codex", // Special merge process for cell arrays
    JSONL = "jsonl", // Combine and deduplicate JSONL files
    // FIXME: Add a new strategy for merging .vscode/settings.json
}

export interface SmartEdit {
    cellId: string;
    lastCellValue: string;
    suggestions: Array<{ oldString: string; newString: string }>;
    lastUpdatedDate: string;
}

export interface ConflictFile {
    filepath: string;
    ours: string; // The actual content, not a path
    theirs: string; // The actual content, not a path
    base: string; // The actual content, not a path
}
