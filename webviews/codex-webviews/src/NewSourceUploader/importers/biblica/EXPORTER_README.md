# Biblica IDML Exporter - Verse Content Replacement

## Overview

The Biblica IDML Exporter preserves the complete original IDML structure while selectively replacing verse content that has been edited in Codex. It maintains all formatting, styles, metadata tags, and structural elements exactly as they were in the original file.

## How It Works

### 1. Parsing (Import)

During import, the `biblicaParser.ts` extracts verse segments from the IDML structure:

```typescript
{
  bookAbbreviation: "MAT",
  chapterNumber: "1",
  verseNumber: "2",
  beforeVerse: "<CharacterStyleRange...>", // Meta tags before content
  verseContent: "Abraham was the father of Isaac...",
  afterVerse: "<CharacterStyleRange...>"  // Meta tags after content
}
```

These segments are stored in `paragraph.metadata.biblicaVerseSegments`.

### 2. Editing (Codex)

In Codex, each verse becomes a cell with an ID like `"MAT 1:2"`. Users can edit the verse content, which is stored in the Codex notebook.

### 3. Exporting (Round-trip)

During export, the exporter:

1. **Preserves original structure**: Keeps all CharacterStyleRange elements intact
2. **Detects verse patterns**: Identifies the verse pattern by scanning for:
   - Verse number marker (cv:v with content like "11")
   - Spacing elements (_sp)
   - Metadata tag before (meta:v with same number)
   - Verse content (CharacterStyleRange with actual text)
   - Metadata tag after (meta:v with same number)
3. **Replaces only verse content**: When a matching verse ID is found in `verseUpdates`, only the content within the verse's CharacterStyleRange is replaced
4. **Preserves everything else**: All other elements (chapter markers, verse numbers, metadata, spacing, etc.) remain exactly as in the original

## Usage

### Basic Export

```typescript
import { BiblicaExporter } from './biblicaExporter';

// Map of verse IDs to updated content from Codex cells
const verseUpdates = {
  "MAT 1:1": "This is the written story of the family line of Jesus...",
  "MAT 1:2": "Abraham was the father of Isaac...",
  "MAT 1:3": "Judah was the father of Perez and Zerah...",
};

const exporter = new BiblicaExporter({}, verseUpdates);
const idmlXML = await exporter.exportToIDML(parsedDocument);
```

### Export with Configuration

```typescript
const config = {
  preserveAllFormatting: true,
  preserveObjectIds: true,
  validateOutput: true,
  strictMode: false
};

const exporter = new BiblicaExporter(config, verseUpdates);
const idmlXML = await exporter.exportToIDML(parsedDocument);
```

### Dynamic Updates

```typescript
const exporter = new BiblicaExporter();

// Update verses later
const verseUpdates = getUpdatesFromCodexCells();
const idmlXML = await exporter.exportToIDML(parsedDocument, verseUpdates);
```

## IDML Structure Preservation

The exporter preserves the original IDML structure completely. For a verse like "MAT 1:11", it looks for this pattern:

```xml
<!-- Verse number (used to identify the verse) -->
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av">
    <Content>11</Content>
</CharacterStyleRange>

<!-- Spacing (preserved as-is) -->
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
    <Content> </Content>
</CharacterStyleRange>

<!-- Metadata before (preserved as-is) -->
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
    <Content>11</Content>
</CharacterStyleRange>

<!-- VERSE CONTENT - THIS IS THE ONLY PART THAT GETS REPLACED -->
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
    <Content>And Josiah was the father of Jeconiah and his brothers...</Content>
</CharacterStyleRange>

<!-- Metadata after (preserved as-is) -->
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
    <Content>11</Content>
</CharacterStyleRange>
```

**Key Point**: Only the content inside the verse's CharacterStyleRange is replaced. All structural elements remain untouched.

## Key Features

### 1. Selective Content Replacement
- Only the text content within verse CharacterStyleRanges is replaced
- Original content is used if no update is provided
- Multi-line verses are properly handled with `<Br/>` tags

### 2. Complete Structure Preservation
- All CharacterStyleRange elements are preserved in their original order
- Chapter markers (cv:dc) remain untouched
- Verse number markers (cv:v, cv:v1) remain untouched
- Metadata tags (meta:c, meta:v) remain untouched
- Spacing elements remain untouched

### 3. Non-Verse Content
- All other content (introductions, headings, notes) is exported exactly as in the original
- No special handling needed for non-verse paragraphs

## Differences from Standard IDML Exporter

| Feature | Standard IDML Exporter | Biblica Exporter |
|---------|----------------------|------------------|
| Verse detection | N/A | Scans for verse patterns (cv:v + meta:v) |
| Content source | Original `characterStyleRanges` | `verseUpdates` map or original content |
| Structure handling | Direct export | Scans and replaces content within structure |
| Chapter markers | Preserved as-is | Preserved as-is (tracks for verse ID) |
| Verse numbers | Preserved as-is | Preserved as-is (used to identify verses) |
| Metadata tags | Preserved as-is | Preserved as-is |

## Integration with Codex

When integrating with the Codex editor:

1. **On Import**: Store verse segments in cell metadata
2. **During Editing**: Track changes to verse content
3. **On Export**: Collect all edited verses into `verseUpdates` map
4. **Export Call**: Pass updates to exporter

```typescript
// Collect updates from Codex cells
function collectVerseUpdates(codexNotebook: any): VerseUpdate {
  const updates: VerseUpdate = {};
  
  for (const cell of codexNotebook.cells) {
    if (cell.metadata?.isBibleVerse && cell.metadata?.cellLabel) {
      const verseId = cell.metadata.cellLabel; // e.g., "MAT 1:2"
      const content = cell.value; // Updated verse content
      updates[verseId] = content;
    }
  }
  
  return updates;
}

// Export with updates
const verseUpdates = collectVerseUpdates(notebook);
const exporter = new BiblicaExporter({}, verseUpdates);
const idmlXML = await exporter.exportToIDML(document);
```

## Testing

To test the exporter:

1. Parse a Biblica IDML file
2. Create sample verse updates
3. Export and verify structure
4. Reimport to validate round-trip

```typescript
// Test example
const parser = new IDMLParser();
const document = await parser.parseIDML(idmlContent);

const updates = {
  "MAT 1:1": "Updated verse 1",
  "MAT 1:2": "Updated verse 2"
};

const exporter = new BiblicaExporter({}, updates);
const exported = await exporter.exportToIDML(document);

// Verify structure
console.assert(exported.includes("Updated verse 1"));
console.assert(exported.includes("<CharacterStyleRange AppliedCharacterStyle=\"CharacterStyle/cv%3av\">"));
```

## Notes

- The exporter handles both simple verses and complex multi-line verses
- All special characters in verse content are properly XML-escaped
- Empty lines within verses are preserved using `<Br/>` tags
- The verse structure follows Biblica's IDML conventions
