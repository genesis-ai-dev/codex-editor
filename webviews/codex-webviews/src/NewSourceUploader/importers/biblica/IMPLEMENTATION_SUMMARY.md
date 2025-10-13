# Biblica Exporter Implementation Summary

## Approach

The exporter **preserves the original IDML structure completely** and only replaces verse content where it has been edited in Codex. This ensures perfect round-trip fidelity.

## How Verse Replacement Works

### 1. Pattern Detection

The exporter scans through CharacterStyleRange elements looking for this pattern:

```
cv:v (verse number marker) → "11"
  ↓
_sp or spacing (skip)
  ↓
meta:v (metadata before) → "11"
  ↓
VERSE CONTENT ← **THIS IS WHAT WE REPLACE**
  ↓
meta:v (metadata after) → "11"
```

### 2. Verse Identification

When a verse pattern is found:
- Extract verse number from `cv:v` content
- Track current book abbreviation from paragraph metadata
- Track current chapter from `cv:dc` markers
- Build verse ID: `"MAT 1:11"`

### 3. Content Replacement

- Look up verse ID in `verseUpdates` map
- If found: Replace only the content within that CharacterStyleRange
- If not found: Use original content
- All other ranges remain exactly as they were

## Example

### Input Structure (from parsing):
```typescript
characterStyleRanges: [
  { style: "cv:v", content: "11" },              // Verse number
  { style: "$ID/[No style]", content: " " },     // Spacing
  { style: "meta:v", content: "11" },            // Before metadata
  { style: "$ID/[No style]", content: "Original verse text" }, // CONTENT
  { style: "meta:v", content: "11" }             // After metadata
]
```

### Verse Update:
```typescript
verseUpdates = {
  "MAT 1:11": "Edited verse text from Codex"
}
```

### Output (exported IDML):
```xml
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av">
    <Content>11</Content>
</CharacterStyleRange>
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
    <Content> </Content>
</CharacterStyleRange>
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
    <Content>11</Content>
</CharacterStyleRange>
<!-- ONLY THIS CONTENT IS REPLACED -->
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
    <Content>Edited verse text from Codex</Content>
</CharacterStyleRange>
<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">
    <Content>11</Content>
</CharacterStyleRange>
```

## Key Implementation Details

### Tracking Context

The exporter maintains state to build correct verse IDs:

```typescript
class BiblicaExporter {
  private currentStoryId?: string;    // From story.id
  private currentBook?: string;       // From paragraph.metadata.bookAbbreviation
  private currentChapter?: string;    // From cv:dc content
}
```

### Pattern Matching Logic

```typescript
1. Find cv:v marker with verse number (e.g., "11")
2. Skip spacing/empty ranges
3. Look for meta:v with same number
4. Next range is the verse content
5. Build verse ID: `${book} ${chapter}:${verse}`
6. Check verseUpdates map
7. Replace content if update exists
```

### Content Building

```typescript
buildContentXML(content: string) {
  // Splits by \n
  // Wraps text in <Content>
  // Adds <Br/> between lines
  // Returns properly formatted XML
}
```

## Usage Example

### Collecting Updates from Codex

```typescript
function collectVerseUpdates(cells: CodexCell[]): VerseUpdate {
  const updates: VerseUpdate = {};
  
  for (const cell of cells) {
    if (cell.metadata?.isBibleVerse && cell.metadata?.verseId) {
      // Extract plain text from HTML value
      const parser = new DOMParser();
      const doc = parser.parseFromString(cell.value, 'text/html');
      const textContent = doc.body.textContent || '';
      
      updates[cell.metadata.verseId] = textContent;
    }
  }
  
  return updates;
}
```

### Exporting

```typescript
// Parse original IDML
const parser = new IDMLParser();
const document = await parser.parseIDML(originalIdmlContent);

// Collect updates from Codex cells
const verseUpdates = collectVerseUpdates(codexCells);

// Export with updates
const exporter = new BiblicaExporter({}, verseUpdates);
const updatedIdmlXML = await exporter.exportToIDML(document);

// Save or return the updated IDML
```

## What Gets Preserved

✅ **Everything except verse content:**
- All CharacterStyleRange elements
- All attributes (AppliedCharacterStyle, ids, properties)
- Chapter markers (cv:dc)
- Verse number markers (cv:v, cv:v1)
- Metadata tags (meta:c, meta:v)
- Spacing elements
- Line breaks
- Paragraph styles
- Story structure
- Document metadata

❌ **Only this gets replaced:**
- The `content` field of CharacterStyleRange elements that follow the verse pattern

## Round-Trip Testing

To verify the implementation:

```typescript
// 1. Parse original IDML
const original = await parser.parseIDML(idmlFile);

// 2. Export without changes
const exporter1 = new BiblicaExporter();
const exported1 = await exporter1.exportToIDML(original);

// 3. Re-parse exported
const reparsed = await parser.parseIDML(exported1);

// 4. Compare structures (should be identical)
expect(reparsed).toEqual(original);

// 5. Export with verse update
const updates = { "MAT 1:1": "Updated content" };
const exporter2 = new BiblicaExporter({}, updates);
const exported2 = await exporter2.exportToIDML(original);

// 6. Verify update is present
expect(exported2).toContain("Updated content");

// 7. Verify structure is preserved
expect(exported2).toContain("cv%3av");
expect(exported2).toContain("meta%3av");
```

## Benefits of This Approach

1. **Perfect Structure Preservation**: Original IDML structure is completely maintained
2. **Minimal Changes**: Only verse content is modified, nothing else
3. **No Reconstruction**: No need to rebuild verse patterns from scratch
4. **Flexibility**: Works with any verse format or structure
5. **Safety**: If a verse isn't found in updates, original is kept
6. **Extensible**: Easy to add more sophisticated pattern matching

## Differences from Initial Implementation

| Aspect | Initial Approach | Final Approach |
|--------|------------------|----------------|
| Structure | Rebuilt from metadata | Preserved from original |
| Chapter markers | Regenerated | Preserved |
| Verse numbers | Regenerated | Preserved |
| Metadata tags | From stored XML strings | Preserved in place |
| Pattern matching | Based on stored segments | Scans original structure |
| Complexity | High (reconstruction) | Low (selective replacement) |
| Fidelity | Risk of differences | Perfect preservation |
