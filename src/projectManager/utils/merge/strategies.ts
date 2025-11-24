import { ConflictResolutionStrategy } from "./types";

// Define which files use which strategies
export const filePatternsToResolve: Record<ConflictResolutionStrategy, string[]> = {
    // Codex notebook files - special merge process for cell arrays
    [ConflictResolutionStrategy.CODEX_CUSTOM_MERGE]: [
        "files/target/*.codex",
        ".project/sourceTexts/*.source"
    ],

    // Simple JSON override files - keep newest version
    [ConflictResolutionStrategy.OVERRIDE]: [
        "chat-threads.json",
        "files/chat_history.jsonl",
        "files/silver_path_memories.json",
        "files/smart_passages_memories.json",
        ".project/dictionary.sqlite",
    ],

    // Project metadata merge - merge metadata.json using edit history (latest timestamp wins)
    [ConflictResolutionStrategy.PROJECT_METADATA_MERGE]: [
        "metadata.json",
    ],

    // Mergeable Comment arrays on commentThread array - combine recursively and deduplicate
    [ConflictResolutionStrategy.ARRAY]: [".project/comments.json"],

    // JSONL files - combine and deduplicate
    [ConflictResolutionStrategy.JSONL]: ["files/project.dictionary"],

    // Special JSON merges - merge based on timestamps
    [ConflictResolutionStrategy.SPECIAL]: [
        "files/smart_edits.json",
        "metadata.json"
    ],

    // Source files - keep newest version (DEPRECATED: now using CODEX_CUSTOM_MERGE)
    [ConflictResolutionStrategy.SOURCE]: [],

    // Files to ignore
    [ConflictResolutionStrategy.IGNORE]: ["complete_drafts.txt"],

    // JSON settings files - 3-way merge with intelligent conflict resolution
    [ConflictResolutionStrategy.JSON_MERGE_3WAY]: [".vscode/settings.json"],
};

export function determineStrategy(filePath: string): ConflictResolutionStrategy {
    // Normalize the path to handle different path separators
    const normalizedPath = filePath.replace(/\\/g, "/");

    for (const [strategy, patterns] of Object.entries(filePatternsToResolve)) {
        for (const pattern of patterns) {
            const normalizedPattern = pattern.replace(/\\/g, "/");

            // Exact match for files that should be ignored
            if (strategy === ConflictResolutionStrategy.IGNORE) {
                if (
                    normalizedPath.endsWith("/" + normalizedPattern) ||
                    normalizedPath === normalizedPattern
                ) {
                    console.log(`File ${filePath} matched IGNORE pattern ${pattern}`);
                    return ConflictResolutionStrategy.IGNORE;
                }
                continue;
            }

            // For other strategies, use the existing wildcard matching
            if (pattern.includes("*")) {
                const regex = new RegExp(pattern.replace("*", ".*"));
                if (regex.test(normalizedPath)) return strategy as ConflictResolutionStrategy;
            } else if (
                normalizedPath.endsWith("/" + normalizedPattern) ||
                normalizedPath === normalizedPattern
            ) {
                return strategy as ConflictResolutionStrategy;
            }
        }
    }

    console.warn(
        "No merge strategy found for file:",
        filePath,
        "defaulting to OVERRIDE (take the newest version)"
    );
    return ConflictResolutionStrategy.OVERRIDE;
}
