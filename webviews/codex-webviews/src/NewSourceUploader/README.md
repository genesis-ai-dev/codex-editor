# NewSourceUploader Plugin Architecture

A modular, plugin-based system for importing various file types into Codex notebooks.

## Architecture Overview

-   **Plugin-Based UI**: Each importer is a self-contained React component with its own UI and state
-   **No Shared State**: Every plugin manages its own state independently
-   **Homepage Navigation**: Main component acts as a router/homepage for selecting importers
-   **Simple Provider**: Backend only serves the webview and writes completed notebook files
-   **ShadCN Components**: Shared UI uses only ShadCN components for consistency
-   **Dirty Form Tracking**: Track only whether forms have unsaved changes, not semantic status

## Core Principles

### 1. **Self-Contained Plugins**

Each importer is a complete, independent module:

```typescript
interface ImporterPlugin {
    // Metadata
    id: string;
    name: string;
    description: string;
    icon: React.ComponentType;

    // The plugin's React component
    component: React.ComponentType<ImporterComponentProps>;

    // File support (optional - for plugins that handle files)
    supportedExtensions?: string[];
    supportedMimeTypes?: string[];
}
```

### 2. **Plugin Components**

Each plugin provides its own React component that handles the entire import flow:

```typescript
interface ImporterComponentProps {
    onComplete: (notebooks: NotebookPair | NotebookPair[]) => void;
    onCancel: () => void;
    existingFiles?: ExistingFile[]; // List of existing source files in the project
}

interface ExistingFile {
    name: string; // Filename without extension
    path: string; // Full path to the file
    type: string; // Content type (e.g., 'bible', 'ebibleCorpus', 'paratext', 'unknown')
    cellCount: number; // Number of cells in the notebook
    metadata?: {
        // Optional notebook metadata
        id?: string;
        originalName?: string;
        corpusMarker?: string;
        sourceCreatedAt?: string;
    };
}
```

The `existingFiles` prop enables plugins to:

-   **Warn about duplicates**: Alert users when importing content that may already exist (e.g., multiple Bible translations)
-   **Enable translation workflows**: Allow importing translations for existing source files
-   **Provide project context**: Show what content is already in the project
-   **Support incremental imports**: Add new content to existing projects intelligently

### 3. **No Shared State**

-   Each plugin manages its own state using React hooks
-   No global state or context providers
-   Communication only through callbacks (onComplete, onCancel)

### 4. **Homepage Router**

The main NewSourceUploader component acts as a simple router:

```typescript
// NewSourceUploader.tsx
const NewSourceUploader = () => {
    const [activePlugin, setActivePlugin] = useState<string | null>(null);
    const [isDirty, setIsDirty] = useState(false);

    if (activePlugin) {
        const plugin = getImporterById(activePlugin);
        return <plugin.component onComplete={handleComplete} onCancel={handleCancel} />;
    }

    // Show homepage with plugin cards
    return <ImporterHomepage onSelectPlugin={setActivePlugin} />;
};
```

### 5. **Simple Provider**

The provider only:

-   Serves the webview HTML
-   Listens for completed notebook pairs
-   Writes the notebook files to disk

```typescript
// NewSourceUploaderProvider.ts
webviewPanel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === "writeNotebooks") {
        await createNoteBookPair({
            token,
            sourceNotebooks: [message.source],
            codexNotebooks: [message.codex],
        });
    }
});
```

## Creating a New Importer Plugin

### 1. File Structure

```
importers/
└── yourImporter/
    ├── index.tsx        // Main plugin export with component
    ├── YourImporterForm.tsx   // The plugin's UI component
    ├── types.ts         // Type definitions
    ├── parser.ts        // File parsing logic (if applicable)
    └── utils.ts         // Helper functions
```

### 2. Plugin Definition

```typescript
// importers/yourImporter/index.tsx
import { ImporterPlugin } from "../../types/plugin";
import { YourImporterForm } from "./YourImporterForm";
import { FileText } from "lucide-react";

export const yourImporterPlugin: ImporterPlugin = {
    id: "your-importer",
    name: "Your Importer",
    description: "Import your specific file type",
    icon: FileText,
    component: YourImporterForm,
    supportedExtensions: ["ext1", "ext2"], // optional
};
```

### 3. Component Implementation

```typescript
// importers/yourImporter/YourImporterForm.tsx
import React, { useState } from "react";
import { ImporterComponentProps } from "../../types/plugin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const YourImporterForm: React.FC<ImporterComponentProps> = ({ onComplete, onCancel }) => {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setIsDirty(true);
        }
    };

    const handleImport = async () => {
        if (!file) return;

        setIsProcessing(true);
        try {
            // Parse file and create notebooks
            const notebookPair = await parseYourFile(file);

            // Send to parent
            onComplete(notebookPair);
            setIsDirty(false);
        } catch (error) {
            // Handle error in UI
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCancel = () => {
        if (isDirty) {
            if (!confirm("Cancel import? Unsaved changes will be lost.")) {
                return;
            }
        }
        onCancel();
    };

    return (
        <div className="container mx-auto p-6">
            <Card>
                <CardHeader>
                    <CardTitle>Import Your Files</CardTitle>
                    <Button variant="ghost" onClick={handleCancel}>
                        Back to Home
                    </Button>
                </CardHeader>
                <CardContent>
                    {/* Your plugin-specific UI here */}
                    <input type="file" onChange={handleFileSelect} />
                    <Button onClick={handleImport} disabled={!file || isProcessing}>
                        Import
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};
```

### 4. Register Plugin

```typescript
// importers/registry.ts
import { ImporterPlugin } from "../types/plugin";
import { docxImporterPlugin } from "./docx";
import { markdownImporterPlugin } from "./markdown";
// ... other imports

export const importerPlugins: ImporterPlugin[] = [
    docxImporterPlugin,
    markdownImporterPlugin,
    // ... other plugins
];

export const getImporterById = (id: string): ImporterPlugin | undefined => {
    return importerPlugins.find((plugin) => plugin.id === id);
};
```

## Plugin Examples

### File Upload Plugin

```typescript
// Standard file upload with progress tracking
export const DocxImporterForm: React.FC<ImporterComponentProps> = ({ onComplete, onCancel }) => {
    // File selection, validation, parsing
    // Progress indicators
    // Error handling
};
```

### Repository Download Plugin

```typescript
// Download from remote repository
export const EbibleDownloadForm: React.FC<ImporterComponentProps> = ({ onComplete, onCancel }) => {
    // Language/translation selection
    // Download progress
    // Multiple notebook handling
};
```

### Multi-Step Form Plugin

```typescript
// Complex multi-step import process
export const ParatextImporterForm: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
}) => {
    // Step 1: Select project folder
    // Step 2: Configure import options
    // Step 3: Preview and confirm
};
```

## Benefits of This Architecture

1. **True Modularity**: Each plugin is completely independent
2. **Easy Testing**: Test each plugin in isolation
3. **Clear Boundaries**: No hidden dependencies between plugins
4. **Flexible UI**: Each plugin can have exactly the UI it needs
5. **Simple Mental Model**: Homepage → Select Plugin → Use Plugin → Return Home
6. **Type Safety**: Strong TypeScript interfaces ensure consistency
7. **Easy Extension**: Add new plugins without touching existing code

## Migration from Current System

The migration involves:

1. Converting each importer's logic into a React component
2. Moving all state management into the component
3. Removing shared state and progress tracking
4. Simplifying the provider to just handle file writing
5. Creating a homepage component for plugin selection

Each plugin becomes responsible for:

-   Its own UI/UX
-   File selection/validation
-   Progress tracking
-   Error handling
-   Creating the final notebook pair

The only communication with the parent is:

-   `onComplete(notebookPair)` - When import succeeds
-   `onCancel()` - When user wants to return to homepage

## File Naming Convention 🚨 CRITICAL

**IMPORTANT**: Notebook names in `NotebookPair` should be **base names only** without file extensions.

✅ **Correct**:

```typescript
const notebookPair = {
    source: { name: "Matthew", cells: [...] },
    codex: { name: "Matthew", cells: [...] }
};
```

❌ **Incorrect** (causes double extensions like `.source.source`):

```typescript
const notebookPair = {
    source: { name: "Matthew.source", cells: [...] },
    codex: { name: "Matthew.codex", cells: [...] }
};
```

The provider automatically adds `.source` and `.codex` extensions when writing files.

## Smart Import JSON Parsing

When Smart Import detects a JSON file, it intelligently parses the structure:

### **Array of Objects**

Each object becomes its own section with incremented section IDs:

```json
[
    { "title": "Chapter 1", "content": "..." }, // → "MyDoc 1:1"
    { "title": "Chapter 2", "content": "..." } // → "MyDoc 2:1"
]
```

### **Field Recognition**

Smart Import recognizes common field patterns:

-   **Title fields**: `title`, `name`, `heading`, `label`, `id`
-   **Content fields**: `content`, `text`, `body`, `description`, `lyrics`, `message`, `value`
-   Other fields are stored as metadata

### **Nested Structures**

Complex objects are formatted for readability, with nested data properly indented.

## Cell ID Format Specification

All cell IDs must follow this standardized format to ensure compatibility across the system:

```
{documentId} {sectionId}:{cellId}
```

### **Format Rules**

-   **documentId**: Filename without spaces, special characters, or extension (e.g., `MyDocument.docx` → `MyDocument`)
-   **sectionId**: Integer representing logical sections (chapters, parts, etc.)
-   **cellId**: Integer or identifier for individual cells within a section
-   **Separator**: Single space between documentId and section, colon between section and cell

### **Examples**

```typescript
// Bible verses (standard format)
"GEN 1:1", "GEN 1:2", "MAT 5:3";

// Document sections
"MyDocument 1:1", "MyDocument 1:2", "MyDocument 2:1";

// USFM chapters and verses
"Genesis 1:1", "Genesis 1:2", "Exodus 1:1";

// Subtitles with timestamps
"VideoFile 1:1", "VideoFile 1:2", "VideoFile 2:1";

// Paratext books
"ParatextProject-Genesis 1:1", "ParatextProject-Exodus 1:1";
```

### **Implementation Helper**

```typescript
const createCellId = (documentName: string, sectionId: number, cellId: number): string => {
    const cleanDocName = documentName.replace(/\.[^/.]+$/, "").replace(/\s+/g, "");
    return `${cleanDocName} ${sectionId}:${cellId}`;
};
```

## Best Practices

1. **Error Handling**: Always wrap parsing in try/catch and return meaningful errors
2. **Progress Updates**: Use `onProgress` callback to update user on long operations
3. **Cell IDs**: Use the standardized format `{documentId} {sectionId}:{cellId}` for all cells
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

-   **DOCX**: Complex parsing with mammoth.js, image extraction ✅ **IMPLEMENTED**
-   **Markdown**: GitHub Flavored Markdown parsing with `marked` library, image extraction ✅ **IMPLEMENTED**
-   **eBible Corpus**: File-based structured data parsing (TSV/CSV), verse metadata ✅ **IMPLEMENTED**
-   **eBible Download**: Download Bible text from eBible repository (with Macula Hebrew/Greek support) ✅ **IMPLEMENTED**
-   **USFM**: Biblical markup parsing with usfm-grammar, chapter/verse structure ✅ **IMPLEMENTED**
-   **Paratext Project**: Both folder-based projects (.SFM files, Settings.xml, BookNames.xml) and ZIP archives ✅ **IMPLEMENTED**
-   **Smart Import**: Universal text importer with intelligent features ✅ **IMPLEMENTED**
    -   **Structure-aware splitting**: Respects paragraphs, sentences, and document boundaries
    -   **JSON parsing**: Automatically detects and parses JSON files into logical sections
    -   **Flexible sizing**: Allows sections to vary in size for better semantic grouping
    -   **40+ file formats**: Supports text, code, config, and data files
-   **Subtitles (VTT/SRT)**: Timestamp-based cells, media synchronization ✅ **IMPLEMENTED**
-   **Open Bible Stories**: JSON/Markdown story format ✅ **IMPLEMENTED**
-   **PDF**: Text extraction, page-based segmentation (Future)
-   **USX**: XML biblical text format (Future)

## Architecture Benefits

The new plugin system provides significant improvements over the old transaction-based system:

-   **Faster Development**: Simple functional interfaces vs complex inheritance
-   **Better UX**: Real-time progress updates and instant feedback
-   **Type Safety**: Strong TypeScript interfaces ensure consistency
-   **Maintainability**: Small, focused functions instead of stateful classes
-   **Extensibility**: Easy to add new file types with standardized patterns
-   **Performance**: Browser-based processing with modern APIs
-   **Standardized IDs**: Consistent cell ID format across all importers: `{documentId} {sectionId}:{cellId}`

## Migration Status: Complete ✅

All major transaction-based importers have been successfully migrated to the new plugin architecture:

| **Feature**        | **Old Implementation**        | **New Implementation**   | **Status**  |
| ------------------ | ----------------------------- | ------------------------ | ----------- |
| USFM Import        | `UsfmSourceImportTransaction` | `usfmImporter`           | ✅ Complete |
| Paratext Projects  | N/A (new)                     | `paratextImporter`       | ✅ Complete |
| eBible Download    | `DownloadBibleTransaction`    | `ebibleDownloadImporter` | ✅ Complete |
| Smart Import       | `SourceImportTransaction`     | `smartImportPlugin`      | ✅ Complete |
| Subtitles/VTT      | N/A (new)                     | `subtitlesImporter`      | ✅ Complete |
| Open Bible Stories | N/A (new)                     | `obsImporter`            | ✅ Complete |
| Markdown           | N/A (new)                     | `markdownImporter`       | ✅ Complete |
| DOCX Documents     | N/A (new)                     | `docxImporter`           | ✅ Complete |
| eBible Files       | N/A (new)                     | `ebibleCorpusImporter`   | ✅ Complete |

The system now provides a consistent, efficient, and extensible way to import various file types with standardized cell IDs, progress tracking, and error handling.

# NewSourceUploader Wizard

The NewSourceUploader has been enhanced with a wizard-style interface that guides users through creating translation pairs from source files and their corresponding target files.

## Wizard Flow

### Step 1: Intent Selection

Users choose whether they want to import:

-   **Source Files**: Original content (the "before" in translation pairs)
-   **Target Files**: Translated/transformed content (the "after" in translation pairs)

### Step 2a: Source Files Branch

If importing source files:

-   Shows available importer plugins
-   Displays current project inventory
-   Allows selecting and importing new source files

### Step 2b: Target Files Branch

If importing target files:

-   Checks if source files exist
-   If no sources: Shows empty state with guidance
-   If sources exist: Shows source file selection interface
-   After source selection: Shows appropriate importer plugins

## Key Components

### Wizard Components

-   `IntentSelection.tsx`: First step, choosing source or target import
-   `SourceFileSelection.tsx`: Select which source file to create a target for
-   `EmptySourceState.tsx`: Shown when trying to create targets without sources
-   `PluginSelection.tsx`: Context-aware plugin selection interface

### Types

-   `wizard.ts`: Core wizard types and interfaces
-   `ProjectInventory`: Tracks all files and translation pairs
-   `WizardState`: Manages wizard flow state
-   `WizardContext`: Provides context to plugin components

## Plugin Integration

Plugins receive an optional `wizardContext` prop:

```typescript
interface ImporterComponentProps {
    onComplete: (notebooks: NotebookPair | NotebookPair[]) => void;
    onCancel: () => void;
    existingFiles?: ExistingFile[];
    wizardContext?: {
        intent: "source" | "target";
        selectedSource?: ExistingFile;
        projectInventory: ProjectInventory;
    };
}
```

Plugins can use this context to:

-   Know if they're importing source or target files
-   Access the selected source file when creating targets
-   View the complete project inventory

## Example Plugin Usage

```typescript
const MyImporterPlugin: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
    wizardContext,
}) => {
    const isTargetImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    if (isTargetImport && selectedSource) {
        // Customize UI for target import
        return (
            <div>
                <h2>Creating translation for: {selectedSource.name}</h2>
                {/* Target-specific import UI */}
            </div>
        );
    }

    // Default source import UI
    return <div>{/* Source import UI */}</div>;
};
```

## Provider Integration

The provider supports two endpoints:

-   `checkExistingFiles`: Legacy endpoint, returns source files only
-   `fetchProjectInventory`: New endpoint, returns complete inventory including:
    -   Source files
    -   Target files
    -   Translation pairs
