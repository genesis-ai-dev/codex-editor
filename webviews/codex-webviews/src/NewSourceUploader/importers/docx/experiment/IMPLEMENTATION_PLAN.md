# DOCX Round-Trip Implementation Plan

## Status: 🟡 Phase 1 Complete - Ready for Testing

## Overview

This document tracks the implementation progress of the DOCX round-trip import/export system, modeled after the Biblica/IDML parser approach.

---

## Phase 1: Core Parser & Importer ✅ COMPLETE

### ✅ Completed Tasks

1. **Type Definitions** (`docxTypes.ts`)
   - [x] Core DOCX document structure types
   - [x] Paragraph and run types
   - [x] Properties types (paragraph & run)
   - [x] Style definitions
   - [x] Resource types (images, fonts, media)
   - [x] Relationships types
   - [x] Cell metadata type for Codex
   - [x] Export configuration types
   - [x] Error types

2. **OOXML Parser** (`docxParser.ts`)
   - [x] DocxParser class with configuration
   - [x] DOCX file unzipping (JSZip)
   - [x] XML parsing (fast-xml-parser)
   - [x] document.xml extraction
   - [x] Paragraph extraction with properties
   - [x] Run extraction with formatting
   - [x] Original XML preservation
   - [x] SHA-256 hash generation
   - [x] Debug logging system
   - [x] XML helper methods (findElement, findAllElements, etc.)

3. **Main Importer** (`index.ts`)
   - [x] File validation
   - [x] parseFile integration with DocxParser
   - [x] Cell creation from paragraphs
   - [x] Metadata preservation for round-trip
   - [x] HTML generation for display
   - [x] Notebook pair creation
   - [x] Original file data storage
   - [x] Progress reporting

4. **Helper Functions**
   - [x] createCellsFromParagraphs
   - [x] convertParagraphToHtml
   - [x] convertRunToHtml
   - [x] escapeHtml
   - [x] countWordsInDocument

5. **Documentation**
   - [x] README.md with architecture overview
   - [x] Usage examples
   - [x] Comparison with Biblica parser
   - [x] Data flow diagrams
   - [x] Testing strategy outline

6. **Exporter Skeleton** (`docxExporter.ts`)
   - [x] Basic export function structure
   - [x] Translation collection logic
   - [x] XML replacement strategy
   - [x] Helper functions
   - [x] DocxExporter class

---

## Phase 2: Advanced Parser Features 🚧 IN PROGRESS

### 🔲 Pending Tasks

1. **Style Extraction**
   - [ ] Parse styles.xml
   - [ ] Extract paragraph styles
   - [ ] Extract character styles
   - [ ] Extract table styles
   - [ ] Map style IDs to definitions

2. **Resource Extraction**
   - [ ] Extract images from word/media/
   - [ ] Parse relationships from document.xml.rels
   - [ ] Store image data with cells
   - [ ] Handle embedded fonts
   - [ ] Handle media files

3. **Metadata Extraction**
   - [ ] Parse docProps/core.xml
   - [ ] Extract author, title, dates
   - [ ] Parse docProps/app.xml
   - [ ] Store custom properties

4. **Advanced Paragraph Features**
   - [ ] Numbering support (numbering.xml)
   - [ ] List formatting
   - [ ] Keep with next/keep lines together
   - [ ] Page break before
   - [ ] Outline levels

5. **Footnotes & Endnotes**
   - [ ] Parse footnotes.xml
   - [ ] Parse endnotes.xml
   - [ ] Link footnote references to content
   - [ ] Preserve footnote formatting

---

## Phase 3: Exporter Implementation 🔲 TODO

### Critical Export Features

1. **Core Export Logic**
   - [ ] Load and parse original DOCX
   - [ ] Match cells to paragraphs by ID
   - [ ] Replace text in w:t elements
   - [ ] Preserve all run properties
   - [ ] Preserve all paragraph properties
   - [ ] Re-zip as valid DOCX

2. **Text Distribution**
   - [ ] Smart text distribution across runs
   - [ ] Handle translations longer than original
   - [ ] Handle translations shorter than original
   - [ ] Preserve formatting breaks
   - [ ] Handle special characters

3. **Formatting Preservation**
   - [ ] Maintain bold/italic/underline
   - [ ] Maintain fonts and sizes
   - [ ] Maintain colors
   - [ ] Maintain alignment and indentation
   - [ ] Maintain spacing

4. **Advanced Features**
   - [ ] Image preservation
   - [ ] Table content replacement
   - [ ] Footnote content replacement
   - [ ] Header/footer preservation
   - [ ] Numbering preservation

5. **Validation**
   - [ ] XML schema validation
   - [ ] Round-trip integrity check
   - [ ] Hash comparison (structure)
   - [ ] Content verification
   - [ ] Error reporting

---

## Phase 4: Testing & Validation 🔲 TODO

### Unit Tests

1. **Parser Tests**
   - [ ] Test simple paragraph parsing
   - [ ] Test formatted text (bold, italic)
   - [ ] Test complex formatting
   - [ ] Test empty paragraphs
   - [ ] Test special characters
   - [ ] Test multiple runs per paragraph
   - [ ] Test paragraph properties
   - [ ] Test run properties

2. **Exporter Tests**
   - [ ] Test simple text replacement
   - [ ] Test formatted text replacement
   - [ ] Test longer translations
   - [ ] Test shorter translations
   - [ ] Test special characters in translation
   - [ ] Test multiple paragraphs

### Integration Tests

1. **Round-Trip Tests**
   - [ ] Import → Export with same content → Compare
   - [ ] Import → Translate → Export → Verify structure
   - [ ] Test with various document types:
     - [ ] Simple text document
     - [ ] Formatted document (headings, styles)
     - [ ] Document with images
     - [ ] Document with tables
     - [ ] Document with lists
     - [ ] Document with footnotes
     - [ ] Document with headers/footers

2. **Real-World Tests**
   - [ ] Test with actual translation documents
   - [ ] Test with multi-language content
   - [ ] Test with large documents (100+ pages)
   - [ ] Test with complex formatting
   - [ ] Performance benchmarking

---

## Phase 5: Integration with Codex 🔲 TODO

### UI Integration

1. **Import Flow**
   - [ ] Add experimental importer to registry
   - [ ] Create toggle to use new vs. old importer
   - [ ] Add progress indicators
   - [ ] Add error handling UI
   - [ ] Add metadata preview

2. **Export Flow**
   - [ ] Add export menu option
   - [ ] Create export dialog
   - [ ] Add progress indicators
   - [ ] Add validation feedback
   - [ ] Add download functionality

3. **Settings**
   - [ ] Add parser configuration options
   - [ ] Add export configuration options
   - [ ] Add validation options
   - [ ] Add debug mode toggle

---

## Phase 6: Optimization & Polish 🔲 TODO

### Performance

1. **Parser Optimization**
   - [ ] Stream processing for large files
   - [ ] Incremental parsing
   - [ ] Memory optimization
   - [ ] Parallel processing where possible

2. **Exporter Optimization**
   - [ ] Efficient XML manipulation
   - [ ] Minimize re-parsing
   - [ ] Stream ZIP generation
   - [ ] Memory management

### Error Handling

1. **Graceful Degradation**
   - [ ] Handle malformed DOCX
   - [ ] Handle unsupported features
   - [ ] Provide helpful error messages
   - [ ] Suggest fixes for common issues

2. **Recovery**
   - [ ] Partial import on errors
   - [ ] Validation warnings
   - [ ] Manual override options

---

## Testing Checklist

### Ready to Test Now ✅

You can test the import functionality with these steps:

1. **Basic Import Test**
   ```typescript
   // In your test file or component
   import { validateFile, parseFile } from './experiment/index';
   
   const file = /* your DOCX file */;
   const validation = await validateFile(file);
   console.log('Validation:', validation);
   
   const result = await parseFile(file);
   console.log('Result:', result);
   ```

2. **Check Metadata**
   - Verify `result.notebookPair.source.metadata.docxDocument` exists
   - Verify `result.notebookPair.source.metadata.originalFileData` exists
   - Verify cells have `paragraphId`, `paragraphIndex`
   - Verify cells have `docxStructure` with properties
   - Verify cells have `runs` array

3. **Check Cell Content**
   - Verify HTML rendering looks correct
   - Verify formatting is preserved in HTML
   - Verify paragraph properties are visible

### Cannot Test Yet ⏳

- Export functionality (Phase 3 incomplete)
- Round-trip validation (Phase 3 incomplete)
- Advanced features (images, tables, footnotes)

---

## Known Limitations (Current Phase)

1. **Not Implemented Yet**
   - Image extraction
   - Table parsing
   - Footnote handling
   - Style definitions extraction
   - Relationship parsing
   - Export functionality

2. **Simplified Implementation**
   - Basic paragraph property extraction only
   - Basic run property extraction only
   - Simple HTML conversion (no complex styling)
   - No validation of XML schema

3. **Performance**
   - No optimization for large files
   - Full file loaded into memory
   - No streaming support

---

## Success Criteria

### Phase 1 (Current) ✅
- [x] Parse DOCX files successfully
- [x] Extract paragraphs with text
- [x] Extract run formatting
- [x] Store original XML structure
- [x] Generate Codex cells with metadata
- [x] Store original file data
- [x] Generate hash for integrity

### Phase 2
- [ ] Extract all paragraph properties
- [ ] Extract all run properties
- [ ] Extract images
- [ ] Extract styles
- [ ] Extract metadata

### Phase 3
- [ ] Export DOCX with translations
- [ ] Preserve all formatting
- [ ] Valid DOCX output
- [ ] Opens correctly in Word

### Phase 4
- [ ] Pass all unit tests
- [ ] Pass all integration tests
- [ ] Round-trip validation passes
- [ ] Performance acceptable

### Phase 5
- [ ] Integrated with Codex UI
- [ ] User-friendly export flow
- [ ] Error handling complete
- [ ] Documentation complete

---

## Next Immediate Steps

1. **Test Current Implementation**
   - Create test DOCX files
   - Run import on various documents
   - Verify metadata is captured correctly
   - Check for any parsing errors

2. **Implement Basic Exporter**
   - Focus on simple text replacement first
   - Get basic round-trip working
   - Add validation

3. **Add Image Support**
   - Extract images during import
   - Embed images in export
   - Test with image-heavy documents

4. **Expand Tests**
   - Add unit tests for parser
   - Add integration tests
   - Set up CI/CD

---

## Resources & References

- **OOXML Specification**: [ECMA-376](https://www.ecma-international.org/publications-and-standards/standards/ecma-376/)
- **fast-xml-parser Docs**: https://github.com/NaturalIntelligence/fast-xml-parser
- **JSZip Docs**: https://stuk.github.io/jszip/
- **Biblica Parser**: `../biblica/biblicaParser.ts` (reference implementation)
- **Biblica Exporter**: `../biblica/biblicaExporter.ts` (reference implementation)

---

## Questions & Decisions

### Resolved ✅
- **Q**: Should we segment by paragraph or by sentence?
  - **A**: Paragraph for now (matches Word's natural structure)
  
- **Q**: How to store original XML?
  - **A**: Store complete paragraph XML in metadata, plus individual run XML

- **Q**: How to handle formatting in HTML display?
  - **A**: Convert to inline HTML styles for preview

### Pending 🤔
- **Q**: How to handle tables?
  - **A**: TBD - may need separate cell type

- **Q**: How to handle complex formatting (borders, shading)?
  - **A**: TBD - need to test with real documents

- **Q**: How to handle track changes?
  - **A**: TBD - may need to accept/reject before import

---

## Contact & Feedback

If you encounter issues or have suggestions:
1. Check the README.md for architecture details
2. Review the code comments in parser/exporter
3. Look at the Biblica implementation for patterns
4. Test with simple documents first, then complex ones

---

**Last Updated**: 2025-10-14
**Phase**: 1 (Core Parser & Importer)
**Status**: ✅ Complete - Ready for Testing

