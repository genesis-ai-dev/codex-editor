# Document Structure Preservation System

## Overview

The Codex Editor now implements a robust document structure preservation system that follows CAT (Computer-Assisted Translation) and TMS (Translation Management System) best practices. This system ensures that documents can be imported, translated, and exported while maintaining their original formatting and structure with near-perfect fidelity.

## Key Features

### 1. **Lossless Round-Tripping**

- Documents maintain their original structure through the import/translation/export cycle
- Character offsets and structural metadata are preserved
- Original files are stored for reference and validation

### 2. **CAT/TMS Best Practices**

- Segments are tracked with precise character offsets
- Structural context is preserved (styles, formatting, hierarchy)
- Similar to XLIFF's approach but integrated into our .source/.codex format

### 3. **Robust Validation**

- Built-in round-trip validation with similarity scoring
- Checksum verification for integrity
- Detailed difference reporting

## How It Works

### Import Process

When a document (e.g., Word/DOCX) is imported:

1. **Original File Storage**: The original file is saved in `.project/attachments/originals/`
2. **Segment Mapping**: Each translatable segment is tracked with:
    - Character offsets (start/end positions)
    - Original content
    - Structural path (DOM/XML path)
    - Style information
3. **Structure Tree**: A complete document structure tree is built and stored
4. **Metadata Storage**: All structure data is serialized and stored in the notebook metadata

### Cell Metadata Structure

Each cell in the codex file contains enhanced metadata:

```json
{
    "id": "DOCUMENT 1:1",
    "type": "text",
    "data": {
        "originalContent": "<p><strong>Original text</strong></p>",
        "originalOffset": {
            "start": 0,
            "end": 38
        },
        "segmentIndex": 0
    }
}
```

### Export Process

When exporting a translated document:

1. **Structure Recovery**: The original structure tree is deserialized from metadata
2. **Content Mapping**: Updated translations are mapped to their original positions
3. **Document Reconstruction**: The original structure is rebuilt with translated content
4. **Validation**: Optional round-trip validation ensures structural integrity
5. **Format Conversion**: Convert back to original format (e.g., HTML to DOCX)

## File Organization

```
workspace/
├── files/
│   ├── source/
│   │   └── document.source     # Source notebook with structure metadata
│   └── target/
│       └── document.codex      # Translated content with segment references
└── .project/
    ├── attachments/
    │   └── originals/
    │       └── document.docx    # Original imported file
    └── sourceTexts/
        └── document.source      # Source text with full structure metadata
```

## API Usage

### Importing with Structure Preservation

The DOCX importer automatically preserves structure:

```typescript
// In parseFile function
const structureMetadata: DocumentStructureMetadata = {
    originalFileRef: `attachments/originals/${file.name}`,
    originalMimeType: "application/vnd.openxmlformats...",
    originalFileHash: fileHash,
    segments: offsetTracker.getSegments(),
    structureTree: buildStructureTree(parsedHtml, segmentMap),
    preservationFormatVersion: "1.0.0",
};
```

### Exporting with Structure Reconstruction

```typescript
import { exportWithOriginalStructure } from "./documentStructureExporter";

await exportWithOriginalStructure(codexFileUri, outputPath, {
    validateBeforeExport: true,
    preserveInlineMarkup: true,
});
```

### Round-Trip Validation

```typescript
const validation = await validateRoundTrip(originalContent, reconstructedContent, {
    whitespaceNormalization: true,
    selfClosingTags: true,
    attributeOrder: true,
});

if (validation.isValid) {
    console.log(`Similarity: ${validation.similarity * 100}%`);
}
```

## XLIFF Integration

The system is designed to work seamlessly with XLIFF export:

1. Original content is preserved in metadata
2. Segment IDs map directly to translation units
3. Structure metadata can be included as XLIFF extensions

## Testing

Comprehensive tests ensure reliability:

- **Unit Tests**: Test individual components (offset tracking, reconstruction)
- **Integration Tests**: Test complete import/export cycles
- **Edge Cases**: Handle empty segments, special characters, complex nesting

Run tests with:

```bash
npm test -- --grep "Document Structure Preservation"
```

## Benefits

### For Translators

- Confidence that formatting won't be lost
- Focus on translation without worrying about structure
- Compatible with industry-standard CAT tools

### For Project Managers

- Reduced post-processing time
- Fewer formatting errors
- Professional deliverables

### For Developers

- Extensible architecture
- Clear separation of concerns
- Well-tested and documented

## Future Enhancements

- [ ] Direct DOCX export without intermediate HTML
- [ ] Support for more document formats (PDF, RTF, ODT)
- [ ] Advanced diff algorithms for better inline markup preservation
- [ ] XLIFF 2.1 compliance with full metadata preservation
- [ ] Visual diff viewer for structure changes

## Technical Details

### Core Components

1. **OffsetTracker**: Tracks character positions during segmentation
2. **DocumentStructureMetadata**: Stores all structural information
3. **StructureTree**: Hierarchical representation of document
4. **Reconstruction Engine**: Rebuilds documents with updated content

### Similarity Calculation

Uses Levenshtein distance algorithm to calculate similarity:

- 100% = Perfect match
- 95%+ = Acceptable for most use cases
- <95% = May have structural issues

### Checksum Verification

SHA-256 checksums ensure:

- Original file integrity
- Segment content verification
- Metadata consistency

## Troubleshooting

### Common Issues

1. **Validation Failures**

    - Check whitespace normalization settings
    - Verify inline markup preservation
    - Review difference report

2. **Missing Structure Metadata**

    - Ensure file was imported with latest importer
    - Check notebook metadata for `documentStructure` field

3. **Export Format Issues**
    - DOCX export requires additional tooling
    - HTML export is always available as fallback

## Conclusion

This structure preservation system brings enterprise-grade document handling to Codex Editor, ensuring that translators can work with confidence knowing their document formatting will be preserved throughout the translation workflow.
