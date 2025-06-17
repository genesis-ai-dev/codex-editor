# NewSourceUploader Plugin Architecture

A functional, plugin-based system for importing various file types into Codex notebooks.

## Architecture Overview

-   **Functional Programming**: Pure functions, no classes or inheritance
-   **Plugin-Based**: Each file type is a separate plugin with standardized interface
-   **Feature-Based Organization**: Files grouped by importer type, not by technical role
-   **Type Safety**: TypeScript interfaces ensure consistency across all plugins

## Creating a New Importer Plugin

### 1. File Structure

```
importers/
└── yourFileType/       # Can be a very specific type of file like 'acmOrgFileXyz'
    ├── index.ts        # Main plugin export
    ├── parser.ts       # Core parsing logic (optional)
    ├── types.ts        # Type definitions (optional)
    └── utils.ts        # Helper functions (optional)
```

### 2. Plugin Interface

Every importer must implement `ImporterPlugin`:

```typescript
export interface ImporterPlugin {
    name: string; // Human-readable name
    supportedExtensions: string[]; // File extensions (e.g., ['pdf', 'docx'])
    description: string; // Brief description
    validateFile: ValidationFunction;
    parseFile: ParsingFunction;
    // Optional:
    extractImages?: (file: File) => Promise<ProcessedImage[]>;
    preprocess?: (file: File) => Promise<File>;
    postprocess?: (result: ImportResult) => Promise<ImportResult>;
}
```

### 3. Implementation Template

```typescript
// importers/yourFileType/index.ts
import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from "../../types/common";
import {
    createProgress,
    generateCellId,
    createProcessedCell,
    createNotebookPair,
    validateFileExtension,
} from "../../utils/workflowHelpers";

const SUPPORTED_EXTENSIONS = ["ext1", "ext2"];

const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push("Invalid file extension");
    }

    // Add your validation logic here

    return {
        isValid: errors.length === 0,
        fileType: "yourFileType",
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress("Reading File", "Reading file...", "processing", 10));

        // 1. Read file content
        const content = await file.text(); // or file.arrayBuffer() for binary

        onProgress?.(createProgress("Parsing", "Parsing content...", "processing", 50));

        // 2. Parse content into segments
        const segments = parseYourFileFormat(content);

        onProgress?.(
            createProgress("Creating Cells", "Creating notebook cells...", "processing", 80)
        );

        // 3. Convert segments to cells
        const cells = segments.map((segment, index) => {
            const cellId = generateCellId("yourFileType", index);
            return createProcessedCell(cellId, segment, {
                // Add any metadata specific to your file type
            });
        });

        // 4. Create notebook pair
        const notebookPair = createNotebookPair(file.name, cells, "yourFileType", {
            // Add additional metadata
        });

        onProgress?.(createProgress("Complete", "Processing complete", "complete", 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                segmentCount: cells.length,
                // Add other metadata
            },
        };
    } catch (error) {
        onProgress?.(createProgress("Error", "Processing failed", "error", 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
};

// Helper function for parsing your specific format
const parseYourFileFormat = (content: string): string[] => {
    // Implement your parsing logic here
    return content.split("\n").filter((line) => line.trim());
};

export const yourFileTypeImporter: ImporterPlugin = {
    name: "Your File Type Importer",
    supportedExtensions: SUPPORTED_EXTENSIONS,
    description: "Brief description of what this importer does",
    validateFile,
    parseFile,
};
```

### 4. Register Your Plugin

Add to `importers/registry.ts`:

```typescript
import { yourFileTypeImporter } from "./yourFileType";

export const importerRegistry: ImporterRegistry = {
    // ... existing importers
    yourFileType: yourFileTypeImporter,
};
```

## Key Utilities

### Workflow Helpers

-   `createProgress()` - Create progress updates
-   `generateCellId()` - Generate unique cell IDs
-   `createProcessedCell()` - Create standardized cells
-   `createNotebookPair()` - Create source/codex notebook pair
-   `validateFileExtension()` - Check file extensions
-   `splitContentIntoSegments()` - Split content by strategy

### Image Processing

-   `processImageData()` - Convert images to standard format
-   `extractImagesFromHtml()` - Extract images from HTML
-   `validateImage()` - Validate image data

## Best Practices

1. **Error Handling**: Always wrap parsing in try/catch and return meaningful errors
2. **Progress Updates**: Use `onProgress` callback to update user on long operations
3. **Cell IDs**: Use descriptive prefixes in `generateCellId()`
4. **Images**: Extract and process images using provided utilities
5. **Validation**: Validate files before attempting to parse
6. **Metadata**: Include relevant metadata for debugging and features

## Testing Strategy

```typescript
// yourFileType.test.ts
describe("YourFileTypeImporter", () => {
    test("validates files correctly", async () => {
        const mockFile = new File(["content"], "test.ext", { type: "text/plain" });
        const result = await yourFileTypeImporter.validateFile(mockFile);
        expect(result.isValid).toBe(true);
    });

    test("parses content into cells", async () => {
        const mockFile = new File(["line1\nline2"], "test.ext");
        const result = await yourFileTypeImporter.parseFile(mockFile);
        expect(result.success).toBe(true);
        expect(result.notebookPair?.source.cells.length).toBe(2);
    });
});
```

## File Type Examples

-   **DOCX**: Complex parsing with mammoth.js, image extraction
-   **Markdown**: Simple regex-based conversion, image linking
-   **eBible Corpus**: Structured data parsing (TSV/CSV), verse metadata
-   **USFM**: Biblical markup parsing, chapter/verse structure
-   **PDF**: Text extraction, page-based segmentation
-   **Subtitles**: Timestamp-based cells, media synchronization
