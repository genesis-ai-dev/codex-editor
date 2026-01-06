# DOCX Round-Trip Importer - Implementation Documentation

## Overview

This experimental DOCX importer implements **complete round-trip export** functionality, similar to the Biblica/IDML parser. Instead of converting DOCX to HTML and losing structure, it preserves the complete OOXML (Office Open XML) structure, allowing translations to be exported back into the original DOCX file with all formatting preserved.

## Architecture

### Key Components

1. **`docxTypes.ts`** - Type definitions for DOCX structure
2. **`docxParser.ts`** - OOXML parser that extracts document structure
3. **`index.ts`** - Main importer that creates Codex cells with metadata
4. **`docxExporter.ts`** (TODO) - Exporter that reconstructs DOCX with translations

## How It Works

### Import Phase

```
DOCX File → Unzip → Parse document.xml → Extract Paragraphs & Runs → Create Cells with Metadata
```

#### 1. Unzip DOCX File
DOCX files are ZIP archives containing XML files:
- `word/document.xml` - Main document content
- `word/styles.xml` - Style definitions
- `word/_rels/document.xml.rels` - Relationships (images, etc.)
- `word/media/` - Embedded images and media
- `docProps/core.xml` - Document metadata

#### 2. Parse OOXML Structure
The parser extracts the complete XML structure:

```xml
<w:p>  <!-- Paragraph -->
  <w:pPr>  <!-- Paragraph Properties -->
    <w:pStyle w:val="Heading1"/>
    <w:jc w:val="center"/>
    <w:spacing w:before="240" w:after="120"/>
  </w:pPr>
  <w:r>  <!-- Run (text with formatting) -->
    <w:rPr>  <!-- Run Properties -->
      <w:b/>  <!-- Bold -->
      <w:sz w:val="28"/>  <!-- Font size -->
      <w:color w:val="FF0000"/>  <!-- Color -->
    </w:rPr>
    <w:t>This is formatted text</w:t>
  </w:r>
</w:p>
```

#### 3. Extract Metadata for Round-Trip

Each cell stores complete metadata:

```typescript
{
  cellId: "doc-1-p-5",
  paragraphId: "p-5",
  paragraphIndex: 5,
  originalContent: "This is the original text",
  
  docxStructure: {
    // Complete paragraph properties
    paragraphProperties: {
      styleId: "Heading1",
      alignment: "center",
      indentation: { left: 720, firstLine: 360 },
      spacing: { before: 240, after: 120 }
    },
    
    // XML before and after for reconstruction
    beforeParagraphXml: "...",
    afterParagraphXml: "..."
  },
  
  // All runs with their properties
  runs: [
    {
      id: "p-5-r-0",
      content: "This is the original text",
      runProperties: {
        bold: true,
        fontSize: 28,
        color: "FF0000"
      },
      originalXml: "<w:r>...</w:r>"
    }
  ],
  
  // Complete paragraph XML for perfect reconstruction
  originalParagraphXml: "<w:p>...</w:p>",
}
```

#### 4. Notebook-level Import Context

One-time attributes from the import process are stored **once per notebook**, not per cell:

```typescript
{
  metadata: {
    importerType: "docx-roundtrip",
    originalFileName: "document.docx",
    originalHash: "abc123...",
    // ... other notebook metadata ...
    importContext: {
      importerType: "docx-roundtrip",
      fileName: "document.docx",
      originalFileName: "document.docx",
      originalHash: "abc123...",
      documentId: "docx-1234567890",
      importTimestamp: "2026-01-05T12:34:56.000Z"
    }
  }
}
```

### Export Phase (TODO)

The export process will work similar to Biblica exporter:

```
Codex Cells → Extract Translations → Locate Original Paragraphs → Replace Content → Rebuild DOCX
```

#### Export Strategy

1. **Load original DOCX** from stored `originalFileData`
2. **Parse original document.xml** to get structure
3. **Match cells to paragraphs** using `paragraphIndex` and `paragraphId`
4. **Replace run content** while preserving all formatting:
   ```xml
   <!-- Original -->
   <w:r>
     <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
     <w:t>Original text</w:t>
   </w:r>
   
   <!-- After export with translation -->
   <w:r>
     <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
     <w:t>Translated text</w:t>
   </w:r>
   ```
5. **Preserve everything else**:
   - Paragraph properties
   - Run properties (bold, italic, fonts, colors)
   - Images and media
   - Tables and lists
   - Headers and footers
   - Page layout
6. **Re-zip as DOCX** file

## Comparison with Biblica Parser

| Feature | Biblica/IDML Parser | DOCX Round-Trip Parser |
|---------|-------------------|----------------------|
| **File Format** | IDML (InDesign) | DOCX (Word) |
| **XML Structure** | IDML custom XML | Office Open XML |
| **Segmentation** | Verse-based (cv:v tags) | Paragraph-based |
| **Metadata Storage** | `beforeVerse`, `afterVerse` | `originalParagraphXml`, runs array |
| **Export Method** | Replace content between meta tags | Replace `<w:t>` content in runs |
| **Structure Tracking** | Story → Paragraph → Character Ranges | Document → Paragraph → Runs |

## Cell Structure Comparison

### Biblica Cell
```typescript
{
  cellLabel: "MAT 1:1",
  isBibleVerse: true,
  bookAbbreviation: "MAT",
  chapterNumber: "1",
  verseNumber: "1",
  verseId: "MAT 1:1",
  beforeVerse: "<CharacterStyleRange...>",  // XML before verse
  afterVerse: "<CharacterStyleRange...>",   // XML after verse
  originalContent: "The book of the genealogy...",
  idmlStructure: { /* complete IDML structure */ }
}
```

### DOCX Cell
```typescript
{
  cellLabel: "¶5",
  paragraphId: "p-5",
  paragraphIndex: 5,
  originalContent: "This is a paragraph...",
  originalParagraphXml: "<w:p>...</w:p>",  // Complete paragraph XML
  runs: [
    {
      content: "This is a paragraph...",
      runProperties: { /* formatting */ },
      originalXml: "<w:r>...</w:r>"
    }
  ],
  docxStructure: { /* paragraph and run properties */ }
}
```

## Implementation Status

### ✅ Completed

1. **Type Definitions** (`docxTypes.ts`)
   - Complete DOCX structure types
   - Cell metadata types
   - Export configuration types

2. **Parser** (`docxParser.ts`)
   - Unzip DOCX files
   - Parse document.xml
   - Extract paragraphs with properties
   - Extract runs with formatting
   - Store original XML for each element

3. **Importer** (`index.ts`)
   - File validation
   - Convert DOCX to cells
   - Preserve complete metadata
   - Generate HTML for display
   - Store original file data

### 🚧 TODO

1. **Exporter** (`docxExporter.ts`)
   - Load original DOCX
   - Match cells to paragraphs
   - Replace text content
   - Preserve all formatting
   - Re-zip as DOCX

2. **Additional Features**
   - Image extraction and embedding
   - Table support
   - Footnote/endnote handling
   - Header/footer preservation
   - Style extraction from styles.xml
   - Numbering support
   - Track changes handling

3. **Testing**
   - Unit tests for parser
   - Integration tests for round-trip
   - Validation of exported DOCX
   - Hash comparison (original vs. exported with same content)

## Usage

### Import a DOCX File

```typescript
import { validateFile, parseFile } from './experiment/index';

// Validate
const validation = await validateFile(file);
if (!validation.isValid) {
  console.error(validation.errors);
  return;
}

// Parse
const result = await parseFile(file, (progress) => {
  console.log(`${progress.stage}: ${progress.message} (${progress.progress}%)`);
});

if (result.success) {
  const { source, codex } = result.notebookPair;
  console.log(`Created ${source.cells.length} cells`);
  
  // Access metadata
  const firstCell = codex.cells[0];
  console.log('Paragraph index:', firstCell.metadata.paragraphIndex);
  console.log('Original content:', firstCell.metadata.originalContent);
  console.log('Runs:', firstCell.metadata.runs);
}
```

### Export with Translations (TODO)

```typescript
import { exportDocxWithTranslations } from './experiment/docxExporter';

// Export
const exportedDocx = await exportDocxWithTranslations(
  originalFileData,  // From notebook.metadata.originalFileData
  codexCells,        // Cells with translations
  docxDocument       // Parsed from notebook.metadata.docxDocument
);

// Save file
const blob = new Blob([exportedDocx], { 
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
});
saveAs(blob, 'translated.docx');
```

## Data Flow Diagram

```
┌─────────────┐
│  DOCX File  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  Unzip & Parse  │
│  (docxParser)   │
└──────┬──────────┘
       │
       ▼
┌──────────────────────┐
│  DocxDocument        │
│  - paragraphs[]      │
│  - styles            │
│  - resources         │
│  - originalHash      │
└──────┬───────────────┘
       │
       ▼
┌────────────────────────┐
│  Create Cells          │
│  (createCellsFromPara) │
└──────┬─────────────────┘
       │
       ▼
┌─────────────────────────┐
│  Codex Notebook         │
│  - cells with metadata  │
│  - originalFileData     │
│  - docxDocument JSON    │
└──────┬──────────────────┘
       │
  [Translation happens in Codex]
       │
       ▼
┌─────────────────────────┐
│  Export (TODO)          │
│  - Load original DOCX   │
│  - Match cells          │
│  - Replace text         │
│  - Preserve formatting  │
└──────┬──────────────────┘
       │
       ▼
┌────────────────┐
│  Translated    │
│  DOCX File     │
└────────────────┘
```

## Testing Strategy

### Unit Tests

1. **Parser Tests**
   - Parse simple paragraph
   - Parse formatted text (bold, italic, etc.)
   - Parse complex formatting (colors, fonts)
   - Parse empty paragraphs
   - Parse special characters

2. **Metadata Tests**
   - Verify all properties captured
   - Verify original XML stored
   - Verify run properties preserved

### Integration Tests

1. **Round-Trip Tests**
   - Import DOCX → Export → Compare hashes
   - Import → Translate → Export → Verify formatting
   - Test with various DOCX features:
     - Headings and styles
     - Lists and numbering
     - Tables
     - Images
     - Footnotes
     - Headers/footers

### Validation

```typescript
// Example round-trip validation
const originalHash = docxDoc.originalHash;
const exportedDoc = await exportDocxWithTranslations(...);
const exportedHash = await computeSHA256(exportedDoc);

// With same content, hashes should match
if (originalHash === exportedHash) {
  console.log('✅ Perfect round-trip!');
} else {
  console.log('⚠️ Structure changed during round-trip');
}
```

## Benefits Over Current Approach

| Aspect | Current (mammoth.js) | New (Round-Trip) |
|--------|---------------------|-----------------|
| **Format Preservation** | Converts to HTML, loses original structure | Preserves complete OOXML structure |
| **Export Quality** | Cannot export back to DOCX | Perfect round-trip export |
| **Formatting** | Limited HTML approximation | All Word formatting preserved |
| **Styles** | Generic HTML styles | Original Word styles maintained |
| **Complex Features** | Lost (tables, numbering, etc.) | Fully preserved |
| **File Integrity** | One-way import only | Two-way import/export |

## Next Steps

1. **Implement Exporter** (`docxExporter.ts`)
   - Core export logic
   - Text replacement
   - ZIP rebuilding

2. **Test with Real Documents**
   - Simple documents
   - Complex formatting
   - Multiple languages
   - Special characters

3. **Add Advanced Features**
   - Image handling
   - Table support
   - Footnotes
   - Headers/footers

4. **Performance Optimization**
   - Stream processing for large files
   - Incremental parsing
   - Memory management

5. **Integration with Codex**
   - Export menu option
   - Progress reporting
   - Error handling
   - Validation feedback

