# DOCX Round-Trip - Quick Usage Guide

## 🎯 How to Use the Round-Trip Importer & Exporter

### Step 1: Import Your DOCX File (NEW Way)

1. **Open the Import View**
   - Command Palette → "Import New Source"
   - Or click "Add Files" in the Navigation view

2. **Look for "Word Documents (Round-trip)"**
   - You'll now see TWO Word import options:
     - ✅ **"Word Documents (Round-trip)"** ← Use this one!
     - ❌ "Word Documents" (old mammoth.js importer)
   
3. **Select "Word Documents (Round-trip)"**
   - Has tags: "Experimental" and "Round-trip"
   - Description: "Microsoft Word files with complete structure preservation for export"

4. **Upload Your DOCX File**
   - The importer will extract complete structure
   - Creates cells with `importerType: 'docx-roundtrip'` in metadata
   - Preserves original file in `.project/attachments/originals/`

### Step 2: Translate Your Content

- Edit cells normally in Codex
- All formatting information is stored in metadata
- You won't see formatting in the editor (it's preserved behind the scenes)

### Step 3: Export with Translations

1. **Open Export View**
   - Command Palette → "Export Project"
   - Or click "Export Files" button

2. **Select "DOCX Round-trip" Format**
   - It's in the Translation Export Options section
   - Has "Microsoft Word" and "Experimental" tags

3. **Choose Files to Export**
   - Select your `.codex` files
   - Must be files imported with "Word Documents (Round-trip)" importer

4. **Export!**
   - Creates: `yourfile_TIMESTAMP_translated.docx`
   - Opens perfectly in Microsoft Word with all formatting! 🎉

---

## ⚠️ Important: Why You Got the Error

The error "Skipping - not imported with DOCX round-trip importer" means:

**Your file was imported with the OLD importer**, which doesn't preserve structure.

### Old Importer (mammoth.js):
- ❌ Name: "Word Documents"
- ❌ Converts to HTML (loses structure)
- ❌ `importerType: 'docx'`
- ❌ Cannot export back to DOCX

### New Importer (Round-trip):
- ✅ Name: "Word Documents (Round-trip)"
- ✅ Preserves complete OOXML structure
- ✅ `importerType: 'docx-roundtrip'`
- ✅ Perfect round-trip export

---

## 🔄 How to Fix Your Current File

You need to **re-import** using the new importer:

### Option 1: Re-import from Original File

1. Find your original DOCX file
2. Use "Word Documents (Round-trip)" importer
3. Translate the cells
4. Export using "DOCX Round-trip"

### Option 2: Check Original File Location

If you still have the original:

1. Look in `.project/attachments/originals/`
2. Find your original DOCX file
3. Re-import using round-trip importer

---

## 🎨 Visual Comparison

### In Import View:

```
Available Importers:
┌─────────────────────────────────────────────┐
│ Word Documents                              │  ← OLD (Don't use for export)
│ Microsoft Word files with images            │
│ Tags: Essential, Documents, Microsoft       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Word Documents (Round-trip)                 │  ← NEW (Use this!)
│ Microsoft Word files with complete          │
│ structure preservation for export           │
│ Tags: Essential, Documents, Microsoft,      │
│       Experimental, Round-trip              │
└─────────────────────────────────────────────┘
```

### In Export View:

```
Translation Export Options:
┌─────────────────────────────────────────────┐
│ IDML Round-trip                             │
│ InDesign                                    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ DOCX Round-trip                             │  ← Use this!
│ Microsoft Word | Experimental               │
└─────────────────────────────────────────────┘
```

---

## 📋 Checklist for Success

- [ ] **Import**: Use "Word Documents (Round-trip)" importer
- [ ] **Verify**: Check cell metadata has `importerType: 'docx-roundtrip'`
- [ ] **Translate**: Edit cells in Codex
- [ ] **Export**: Use "DOCX Round-trip" format
- [ ] **Open**: Verify in Microsoft Word

---

## 🐛 Troubleshooting

### "Skipping - not imported with round-trip importer"
**Problem**: File imported with old importer
**Solution**: Re-import with "Word Documents (Round-trip)"

### "No DOCX document structure found in metadata"
**Problem**: Metadata missing or corrupted
**Solution**: Re-import the source file

### "Original file not found"
**Problem**: Original DOCX missing from attachments
**Solution**: Check `.project/attachments/originals/` folder

### Don't see "Word Documents (Round-trip)" option
**Problem**: Need to reload VS Code
**Solution**: 
1. Reload Window (Command Palette → "Developer: Reload Window")
2. Or restart VS Code

---

## 💡 Tips

1. **Always use Round-trip importer for files you want to export**
   - Old importer is still useful for display-only imports

2. **The "Experimental" tag**
   - Means the feature is new and being tested
   - Already works well for basic documents
   - Advanced features (images, tables) coming in Phase 3

3. **File naming**
   - Exported files get timestamp: `doc_2025-10-15T14-30-00_translated.docx`
   - Original file is preserved unchanged

4. **Multiple files**
   - You can import and export multiple DOCX files at once
   - Each maintains its own structure

---

## 📚 Related Documentation

- **README.md** - Complete architecture
- **TESTING_GUIDE.md** - Testing instructions
- **IMPLEMENTATION_PLAN.md** - Development roadmap
- **EXPORT_INTEGRATION.md** - Export system details

---

## 🚀 Quick Start Example

```typescript
// 1. Import (use round-trip importer in UI)
//    → Creates file with importerType: 'docx-roundtrip'

// 2. Translate cells in Codex
//    → Edit cell contents

// 3. Export (use DOCX Round-trip in UI)
//    → Creates translated.docx with all formatting

// 4. Open in Word
//    → Perfect formatting! ✨
```

---

**Need Help?** Check the other documentation files in this folder or file an issue!

