# Codex Project Merge Strategy

This document outlines the strategy for resolving merge conflicts in Codex projects, with special handling for different file types.

## File Type Categories

### 1. Codex Notebook Files (`.codex`)

- **Location**: `files/target/*.codex`
- **Strategy**: Special merge process for cell arrays
    1. Parse both versions (HEAD and origin) as JSON
    2. Compare cells array from both versions
    3. For each cell at same index:
        - If content matches: Keep single copy
        - If content differs: Duplicate cell, maintaining relative position
        - Preserve cell IDs and metadata
    4. Update indexes after merge
    5. Present merged result in editor for final review

### 2. Simple JSON Override Files

- **Files**:
    - `metadata.json`
    - `chat-threads.json`
    - `files/chat_history.jsonl`
    - `files/silver_path_memories.json`
    - `files/smart_passages_memories.json`
    - `.project/dictionary.sqlite`
- **Strategy**: Keep newest version (timestamp-based override)

### 3. Mergeable JSON Arrays

- **Files**:
    - `.project/comments.json`
    - `files/project.dictionary`
- **Strategy**:
    1. Parse both versions as JSON arrays
    2. Combine arrays
    3. Deduplicate by thread ID and comment content
    4. Preserve all unique threads and comments

### 4. Special JSON Merges

- **Files**:
    - `files/smart_edits.json`
- **Strategy**:
    1. Parse both versions
    2. Merge based on edit timestamps
    3. Preserve all unique edits
    4. Deduplicate identical edit operations

### 5. Source Files (Read-only)

- **Location**: `.project/sourceTexts/*.source`
- **Strategy**: Keep newest version (conflicts unlikely as these are typically read-only)

### 6. Codex Cell Files (`files/*.codex`)

- **Strategy**: 
    1. Parse both versions as JSON
    2. Take the newest `metadata` object
    3. Merge cells array from both versions
    4. For each cell with the same id:
        - If content matches: Keep single copy
        - If content differs: Duplicate cell, maintaining relative position and identical id
        - Preserve cell IDs and metadata
    5. Complete the merge and sync the entire project.
    6. This approach will trigger the merge conflict view of the codex cell editor. The user will be forced to resolve the cell-level conflicts manually when they open the file.

Note: we also need to just ignore some files, like `complete_drafts.txt`, as they are auto-generated and not meant to be merged.

## Implementation Steps

1. **Conflict Detection**

    ```typescript
    interface MergeConflict {
        path: string;
        type: "codex" | "override" | "array" | "special" | "source";
        head: string;
        origin: string;
        timestamp: {
            head: Date;
            origin: Date;
        };
    }
    ```

2. **File Type Classification**

    - Determine merge strategy based on file path and extension
    - Apply appropriate merge handler

3. **User Interface**

    - Show progress of automated merges
    - Present conflicts requiring manual intervention
    - Provide preview of merge results
    - Allow manual override where needed

4. **Validation**
    - Ensure merged files maintain correct structure
    - Verify all cell IDs remain unique
    - Confirm no data loss occurred

## Error Handling

1. **Recovery Strategy**

    - Keep copies of both versions
    - Allow manual merge if automated process fails
    - Provide rollback capability

2. **Logging**
    - Record all merge operations
    - Track conflict resolutions
    - Document any manual interventions

## Future Improvements

- [ ] Add support for custom merge strategies
- [ ] Implement visual diff tool for `.codex` files
- [ ] Add conflict prevention through file locking
- [ ] Improve merge performance for large files
