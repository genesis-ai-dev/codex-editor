# New Source Uploader Provider

A simplified, modular source uploader that makes it easy to add support for new file types without modifying the core provider code.

## Architecture

The system is built around a simple plugin architecture:

-   **NewSourceUploaderProvider**: The main provider that handles webview communication and delegates file processing to specific uploaders
-   **BaseUploader**: Abstract base class that all file type uploaders extend
-   **File Type Uploaders**: Specific implementations for each file type (CSV/TSV, plaintext, etc.)

## Current File Type Support

### CSV/TSV Files (`CsvTsvUploader`)

-   Automatically detects column structure
-   Intelligently maps common column names (source, target, id, etc.)
-   Creates both source and codex notebooks
-   Supports translation pairs (if target column is present)

### Plaintext Files (`PlaintextUploader`)

-   Splits content by paragraphs or lines
-   Creates source notebook with content
-   Creates empty codex notebook for translation

## Adding New File Types

To add support for a new file type, follow these simple steps:

### 1. Create a New Uploader Class

Create a new file in `uploaders/` directory (e.g., `SubtitleUploader.ts`):

```typescript
import * as vscode from "vscode";
import { BaseUploader, FileUploadResult } from "./BaseUploader";
import {
    SourcePreview,
    NotebookPreview,
    ValidationResult,
    CustomNotebookMetadata,
} from "../../../../types/index.d";
import { CodexCellTypes } from "../../../../types/enums";

export class SubtitleUploader extends BaseUploader {
    async processFile(
        file: { content: string; name: string },
        token: vscode.CancellationToken
    ): Promise<FileUploadResult> {
        // 1. Parse the file content
        const subtitleBlocks = this.parseSubtitles(file.content);

        // 2. Validate the content
        const validationResults = this.validateContent(subtitleBlocks);

        // 3. Create source and codex notebooks
        const { sourceNotebook, codexNotebook } = await this.createNotebooks(
            subtitleBlocks,
            file.name,
            token
        );

        // 4. Return the preview
        const preview: SourcePreview = {
            type: "source",
            fileName: file.name,
            fileSize: this.getFileSize(file.content),
            fileType: "subtitles",
            original: {
                preview: this.generatePreviewText(subtitleBlocks),
                validationResults,
            },
            transformed: {
                sourceNotebooks: [sourceNotebook],
                codexNotebooks: [codexNotebook],
                validationResults,
            },
        };

        return {
            fileName: file.name,
            fileSize: this.getFileSize(file.content),
            preview,
        };
    }

    private parseSubtitles(content: string): any[] {
        // Implement subtitle parsing logic
        // Return array of subtitle objects
    }

    private validateContent(subtitles: any[]): ValidationResult[] {
        // Implement validation logic
    }

    private async createNotebooks(/* ... */): Promise<{
        sourceNotebook: NotebookPreview;
        codexNotebook: NotebookPreview;
    }> {
        // Create notebook cells from subtitle data
    }

    private generatePreviewText(subtitles: any[]): string {
        // Generate preview text for the webview
    }
}
```

### 2. Register the Uploader

In `NewSourceUploaderProvider.ts`, add your uploader to the `initializeUploaders()` method:

```typescript
private initializeUploaders(): void {
    // ... existing uploaders ...

    // Register subtitle uploader
    const subtitleUploader = new SubtitleUploader(this.context);
    this.uploaders.set("subtitles", subtitleUploader);
}
```

### 3. Update File Type Detection

Add your file extension to the `getFileType()` method:

```typescript
private getFileType(fileName: string): FileType {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
        // ... existing cases ...
        case 'vtt':
        case 'srt':
            return 'subtitles';
        // ...
    }
}
```

That's it! Your new file type is now supported.

## Benefits of This Architecture

1. **Modularity**: Each file type is handled in its own class
2. **Extensibility**: Adding new file types requires minimal changes to existing code
3. **Maintainability**: File type logic is isolated and easy to test
4. **Flexibility**: Each uploader can implement its own parsing and validation logic
5. **Consistency**: All uploaders follow the same interface

## Frontend Processing

Most of the work is done on the frontend (in the uploaders), with the provider acting as a simple coordinator. This makes the system:

-   Faster (less backend processing)
-   More responsive (immediate feedback)
-   Easier to debug (logic is co-located)
-   More testable (each uploader can be tested independently)

## Removing File Types

To remove support for a file type:

1. Delete the uploader file from `uploaders/`
2. Remove the registration from `initializeUploaders()`
3. Remove the file extension from `getFileType()`

The modular design ensures that removing one file type won't affect others.
