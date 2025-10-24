# OBS Round-Trip - Quick Usage Guide

## 🎯 How to Use the OBS Round-Trip Importer & Exporter

### Step 1: Import Your OBS Markdown Files

1. **Open the Import View**
   - Command Palette → "Import New Source"
   - Or click "Add Files" in the Navigation view

2. **Select "Bible Stories"**
   - Look for "Bible Stories" in the importers list
   - Description: "Open Bible Stories format **with round-trip export support**"
   - Tags: "Specialized", "Bible", "Stories", "Round-trip"

3. **Choose Your Import Method**

   **Option A: Single File Upload**
   - Upload individual OBS markdown files (e.g., `01.md`, `02.md`)
   - Great for translating specific stories

   **Option B: ZIP Archive**
   - Upload a ZIP containing multiple OBS markdown files
   - Automatically extracts and processes all stories

   **Option C: Repository Download** (Recommended)
   - Downloads all 50 OBS stories from unfoldingWord
   - Includes images from CDN
   - Creates 50 notebook pairs automatically

4. **Import Completes**
   - Creates source and codex notebook pairs
   - Preserves original file in `.project/attachments/originals/`
   - Ready to translate!

---

### Step 2: Translate Your Content

**Understanding the Cell Structure:**
- **Text cells** (blue icon): Editable story text
- **Image cells** (image icon): Preserved automatically

**Translation Workflow:**
1. Open the codex (target) notebook
2. Each text segment is a separate cell
3. Translate the text (images stay in place)
4. Images are preserved automatically

**Example:**
```
Cell 1 (Image): [Preserved from source]
Cell 2 (Text):  "In the beginning..." → [Your translation]
Cell 3 (Image): [Preserved from source]
Cell 4 (Text):  "God created..." → [Your translation]
```

---

### Step 3: Export with Translations

#### Method 1: Rebuild Export (Recommended) ✨

1. **Open Export View**
   - Command Palette → "Export Project"
   - Or click "Export Files" button

2. **Select "Rebuild Export" Format**
   - Has "Refresh" icon
   - Description: "Intelligently detects file type..."
   - Shows OBS badge (blue)

3. **Choose Your OBS Files**
   - Select one or more `.codex` files
   - Can mix OBS with DOCX, PDF, RTF, etc.
   - System automatically routes each to correct exporter

4. **Export!**
   - Creates: `storyName_YYYY-MM-DD_translated.md`
   - Preserves markdown structure
   - Includes images and references
   - Opens perfectly in any markdown editor

#### Method 2: Direct OBS Export (Future)

Currently, OBS exports through "Rebuild Export". Future versions may add a dedicated "OBS Markdown" export option.

---

## 📁 Output Format

### Exported File Structure

**Filename:** `01_2024-10-22_translated.md`

**Content:**
```markdown
# The Creation

![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)

Your translated text for the first segment goes here.

![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg)

Your translated text for the second segment goes here.

_A Bible story from: Genesis 1-2_
```

---

## ✅ Verification Checklist

After export, verify:
- [ ] File has correct story title
- [ ] Images are referenced (URLs intact)
- [ ] Translated text appears in correct segments
- [ ] Source reference at the end
- [ ] No HTML tags or formatting artifacts
- [ ] Opens correctly in markdown viewer

---

## 🔧 Troubleshooting

### Problem: Can't Find OBS Importer

**Solution:**
- Look in "Specialized" section (not "Essential")
- Search for "Bible Stories" or "OBS"
- Should have "Round-trip" tag

### Problem: "Not imported with OBS importer" Error

**Cause:** File was imported with old version or different importer

**Solution:**
1. Delete the current notebook
2. Re-import using updated OBS importer
3. Re-translate content

### Problem: Missing Images in Export

**Check:**
- Images should be in original markdown as `![alt](url)`
- Image cells are preserved (not deleted)
- Network access for CDN images

**Solution:**
- Images are referenced by URL, not embedded
- Ensure original markdown had proper image links

### Problem: Translation Not Appearing

**Check:**
- Translated **codex** notebook (not source)
- Only **text cells** are exported (not image cells)
- HTML is stripped automatically

**Solution:**
- Make sure you edited text cells in codex notebook
- Images are preserved but not editable

---

## 🎓 Tips & Best Practices

### 1. **Use Repository Download**
- Gets all 50 stories at once
- Ensures consistent image URLs
- CDN-hosted images (fast, reliable)

### 2. **Organize Your Work**
- Work on stories in order (01, 02, 03...)
- Use consistent naming conventions
- Export regularly to save progress

### 3. **Keep Originals**
- Original files are in `.project/attachments/originals/`
- Never deleted by system
- Can re-import if needed

### 4. **Batch Export**
- Select multiple OBS files at once
- Use "Rebuild Export" for mixed file types
- Saves time with large projects

### 5. **Verify Structure**
- Check exported markdown in text editor
- Ensure images load (requires internet)
- Test in markdown preview

---

## 📊 Comparison: Import Methods

| Method | Files | Time | Images | Use Case |
|--------|-------|------|--------|----------|
| **Single Upload** | 1 | Instant | Manual | One story |
| **ZIP Upload** | Many | Fast | Local/Remote | Custom collection |
| **Repository** | 50 | 2-3 min | CDN | Complete OBS |

**Recommendation:** Use **Repository Download** for complete projects, **Single Upload** for individual stories.

---

## 🔄 Round-Trip Workflow

```
Original File (01.md)
    ↓
[Import] → Bible Stories Importer
    ↓
Source Notebook (read-only reference)
Codex Notebook (editable translation)
    ↓
[Edit] → Translate in Codex
    ↓
[Export] → Rebuild Export
    ↓
Translated File (01_2024-10-22_translated.md)
```

**Key Point:** Original file is preserved! You can always re-import or compare.

---

## 🌍 Multi-Language Projects

**Scenario:** Translating OBS into multiple languages

**Workflow:**
1. Import once (creates source + codex)
2. Duplicate codex notebook for each language
3. Rename: `01-spanish.codex`, `01-french.codex`, etc.
4. Translate each
5. Export all at once (Rebuild Export detects all)

**Result:**
```
01_2024-10-22_spanish_translated.md
01_2024-10-22_french_translated.md
01_2024-10-22_german_translated.md
```

---

## 📚 Related Resources

- **OBS Website:** https://openbiblestories.org/
- **Translation Tools:** https://unfoldingword.org/tools/
- **OBS Repository:** https://git.door43.org/unfoldingWord/en_obs
- **Technical Docs:** See `OBS_ROUNDTRIP_IMPLEMENTATION.md`

---

## ❓ FAQ

**Q: Can I edit images?**
A: No, images are preserved as-is. You can change image URLs in exported markdown.

**Q: Does this work offline?**
A: Import works offline if you have local files. Repository download requires internet. Images are CDN-hosted (require internet to display).

**Q: Can I export to formats other than markdown?**
A: Currently only markdown. Future versions may support OBS JSON, HTML, etc.

**Q: What about verse references?**
A: OBS doesn't use verse references, only story numbers and segments.

**Q: Can I combine multiple stories into one file?**
A: Not currently. Each story exports to its own markdown file.

**Q: Is formatting preserved?**
A: OBS markdown is simple (mostly plain text). Bold/italic preserved if present.

---

✨ **Happy Translating!** You're now ready to use OBS round-trip functionality.

For technical details, see `OBS_ROUNDTRIP_IMPLEMENTATION.md`.

