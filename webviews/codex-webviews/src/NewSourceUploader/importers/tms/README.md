# TMS (Translation Memory System) Importer

## Overview

The TMS importer handles TMX (Translation Memory eXchange) and XLIFF (XML Localization Interchange File Format) files, converting translation units into editable codex cells.

## Supported Formats

- **TMX** (`.tmx`) - Translation Memory eXchange format
- **XLIFF** (`.xliff`, `.xlf`) - XML Localization Interchange File Format

## Features

- **Simple Cell Conversion**: Converts translation units directly to codex cells without any Bible-specific processing
- **Source/Target Support**: Handles both source and target language text from translation units
- **Metadata Preservation**: Maintains unit IDs, language codes, and notes from the original files
- **Sequential Numbering**: Creates cells with simple sequential IDs (tms 1:1, tms 1:2, etc.)

## How It Works

### File Structure

The importer processes translation files in the following steps:

1. **Validation**: Checks file extension, XML structure, and presence of translation units
2. **Parsing**: Extracts translation units with their source and target text
3. **Cell Creation**: Converts each translation unit to a codex cell with metadata
4. **Notebook Generation**: Creates source and codex notebook pairs

### Translation Unit Structure

Each translation unit is converted to a cell containing:
- **Content**: HTML paragraph with the text (source or target based on import type)
- **Metadata**:
  - `unitId`: Original translation unit identifier
  - `sourceLanguage`: Source language code
  - `targetLanguage`: Target language code
  - `cellLabel`: Sequential number (1, 2, 3, ...)
  - `originalText`: Source text
  - `targetText`: Target text (if available)
  - `note`: Any notes associated with the unit

### Cell Format

```html
<p class="translation-unit" 
   data-unit-id="..." 
   data-source-language="..." 
   data-target-language="...">
   [Translation text]
</p>
```

## Usage

### Source Import

When importing as a source document:
- Extracts **source language** text from translation units
- Creates cells with source text as primary content
- Stores target text in metadata for reference

### Target Import

When importing as a translation:
- Extracts **target language** text from translation units
- Creates cells with target text as primary content
- Aligns with existing source document cells

## Implementation Details

### File Parsing

The importer uses `fast-xml-parser` to parse TMX and XLIFF files:

**TMX Format**:
```xml
<tu tuid="...">
  <tuv xml:lang="en"><seg>Source text</seg></tuv>
  <tuv xml:lang="fr"><seg>Target text</seg></tuv>
</tu>
```

**XLIFF Format**:
```xml
<trans-unit id="...">
  <source>Source text</source>
  <target>Target text</target>
</trans-unit>
```

### Cell ID Generation

All cells use a consistent format: `tms 1:[sequential_number]`

This ensures all translation units appear on a single page in the editor.

## Limitations

- Does not perform Bible verse recognition or mapping
- Assumes sequential processing of translation units
- Limited to 50MB file size (warning threshold)

## Testing

To test the importer:

1. Prepare a TMX or XLIFF file with translation units
2. Use the importer in the New Source Uploader
3. Select the file and click Import
4. Verify that cells are created with correct content and metadata

## Future Enhancements

Potential improvements:
- Support for additional TMS formats (e.g., SDLXLIFF)
- Advanced alignment algorithms for non-sequential content
- Batch import of multiple translation memory files
- Export back to TMX/XLIFF with edits preserved

