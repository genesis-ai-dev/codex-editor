import { ConflictResolutionStrategy } from "./types";

// Define which files use which strategies
export const filePatternsToResolve: Record<ConflictResolutionStrategy, string[]> = {
    // Codex notebook files - special merge process for cell arrays
    [ConflictResolutionStrategy.CODEX_CUSTOM_MERGE]: [
        "files/target/*.codex",
        "**/*.source"
    ],

    // Simple JSON override files - keep newest version
    [ConflictResolutionStrategy.OVERRIDE]: [
        "metadata.json",
        "chat-threads.json",
        "files/chat_history.jsonl",
        "files/silver_path_memories.json",
        "files/smart_passages_memories.json",
        ".project/dictionary.sqlite",
    ],

    // Mergeable Comment arrays on commentThread array - combine recursively and deduplicate
    [ConflictResolutionStrategy.ARRAY]: ["file-comments.json"],

    // JSONL files - combine and deduplicate
    [ConflictResolutionStrategy.JSONL]: ["files/project.dictionary"],

    // Special JSON merges - merge based on timestamps
    [ConflictResolutionStrategy.SPECIAL]: ["files/smart_edits.json"],

    // Source files - keep newest version (DEPRECATED: now using CODEX_CUSTOM_MERGE)
    [ConflictResolutionStrategy.SOURCE]: [],

    // Files to ignore
    [ConflictResolutionStrategy.IGNORE]: ["complete_drafts.txt"],
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
                // Convert glob pattern to regex
                let regexPattern = pattern
                    .replace(/\./g, "\\.") // Escape dots
                    .replace(/\*\*/g, ".*") // Convert ** to .*
                    .replace(/\*/g, "[^/]*"); // Convert * to [^/]*
                
                // Special handling for **/*.source pattern
                if (pattern === "**/*.source") {
                    regexPattern = ".*\\.source$";
                }
                
                const regex = new RegExp(regexPattern);
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
