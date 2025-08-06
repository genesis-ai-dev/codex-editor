# Example: Using Git LFS with Codex Projects

This example demonstrates how to use Git LFS in a real Codex translation project.

## Scenario

You're working on a Gujarati translation of Genesis with audio recordings for each verse. Audio files range from 500KB to 20MB, but ALL will be stored in LFS for consistency.

## Step 1: Initialize LFS

When starting a new project or adding LFS to an existing one:

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run: `Initialize Git LFS`
3. This creates `.gitattributes` with LFS rules

The `.gitattributes` file will contain:

```
# Audio files
*.wav filter=lfs diff=lfs merge=lfs -text
*.mp3 filter=lfs diff=lfs merge=lfs -text
*.m4a filter=lfs diff=lfs merge=lfs -text
*.ogg filter=lfs diff=lfs merge=lfs -text

# Video files
*.mp4 filter=lfs diff=lfs merge=lfs -text
*.avi filter=lfs diff=lfs merge=lfs -text
*.mov filter=lfs diff=lfs merge=lfs -text
*.mkv filter=lfs diff=lfs merge=lfs -text

# Image files over 1MB should use LFS
*.jpg filter=lfs diff=lfs merge=lfs -text
*.jpeg filter=lfs diff=lfs merge=lfs -text
*.png filter=lfs diff=lfs merge=lfs -text
```

## Step 2: Recording Audio

### Before LFS (Problems)

```
.project/attachments/GEN/
├── GEN_001_001.wav (15.2 MB) 📁 Large file in Git
├── GEN_001_002.wav (18.7 MB) 📁 Large file in Git
├── GEN_001_003.wav (12.4 MB) 📁 Large file in Git
└── ... (hundreds more)

Repository size: 2.3 GB 😰
Clone time: 45 minutes 😰
```

### After LFS (Solution)

```
.project/attachments/GEN/
├── GEN_001_001.wav (156 bytes) 📄 LFS pointer
├── GEN_001_002.wav (156 bytes) 📄 LFS pointer
├── GEN_001_003.wav (156 bytes) 📄 LFS pointer (ALL audio → LFS)
└── ... (LFS handles ALL audio files automatically)

Repository size: 45 MB ✅
Clone time: 2 minutes ✅
```

### Recording Process (Unchanged)

1. Open Genesis 1:1 in cell editor
2. Click record button 🎙️
3. Record verse audio
4. Click save

**Behind the scenes:**

- File type is checked (.wav = audio file)
- ALL audio files automatically go to LFS (regardless of size)
- Small pointer file stored in Git
- Cell metadata updated with `isLFS: true`

## Step 3: Check Status

Run `Check LFS Status` to see:

```
📊 LFS Status Report

📁 Total audio files: 1,189
🚀 Files in LFS: 892
📄 Regular files: 297
💾 Total size: 15,230.45 MB
✨ LFS savings: 14,985.32 MB
```

## Step 4: Collaborate

### Team Member Joining Project

**Without LFS:**

```bash
git clone repo.git
# Downloads 2.3 GB of audio files
# Takes 45 minutes on typical internet
```

**With LFS:**

```bash
git clone repo.git
# Downloads only 45 MB of text/code
# Takes 2 minutes
# Audio files downloaded on-demand
```

### Daily Workflow

**Translator A records new audio:**

```bash
# Record GEN 2:5 (any size audio file)
# ALL audio files → automatic LFS upload
git add .
git commit -m "Add audio for GEN 2:5"
git push
# Pushes only 156-byte pointer file to Git
# LFS handles actual audio file separately
```

**Translator B syncs changes:**

```bash
git pull
# Downloads pointer file instantly
# Audio downloaded when first played
```

## Step 5: Migration (Existing Projects)

If you have an existing project with large audio files:

1. Run: `Migrate Attachments to LFS`
2. Progress will show:
    ```
    Migrating attachments to LFS...
    Processing GEN_001_001.wav (1/1189)
    Processing GEN_001_002.wav (2/1189)
    ...
    ```
3. Results:
    ```
    ✅ Migration completed! Migrated 892 files to LFS.
    ```

## Code Integration Examples

### Custom Audio Processing

If you're developing custom audio features, you can use the LFS utilities:

```typescript
import { LFSHelper } from "../utils/lfsUtils";
import { LFSAudioHandler } from "../providers/codexCellEditorProvider/lfsAudioHandler";

// Check if a file should use LFS
const shouldUseLFS = LFSHelper.shouldUseLFS("audio.wav", 500000); // 500KB audio
console.log(shouldUseLFS); // true (ALL audio files use LFS)

// Read audio with LFS support
const result = await LFSHelper.readFileWithLFS(
    workspaceUri,
    ".project/attachments/GEN/GEN_001_001.wav"
);

if (result.success) {
    const audioData = result.content; // Uint8Array
    // Process audio...
}

// Save new audio with automatic LFS handling
const saveResult = await LFSAudioHandler.saveAudioAttachmentWithLFS(
    "GEN 1:1",
    "recording_001",
    base64AudioData,
    "wav",
    document,
    workspaceFolder
);

console.log(`Saved with LFS: ${saveResult.isLFS}`);
```

### Git Operations

LFS integrates seamlessly with existing Git operations:

```typescript
// The existing projectUtils.ts functions now handle LFS automatically

await stageAndCommitAllAndSync("Add new audio recordings");
// LFS files are committed as pointers
// Large file transfers happen via LFS

await ensureGitignoreIsUpToDate();
// Now also ensures .gitattributes is properly configured
```

## Performance Comparison

| Operation             | Without LFS | With LFS | Improvement     |
| --------------------- | ----------- | -------- | --------------- |
| Initial clone         | 45 min      | 2 min    | **95% faster**  |
| Daily pull            | 30 sec      | 2 sec    | **93% faster**  |
| Repository size       | 2.3 GB      | 45 MB    | **98% smaller** |
| New team member setup | 1 hour      | 5 min    | **92% faster**  |

## Best Practices from This Example

### ✅ Do

- Initialize LFS early in project lifecycle
- Let automatic thresholds determine LFS usage
- Use migration tool for existing projects
- Regular commits to keep transfers manageable

### ✅ Benefits Realized

- **Faster onboarding**: New translators can start quickly
- **Efficient syncing**: Daily updates are near-instant
- **Better reliability**: Fewer timeout issues during sync
- **Storage savings**: Massive reduction in repository size

### 🎯 Result

Your translation team can focus on the actual translation work instead of wrestling with slow Git operations and large file management!
