# Git LFS Integration in Codex Editor

This guide explains how to use Git LFS (Large File Storage) in your Codex translation projects to efficiently handle large audio and video attachments.

## Overview

Git LFS is now integrated into the Codex Editor to automatically handle large binary files like audio recordings, video files, and images. Instead of storing these files directly in Git (which can make repositories slow and large), LFS stores them separately and keeps small "pointer" files in Git.

## Automatic Integration

### Files That Use LFS

The following file types are automatically handled by LFS:

- **Audio Files**: `.wav`, `.mp3`, `.m4a`, `.ogg`, `.webm` (ALL audio files, regardless of size)
- **Video Files**: `.mp4`, `.avi`, `.mov`, `.mkv` (when larger than 10MB)
- **Images**: `.jpg`, `.jpeg`, `.png` (when larger than 10MB)

**Why ALL audio files?** Audio files are binary and don't benefit from Git's text-based features. Even small audio recordings belong in LFS for consistency and performance.

### Transparent Operation

LFS integration is completely transparent:

1. **Recording Audio**: When you record audio for a cell, large files are automatically stored in LFS
2. **Playing Audio**: Audio playback works exactly the same - no changes to your workflow
3. **Syncing**: Git operations (commit, push, pull) are faster and more efficient

## Getting Started

### 1. Initialize LFS

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

```
> Initialize Git LFS
```

This command will:

- **Update `.gitignore`**: Remove patterns that block audio/video files from being tracked
- **Create `.gitattributes`**: Configure which file types use LFS
- **Enable LFS tracking**: Allow attachment files to be properly versioned

**Important for existing projects**: If your project was created before LFS integration, this step removes audio/video files from `.gitignore` so they can be tracked with LFS.

### 2. Check Status

To see how LFS is being used in your project:

```
> Check LFS Status
```

This shows:

- Total number of audio files
- How many are in LFS vs regular Git
- Storage savings from using LFS

### 3. Migrate Existing Files

If you have existing large attachments, migrate them to LFS:

```
> Migrate Attachments to LFS
```

This processes all existing audio/video files and moves large ones to LFS.

## Migration from Previous Versions

If your project was created before Git LFS integration, you'll need to migrate:

### What Changes

**Before LFS** (old projects):

```gitignore
# .gitignore was blocking these files
.project/attachments/
*.wav
*.mp3
*.mp4
*.jpg
# ... other media files
```

**After LFS** (updated projects):

```gitignore
# .gitignore now allows LFS-tracked files
# NOTE: .project/attachments/ files are now tracked with Git LFS
# Audio files (.wav, .mp3, .m4a, .ogg, .webm) are handled by LFS
# Video files (.mp4, .avi, .mov, .mkv) are handled by LFS
# Image files (.jpg, .jpeg, .png) are handled by LFS
```

### Migration Steps

1. **Run `Initialize Git LFS`** - This automatically:
    - Removes blocking patterns from `.gitignore`
    - Adds `.gitattributes` for LFS configuration
    - Prepares project for LFS tracking

2. **Run `Migrate Attachments to LFS`** - This moves existing files:
    - Uploads large attachment files to LFS
    - Replaces them with LFS pointers
    - Commits the migration

3. **Commit changes** - Your project is now LFS-enabled!

## Benefits

### ✅ Faster Operations

- **Clone**: New contributors can clone projects much faster
- **Pull/Push**: Syncing changes is quicker
- **Checkout**: Switching branches doesn't download all large files

### ✅ Efficient Storage

- Large files are stored once, even across branches
- Only download files you actually need
- Significant storage savings for audio-heavy projects

### ✅ Better Collaboration

- Team members can work without downloading all recordings
- Faster setup for new translators
- More reliable sync operations

## Technical Details

### File Structure

When LFS is used, your project structure remains the same:

```
.project/
└── attachments/
    └── GEN/
        ├── GEN_001_001.wav  # Might be LFS pointer
        ├── GEN_001_002.mp3  # Might be LFS pointer
        └── GEN_001_003.wav  # Regular file (if < 10MB)
```

### LFS Pointer Files

Large files are replaced with small text files that look like:

```
version https://git-lfs.github.com/spec/v1
oid sha256:abc123...
size 15728640
```

The actual file is stored in LFS and downloaded when needed.

### Metadata

Cell attachments include LFS information:

```json
{
    "url": ".project/attachments/GEN/GEN_001_001.wav",
    "type": "audio",
    "isLFS": true
}
```

## Workflow Examples

### Recording New Audio

1. Open a cell in the editor
2. Record audio as usual
3. **Automatic**: If the recording is large, it's stored in LFS
4. Commit and sync - only a small pointer is stored in Git

### Playing Existing Audio

1. Click play button on any cell
2. **Automatic**: LFS downloads the file if needed
3. Audio plays normally

### Syncing Changes

1. Make changes to your translation
2. Record new audio
3. Run: `Stage & Commit All`
4. **Faster**: Only pointer files are committed to Git
5. **Efficient**: LFS handles large file sync separately

## Commands Reference

| Command                      | Description                        |
| ---------------------------- | ---------------------------------- |
| `Initialize Git LFS`         | Set up LFS for the current project |
| `Check LFS Status`           | View statistics about LFS usage    |
| `Migrate Attachments to LFS` | Move existing large files to LFS   |
| `LFS Help & Documentation`   | Open this help guide               |

## Troubleshooting

### Large Repository Size

If your repository is still large after enabling LFS:

1. Run `Check LFS Status` to see what's using space
2. Run `Migrate Attachments to LFS` to move existing files
3. Commit the changes to apply LFS tracking

### Slow Audio Loading

If audio takes time to load:

- LFS is downloading the file in the background
- Subsequent plays will be instant
- This only happens once per file

### Authentication Issues

If LFS operations fail with auth errors:

- Check that your Git credentials work for the repository
- LFS uses the same authentication as regular Git
- Contact your repository administrator if issues persist

## Best Practices

### ✅ Do

- Initialize LFS when starting a new project with audio
- Let the system automatically determine which files use LFS
- Commit regularly to keep LFS transfers small
- Use the migration tool when joining existing projects

### ❌ Don't

- Manually edit `.gitattributes` unless necessary
- Force small files into LFS (< 10MB)
- Worry about LFS in your daily workflow - it's automatic

## Integration Details

The LFS integration works at several levels:

### Audio Recording (`codexCellEditorProvider`)

- Enhanced `saveAudioAttachment` message handler
- Automatic size detection and LFS routing
- Transparent metadata updates

### File Operations (`LFSHelper`)

- Seamless file reading with LFS support
- Automatic upload/download handling
- Smart file type detection

### Git Operations (`projectUtils`)

- LFS-aware commit and sync operations
- Enhanced `.gitignore` and `.gitattributes` management
- Efficient large file handling

This integration ensures that your translation workflow remains unchanged while benefiting from the performance improvements of Git LFS.
