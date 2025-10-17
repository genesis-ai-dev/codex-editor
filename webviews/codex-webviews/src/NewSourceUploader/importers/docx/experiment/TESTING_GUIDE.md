# DOCX Round-Trip - Testing Guide

## Quick Start

This guide helps you test the new DOCX round-trip importer.

---

## Prerequisites

- Node.js and npm installed
- Project dependencies installed (`npm install`)
- Test DOCX files ready

---

## Phase 1 Testing: Import Only

### Test 1: Basic Import

**Goal**: Verify the parser can read a simple DOCX file.

**Test File**: Create a simple Word document with 2-3 paragraphs of text.

**Code**:
```typescript
import { validateFile, parseFile } from './experiment/index';

async function testBasicImport(file: File) {
    console.log('=== Test 1: Basic Import ===');
    
    // Validate
    const validation = await validateFile(file);
    console.log('Validation result:', validation);
    
    if (!validation.isValid) {
        console.error('Validation failed:', validation.errors);
        return;
    }
    
    // Parse
    const result = await parseFile(file, (progress) => {
        console.log(`${progress.stage}: ${progress.message} (${progress.progress}%)`);
    });
    
    if (!result.success) {
        console.error('Parse failed:', result.error);
        return;
    }
    
    // Check results
    console.log('Success! Notebook pair created');
    console.log('Source cells:', result.notebookPair?.source.cells.length);
    console.log('Codex cells:', result.notebookPair?.codex.cells.length);
    console.log('Metadata:', result.metadata);
    
    // Check first cell
    const firstCell = result.notebookPair?.source.cells[0];
    console.log('\nFirst cell:');
    console.log('- ID:', firstCell?.id);
    console.log('- Content:', firstCell?.content?.substring(0, 100));
    console.log('- Metadata keys:', Object.keys(firstCell?.metadata || {}));
    
    return result;
}
```

**Expected Output**:
```
=== Test 1: Basic Import ===
Validation result: { isValid: true, fileType: 'docx', errors: [], warnings: [] }
Reading File: Reading DOCX file... (10%)
Parsing OOXML: Extracting document structure from DOCX... (30%)
Creating Cells: Converting paragraphs to cells... (60%)
Creating Notebooks: Creating source and codex notebooks... (80%)
Complete: DOCX processing complete (100%)
Success! Notebook pair created
Source cells: 3
Codex cells: 3
Metadata: { wordCount: 45, segmentCount: 3, paragraphCount: 3, imageCount: 0 }

First cell:
- ID: document.docx_1_1
- Content: <p>This is the first paragraph of text.</p>
- Metadata keys: ['cellId', 'paragraphId', 'paragraphIndex', 'originalContent', ...]
```

### Test 2: Metadata Inspection

**Goal**: Verify all necessary metadata is captured.

**Code**:
```typescript
async function testMetadata(file: File) {
    console.log('\n=== Test 2: Metadata Inspection ===');
    
    const result = await parseFile(file);
    if (!result.success) return;
    
    const sourceNotebook = result.notebookPair?.source;
    const firstCell = sourceNotebook?.cells[0];
    
    // Check notebook metadata
    console.log('\n📋 Notebook Metadata:');
    console.log('- Original file name:', sourceNotebook?.metadata.originalFileName);
    console.log('- Importer type:', sourceNotebook?.metadata.importerType);
    console.log('- Original hash:', sourceNotebook?.metadata.originalHash);
    console.log('- Original file data present:', !!sourceNotebook?.metadata.originalFileData);
    console.log('- DOCX document stored:', !!sourceNotebook?.metadata.docxDocument);
    
    // Check cell metadata
    console.log('\n📝 First Cell Metadata:');
    const meta = firstCell?.metadata;
    console.log('- Cell ID:', meta?.cellId);
    console.log('- Paragraph ID:', meta?.paragraphId);
    console.log('- Paragraph Index:', meta?.paragraphIndex);
    console.log('- Original Content:', meta?.originalContent?.substring(0, 50));
    console.log('- Cell Label:', meta?.cellLabel);
    
    // Check DOCX structure
    console.log('\n🏗️  DOCX Structure:');
    const structure = meta?.docxStructure;
    console.log('- Paragraph Properties:', Object.keys(structure?.paragraphProperties || {}));
    console.log('- Alignment:', structure?.paragraphProperties?.alignment);
    console.log('- Style ID:', structure?.paragraphProperties?.styleId);
    
    // Check runs
    console.log('\n▶️  Runs:');
    const runs = meta?.runs || [];
    console.log(`- Number of runs: ${runs.length}`);
    runs.forEach((run: any, idx: number) => {
        console.log(`  Run ${idx}:`);
        console.log(`    - Content: "${run.content?.substring(0, 30)}..."`);
        console.log(`    - Bold: ${run.runProperties?.bold || false}`);
        console.log(`    - Italic: ${run.runProperties?.italic || false}`);
        console.log(`    - Font size: ${run.runProperties?.fontSize || 'default'}`);
    });
    
    // Check document context
    console.log('\n🌍 Document Context:');
    const context = meta?.documentContext;
    console.log('- Document ID:', context?.documentId);
    console.log('- Original Hash:', context?.originalHash);
    console.log('- File Name:', context?.fileName);
    console.log('- Importer Type:', context?.importerType);
    console.log('- Import Timestamp:', context?.importTimestamp);
    
    return result;
}
```

### Test 3: Formatted Text

**Goal**: Verify formatting is captured correctly.

**Test File**: Create a Word document with:
- Bold text
- Italic text
- Underlined text
- Different font sizes
- Different colors
- Different alignments (left, center, right)

**Code**:
```typescript
async function testFormatting(file: File) {
    console.log('\n=== Test 3: Formatted Text ===');
    
    const result = await parseFile(file);
    if (!result.success) return;
    
    const cells = result.notebookPair?.source.cells || [];
    
    cells.forEach((cell, idx) => {
        console.log(`\n📄 Cell ${idx + 1}:`);
        console.log('HTML:', cell.content?.substring(0, 200));
        
        const runs = cell.metadata?.runs || [];
        runs.forEach((run: any, runIdx: number) => {
            const props = run.runProperties;
            const formatting: string[] = [];
            
            if (props?.bold) formatting.push('bold');
            if (props?.italic) formatting.push('italic');
            if (props?.underline) formatting.push('underline');
            if (props?.strike) formatting.push('strikethrough');
            if (props?.superscript) formatting.push('superscript');
            if (props?.subscript) formatting.push('subscript');
            if (props?.fontSize) formatting.push(`size:${props.fontSize/2}pt`);
            if (props?.color) formatting.push(`color:#${props.color}`);
            
            console.log(`  Run ${runIdx}: "${run.content}" [${formatting.join(', ') || 'no formatting'}]`);
        });
    });
    
    return result;
}
```

### Test 4: Complex Document

**Goal**: Test with a realistic document.

**Test File**: Use an actual translation document with:
- Multiple paragraphs
- Headings
- Lists
- Mixed formatting

**Code**:
```typescript
async function testComplexDocument(file: File) {
    console.log('\n=== Test 4: Complex Document ===');
    
    const result = await parseFile(file);
    if (!result.success) {
        console.error('Parse failed:', result.error);
        return;
    }
    
    console.log('\n📊 Statistics:');
    console.log('- Total cells:', result.notebookPair?.source.cells.length);
    console.log('- Word count:', result.metadata?.wordCount);
    console.log('- Paragraph count:', result.metadata?.paragraphCount);
    
    // Analyze paragraph types
    const cells = result.notebookPair?.source.cells || [];
    const styleCount: Record<string, number> = {};
    const alignmentCount: Record<string, number> = {};
    
    cells.forEach(cell => {
        const props = cell.metadata?.docxStructure?.paragraphProperties;
        const style = props?.styleId || 'Normal';
        const align = props?.alignment || 'left';
        
        styleCount[style] = (styleCount[style] || 0) + 1;
        alignmentCount[align] = (alignmentCount[align] || 0) + 1;
    });
    
    console.log('\n📝 Paragraph Styles:');
    Object.entries(styleCount).forEach(([style, count]) => {
        console.log(`  ${style}: ${count}`);
    });
    
    console.log('\n⬅️  Alignments:');
    Object.entries(alignmentCount).forEach(([align, count]) => {
        console.log(`  ${align}: ${count}`);
    });
    
    // Show sample cells
    console.log('\n📄 Sample Cells:');
    cells.slice(0, 3).forEach((cell, idx) => {
        console.log(`\nCell ${idx + 1}:`);
        console.log('  Label:', cell.metadata?.cellLabel);
        console.log('  Content:', cell.metadata?.originalContent?.substring(0, 80));
        console.log('  Style:', cell.metadata?.docxStructure?.paragraphProperties?.styleId || 'Normal');
    });
    
    return result;
}
```

---

## Phase 2 Testing: Export (When Ready)

### Test 5: Round-Trip Export

**Goal**: Verify we can export translations back to DOCX.

**Code** (for future use):
```typescript
import { exportDocxWithTranslations } from './experiment/docxExporter';

async function testRoundTrip(originalFile: File) {
    console.log('\n=== Test 5: Round-Trip Export ===');
    
    // Import
    const importResult = await parseFile(originalFile);
    if (!importResult.success) return;
    
    const sourceNotebook = importResult.notebookPair?.source;
    const codexNotebook = importResult.notebookPair?.codex;
    
    // Simulate translations
    const codexCells = codexNotebook?.cells.map(cell => ({
        kind: 2,
        value: `<p>TRANSLATED: ${cell.metadata?.originalContent}</p>`,
        metadata: cell.metadata,
    }));
    
    // Export
    const exportedDocx = await exportDocxWithTranslations(
        sourceNotebook?.metadata.originalFileData,
        codexCells || [],
        sourceNotebook?.metadata.docxDocument || ''
    );
    
    console.log('Export successful!');
    console.log('Exported DOCX size:', exportedDocx.byteLength);
    
    // Save to file
    const blob = new Blob([exportedDocx], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    
    // Download (in browser)
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'translated.docx';
    a.click();
    
    console.log('Downloaded translated.docx');
}
```

---

## Running Tests

### In Browser Console

```typescript
// Load test file
const input = document.createElement('input');
input.type = 'file';
input.accept = '.docx';
input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    await testBasicImport(file);
    await testMetadata(file);
    await testFormatting(file);
};
input.click();
```

### In Test File

Create `webviews/codex-webviews/src/NewSourceUploader/importers/docx/experiment/test.ts`:

```typescript
import { validateFile, parseFile } from './index';

describe('DOCX Round-Trip Import', () => {
    it('should validate DOCX files', async () => {
        const file = new File(['...'], 'test.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
        
        const result = await validateFile(file);
        expect(result.isValid).toBe(true);
    });
    
    it('should parse simple DOCX', async () => {
        // TODO: Load test DOCX file
        const file = /* ... */;
        
        const result = await parseFile(file);
        expect(result.success).toBe(true);
        expect(result.notebookPair).toBeDefined();
    });
    
    // Add more tests...
});
```

---

## Test Files to Create

1. **simple.docx**
   - 3 paragraphs of plain text
   - No formatting

2. **formatted.docx**
   - Bold, italic, underline text
   - Different font sizes
   - Different colors

3. **headings.docx**
   - Heading 1, 2, 3
   - Normal paragraphs
   - Different alignments

4. **complex.docx**
   - Everything above
   - Lists (numbered and bulleted)
   - Multiple pages
   - Images (for future)

5. **real-translation.docx**
   - Actual translation document
   - Multiple chapters
   - Consistent formatting

---

## Debugging Tips

### Enable Debug Logging

The parser has built-in debug logging:

```typescript
import { DocxParser } from './experiment/docxParser';

const parser = new DocxParser({ /* config */ });
parser.setDebugCallback((msg) => {
    console.log(`[DEBUG] ${msg}`);
});

const doc = await parser.parseDocx(file);
```

### Inspect Parsed Structure

```typescript
const result = await parseFile(file);
const docxDoc = JSON.parse(
    result.notebookPair?.source.metadata.docxDocument || '{}'
);

console.log('Parsed DOCX structure:', docxDoc);
console.log('Paragraphs:', docxDoc.paragraphs);
console.log('First paragraph:', docxDoc.paragraphs[0]);
console.log('First run:', docxDoc.paragraphs[0]?.runs[0]);
```

### Check Original XML

```typescript
const firstCell = result.notebookPair?.source.cells[0];
const originalXml = firstCell?.metadata?.originalParagraphXml;

console.log('Original paragraph XML:');
console.log(originalXml);
```

---

## Expected Issues & Workarounds

### Issue: File won't parse
**Possible causes**:
- Corrupted DOCX file
- Non-standard OOXML structure
- Unsupported features

**Workaround**:
- Try re-saving in Word
- Check console for error messages
- Try with simpler document first

### Issue: Formatting not captured
**Possible causes**:
- Feature not implemented yet
- Complex formatting not supported

**Workaround**:
- Check which properties are extracted
- File issue for missing features

### Issue: HTML display looks wrong
**Possible causes**:
- CSS styling issues
- Complex formatting approximation

**Workaround**:
- This is normal for complex formatting
- Original formatting will be preserved in export

---

## Success Criteria

✅ **Import Working** if:
- File validates successfully
- Paragraphs are extracted
- Text content is correct
- Basic formatting is captured
- Metadata is complete
- Original file data is stored

✅ **Export Working** (Phase 2) if:
- Exported file opens in Word
- Text is replaced with translations
- All formatting is preserved
- Structure is intact
- Images/tables preserved

---

## Reporting Issues

When reporting issues, include:
1. Test file (if possible)
2. Error messages
3. Console logs
4. Expected vs. actual results
5. Browser/environment info

---

## Next Steps

After Phase 1 testing:
1. **Implement missing parser features** (images, tables, etc.)
2. **Implement exporter** (docxExporter.ts)
3. **Test round-trip** with real translations
4. **Optimize performance** for large files
5. **Integrate with Codex UI**

---

**Happy Testing! 🚀**

For questions or issues, check:
- README.md (architecture overview)
- IMPLEMENTATION_PLAN.md (detailed progress)
- Code comments (implementation details)

