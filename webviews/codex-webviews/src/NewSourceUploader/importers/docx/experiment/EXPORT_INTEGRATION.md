# DOCX Round-Trip Export - Integration Complete ✅

## What Was Added

The experimental DOCX round-trip exporter has been integrated into the main export handler!

## Changes Made to `src/exportHandler/exportHandler.ts`

### 1. Added Export Format Enum
```typescript
export enum CodexExportFormat {
    // ... existing formats ...
    DOCX_ROUNDTRIP = "docx-roundtrip",  // ✨ NEW!
}
```

### 2. Created Export Function
Added `exportCodexContentAsDocxRoundtrip()` function that:
- Loads the original DOCX file from attachments
- Reads the codex notebook with translations
- Validates it was imported with the round-trip importer
- Exports using the experimental exporter
- Saves the translated DOCX with timestamp

### 3. Added to Switch Statement
```typescript
case CodexExportFormat.DOCX_ROUNDTRIP:
    await exportCodexContentAsDocxRoundtrip(userSelectedPath, filesToExport, options);
    break;
```

## How It Works

```
User selects "Export as DOCX Round-trip"
    ↓
exportCodexContentAsDocxRoundtrip() called
    ↓
For each selected .codex file:
    1. Check importerType === 'docx-roundtrip'
    2. Load original DOCX from .project/attachments/originals/
    3. Get docxDocument structure from metadata
    4. Call experimental exporter:
       exportDocxWithTranslations(originalFile, cells, docxDoc)
    5. Save as: originalName_TIMESTAMP_translated.docx
    ↓
Success! Translated DOCX ready to open in Word
```

## Key Features

### ✅ Validation
- Checks that file was imported with `docx-roundtrip` importer
- Warns and skips files imported with old mammoth.js importer
- Validates metadata contains required `docxDocument` structure

### ✅ Progress Reporting
- Shows progress notification during export
- Updates for each file processed
- Reports errors per file without stopping entire batch

### ✅ File Naming
- Preserves original filename
- Adds timestamp for versioning
- Adds `_translated` suffix for clarity
- Example: `mydocument_2025-10-15T14-30-00_translated.docx`

### ✅ Error Handling
- Try-catch per file
- Detailed error messages
- Continues processing other files on error
- Console logging for debugging

## Usage

### From Command Palette
```
> Export Codex Content
Select format: DOCX Round-trip (Experimental)
Choose export folder
Select .codex files to export
```

### Programmatically
```typescript
import { exportCodexContent, CodexExportFormat } from './exportHandler';

await exportCodexContent(
    CodexExportFormat.DOCX_ROUNDTRIP,
    '/path/to/export/folder',
    ['/path/to/file1.codex', '/path/to/file2.codex']
);
```

## Requirements

### For Export to Work

1. **File must be imported with round-trip importer**
   - `importerType` must be `'docx-roundtrip'`
   - Files imported with old mammoth.js importer will be skipped

2. **Original file must exist**
   - Located in `.project/attachments/originals/`
   - Filename from `originalFileName` metadata

3. **Document structure must be stored**
   - `docxDocument` in notebook metadata
   - Contains complete OOXML structure

## Testing

### Test Files
Create test .codex files by importing DOCX with experimental importer:

```typescript
// In NewSourceUploader
import { parseFile } from './experiment/index';

const result = await parseFile(docxFile);
// Creates notebook with importerType: 'docx-roundtrip'
```

### Test Export
1. Import DOCX file using experimental importer
2. Translate some cells in Codex
3. Export using DOCX Round-trip format
4. Open exported file in Microsoft Word
5. Verify:
   - ✅ Translations appear correctly
   - ✅ All formatting preserved
   - ✅ Structure intact
   - ✅ Images present (when implemented)

## Known Limitations (Current Phase)

1. **Text-only replacement**
   - Currently replaces text in first run only
   - TODO: Distribute across multiple runs with formatting

2. **No image handling yet**
   - Images preserved but not updated
   - Phase 3 feature

3. **No table support yet**
   - Tables preserved but content not replaced
   - Phase 3 feature

4. **Simple HTML stripping**
   - Uses basic tag removal
   - TODO: Improve HTML to text conversion

## Next Steps

### Phase 2: Complete Export Logic
- [ ] Improve text distribution across runs
- [ ] Better HTML to text conversion
- [ ] Handle complex formatting
- [ ] Add validation tests

### Phase 3: Advanced Features
- [ ] Image extraction and embedding
- [ ] Table content replacement
- [ ] Footnote handling
- [ ] Header/footer support

### Phase 4: Production Ready
- [ ] Comprehensive testing
- [ ] Performance optimization
- [ ] User documentation
- [ ] UI integration improvements

## Console Output Example

```
[DOCX Export] Processing mydocument.codex using experimental round-trip exporter
[DOCX Exporter] Starting export...
[DOCX Exporter] Loaded original DOCX
[DOCX Exporter] Extracted document.xml
[DOCX Exporter] Collected 15 translations
[Exporter] Collected translation for p-0: "This is the translated first paragraph..."
[Exporter] Collected translation for p-1: "This is the translated second paragraph..."
...
[Exporter] Parsed document.xml
[Exporter] Found 15 paragraphs in XML
[Exporter] Replaced paragraph 0 (p-0): "This is the translated first paragraph..."
[Exporter] Replaced paragraph 1 (p-1): "This is the translated second paragraph..."
...
[Exporter] Replaced 15 paragraphs
[DOCX Exporter] Updated document.xml with translations
[DOCX Exporter] Export complete
[DOCX Export] Round-trip export completed: mydocument_2025-10-15T14-30-00_translated.docx
```

## Troubleshooting

### "Skipping - not imported with DOCX round-trip importer"
**Cause**: File was imported with old mammoth.js importer
**Solution**: Re-import the file using experimental importer

### "No DOCX document structure found in metadata"
**Cause**: Metadata missing or corrupted
**Solution**: Re-import the source file

### "document.xml not found"
**Cause**: Invalid or corrupted DOCX file
**Solution**: Check original file is valid DOCX

### "Original file not found"
**Cause**: Original file missing from attachments
**Solution**: Ensure original file exists in `.project/attachments/originals/`

## Code Location

- **Export Handler**: `src/exportHandler/exportHandler.ts` (lines 397-487, 531-533)
- **Experimental Exporter**: `webviews/codex-webviews/src/NewSourceUploader/importers/docx/experiment/docxExporter.ts`
- **Experimental Importer**: `webviews/codex-webviews/src/NewSourceUploader/importers/docx/experiment/index.ts`

## Documentation

- **README**: Architecture and technical details
- **TESTING_GUIDE**: Testing instructions
- **IMPLEMENTATION_PLAN**: Development roadmap
- **SUMMARY**: Quick overview
- **EXPORT_INTEGRATION**: This file

---

**Status**: ✅ Integrated and Ready for Testing

**Last Updated**: 2025-10-15

**Phase**: 1 Complete - Export handler integration done!

