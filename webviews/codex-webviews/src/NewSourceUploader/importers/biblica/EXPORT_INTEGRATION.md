# Biblica IDML Export Integration

## Overview

The Biblica IDML exporter has been integrated into the Codex Editor's export system, allowing users to export their edited Bible translations back into the original IDML format with updated verse content.

## Integration Points

### 1. Export Format Enum

**File**: `src/exportHandler/exportHandler.ts`

Added new export format:
```typescript
export enum CodexExportFormat {
    // ... existing formats
    BIBLICA_IDML = "biblica-idml",
}
```

### 2. Export Handler Function

**File**: `src/exportHandler/exportHandler.ts`

Implemented `exportCodexContentAsBiblicaIdml()` function that:

1. **Locates Original IDML**: Finds the original IDML file in `.project/attachments/originals/`
2. **Parses IDML**: Uses `IDMLParser` to parse the original file structure
3. **Collects Updates**: Extracts verse content from Codex cells with `isBibleVerse` metadata
4. **Exports**: Uses `BiblicaExporter` to create updated IDML with verse replacements
5. **Saves**: Writes the result as a new IDML file with timestamp

### 3. UI Option

**File**: `src/projectManager/projectExportView.ts`

Added export option in the UI:
```html
<div class="format-option" data-format="biblica-idml" style="flex: 1;">
    <i class="codicon codicon-book"></i>
    <div>
        <strong>Biblica IDML</strong>
        <p>Export Bible verses back into original Biblica IDML structure</p>
        <span class="format-tag">Bible Translation</span>
    </div>
</div>
```

## How It Works

### Export Flow

```
User selects "Biblica IDML" → Select .codex files → Choose export location
                                        ↓
                    Find original IDML in .project/attachments/originals/
                                        ↓
                            Parse original IDML structure
                                        ↓
                    Collect verse updates from Codex cells
                    (cells with metadata.isBibleVerse === true)
                                        ↓
                        BiblicaExporter.exportToIDML()
                        - Preserves original structure
                        - Replaces only verse content
                                        ↓
                    Save as [original]_[timestamp]_biblica.idml
```

### Verse Collection Logic

```typescript
for (const cell of codexNotebook.getCells()) {
    const metadata = cell.metadata;
    if (metadata?.isBibleVerse && metadata?.verseId) {
        // Extract plain text from HTML
        const htmlContent = cell.document.getText();
        let plainText = extractTextFromHTML(htmlContent);
        
        // Store update: "MAT 1:11" -> "updated verse text"
        verseUpdates[metadata.verseId] = plainText;
    }
}
```

### File Naming Convention

Exported files are named:
```
[original_name]_[ISO_timestamp]_biblica.idml

Example: mat-john_2025-10-06T13-45-30-123Z_biblica.idml
```

## Usage

### For End Users

1. Open Codex Editor
2. Go to **File Explorer** → Right-click project → **Export Project**
3. Select **Biblica IDML** format
4. Choose which `.codex` files to export
5. Select destination folder
6. Files are exported with updated verse content

### For Developers

To use the export function programmatically:

```typescript
import { exportCodexContent, CodexExportFormat } from './exportHandler';

await exportCodexContent(
    CodexExportFormat.BIBLICA_IDML,
    '/path/to/export/folder',
    ['files/target/Matthew.codex'],
    {} // options
);
```

## Requirements

### Codex Cell Metadata

For a cell to be included in the export, it must have:

```typescript
{
    metadata: {
        isBibleVerse: true,
        verseId: "MAT 1:11",  // Format: "BOOK CHAPTER:VERSE"
        bookAbbreviation: "MAT",
        chapterNumber: "1",
        verseNumber: "11"
    }
}
```

### Original IDML File

The original IDML file must be stored in:
```
.project/attachments/originals/[filename].idml
```

The system matches Codex files to IDML files by name similarity.

## Error Handling

### Missing Original IDML

If the original IDML file cannot be found:
```
Warning: "Original IDML file not found for [filename]. Skipping."
```

The export continues with other files.

### Parse/Export Errors

If parsing or export fails:
```
Error: "Biblica IDML export failed for [path]: [error message]"
```

The error is logged and shown to the user, but the export continues with remaining files.

## Output

### Success Message

After completion:
```
✓ Biblica IDML export completed to [export path]
```

### Console Logs

During export:
```
Collected 25 verse updates for mat-john
Exported Biblica IDML: mat-john_2025-10-06T13-45-30-123Z_biblica.idml
```

## Differences from Standard IDML Round-Trip

| Feature | IDML Round-Trip | Biblica IDML |
|---------|----------------|--------------|
| Purpose | General IDML translation | Bible verse translation |
| Parser | Generic | Biblica-specific |
| Exporter | Injects cells into ZIP | Rebuilds XML with BiblicaExporter |
| Structure | Modifies story XML | Preserves complete structure |
| Content Source | All cells | Only cells with `isBibleVerse` |
| Metadata Required | Basic cell ID | Full verse metadata |

## Technical Details

### Dynamic Imports

The exporter uses dynamic imports to load parser/exporter only when needed:

```typescript
const { IDMLParser } = await import(".../biblicaParser");
const { BiblicaExporter } = await import(".../biblicaExporter");
```

This keeps the main bundle size small.

### HTML to Plain Text

Cell content is converted from HTML to plain text:

```typescript
htmlContent
    .replace(/<[^>]+>/g, '')           // Strip tags
    .replace(/&lt;/g, '<')             // Decode entities
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
```

### ArrayBuffer Conversion

Proper ArrayBuffer creation for parsing:

```typescript
const arrayBuffer = new ArrayBuffer(originalIdmlData.byteLength);
const view = new Uint8Array(arrayBuffer);
view.set(originalIdmlData);
```

## Testing

To test the integration:

1. **Import a Biblica IDML** using the Source Uploader
2. **Edit some verses** in the resulting Codex notebook
3. **Export as Biblica IDML**
4. **Verify**:
   - File is created in export folder
   - Updated verses are present in exported IDML
   - Structure is preserved (can re-open in InDesign)

## Future Enhancements

Potential improvements:

1. **Batch Export**: Export multiple books in one operation
2. **Validation**: Verify all verses are present before export
3. **Preview**: Show diff of changes before export
4. **Metadata Export**: Include translation metadata in IDML
5. **Compression**: Option to output as ZIP archive

## Troubleshooting

### "Original IDML file not found"

**Cause**: IDML was deleted or moved from `.project/attachments/originals/`

**Solution**: Re-import the source IDML file

### "Failed to parse IDML"

**Cause**: Original IDML file is corrupted or invalid

**Solution**: Verify the original IDML opens in InDesign

### "Export failed: [error]"

**Cause**: Various (permissions, disk space, etc.)

**Solution**: Check console logs for detailed error message

## Related Documentation

- [BiblicaExporter Implementation](./IMPLEMENTATION_SUMMARY.md)
- [Exporter API](./EXPORTER_README.md)
- [Parser Documentation](./biblicaParser.ts)
