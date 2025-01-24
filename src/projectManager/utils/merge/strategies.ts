import { ConflictResolutionStrategy } from "./types";

// Define which files use which strategies
export const filePatternsToResolve: Record<ConflictResolutionStrategy, string[]> = {
    // Codex notebook files - special merge process for cell arrays
    [ConflictResolutionStrategy.CODEX_CUSTOM_MERGE]: ["files/target/*.codex"],

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

    // Source files - keep newest version
    [ConflictResolutionStrategy.SOURCE]: [".project/sourceTexts/*.source"],

    // Files to ignore
    [ConflictResolutionStrategy.IGNORE]: ["complete_drafts.txt"],
};

export function determineStrategy(filePath: string): ConflictResolutionStrategy {
    for (const [strategy, patterns] of Object.entries(filePatternsToResolve)) {
        for (const pattern of patterns) {
            // Simple wildcard matching for now
            if (pattern.includes("*")) {
                const regex = new RegExp(pattern.replace("*", ".*"));
                if (regex.test(filePath)) return strategy as ConflictResolutionStrategy;
            } else if (filePath.endsWith(pattern)) {
                return strategy as ConflictResolutionStrategy;
            }
        }
    }
    console.warn(
        "No merge strategy found for file:",
        filePath,
        "defaulting to OVERRIDE (take the newest version)"
    );
    return ConflictResolutionStrategy.OVERRIDE; // Default to override
}
