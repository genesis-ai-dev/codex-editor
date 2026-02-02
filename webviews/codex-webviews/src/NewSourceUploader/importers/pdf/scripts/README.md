# PDF Conversion Scripts

These scripts handle PDF↔DOCX conversion with a focus on preserving document formatting, layout, images, and structure.

## Overview

Both scripts use a **hybrid approach** that tries multiple conversion methods in order of quality/availability:

### PDF to DOCX (`pdf_to_docx.py`)
1. **LibreOffice headless** (best quality, free)
2. **pdf2docx** (good for most PDFs)
3. **Rich text extraction** (fallback when others fail)

### DOCX to PDF (`docx_to_pdf.py`)
1. **LibreOffice headless** (free, no MS Office needed)
2. **docx2pdf** (requires Microsoft Word)

## Installation

### Required (Basic functionality)
```bash
pip install PyMuPDF python-docx Pillow
```

### Recommended (Better quality)
```bash
pip install pdf2docx docx2pdf
```

### Highly Recommended (Best quality - FREE)

**LibreOffice** provides the best conversion quality and is completely free:

- **Windows**: Download from https://www.libreoffice.org/download/download/
- **macOS**: `brew install --cask libreoffice`
- **Linux**: `sudo apt install libreoffice` or `sudo dnf install libreoffice`

## Quality Comparison

| Method | Layout | Fonts | Images | Tables | Page Breaks | Headers/Footers |
|--------|--------|-------|--------|--------|-------------|-----------------|
| LibreOffice | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| pdf2docx | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| Rich text extraction | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ❌ |
| docx2pdf (MS Word) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

## Usage

### Command Line
```bash
# PDF to DOCX
python pdf_to_docx.py input.pdf output.docx

# DOCX to PDF
python docx_to_pdf.py input.docx output.pdf
```

### From Python
```python
import json
from pdf_to_docx import convert_pdf_to_docx
from docx_to_pdf import convert_docx_to_pdf

# PDF to DOCX
result = convert_pdf_to_docx("input.pdf", "output.docx")
if result["success"]:
    print(f"Converted using: {result['method']}")
else:
    print(f"Error: {result['error']}")

# DOCX to PDF
result = convert_docx_to_pdf("input.docx", "output.pdf")
if result["success"]:
    print(f"Converted using: {result['method']}")
else:
    print(f"Error: {result['error']}")
```

## What Gets Preserved

### PDF → DOCX
- ✅ Text content and flow
- ✅ Font names, sizes, colors
- ✅ Bold, italic, underline
- ✅ Images (with CMYK→RGB conversion)
- ✅ Tables (when using LibreOffice/pdf2docx)
- ✅ Page breaks
- ✅ Line breaks within paragraphs
- ✅ Multi-column layouts (LibreOffice)
- ✅ Headers/footers (LibreOffice)
- ⚠️ Complex vector graphics may be rasterized
- ⚠️ Form fields may not be editable

### DOCX → PDF
- ✅ All text formatting
- ✅ Images
- ✅ Tables
- ✅ Page layout
- ✅ Headers/footers
- ✅ Hyperlinks

## Troubleshooting

### "LibreOffice not found"
Install LibreOffice from https://www.libreoffice.org/

### "docx2pdf requires Microsoft Word"
Either:
1. Install LibreOffice (free alternative)
2. Install Microsoft Word (Windows/macOS only)

### CMYK image errors
The scripts automatically handle CMYK images by:
1. Converting CMYK to RGB using PIL
2. Saving as PNG for compatibility

### Large file timeouts
Increase the timeout in the Python scripts if working with very large PDFs (default is 10 minutes for PDF→DOCX).

## Dependencies

| Package | Purpose | Required |
|---------|---------|----------|
| PyMuPDF | PDF parsing and text extraction | Yes |
| python-docx | DOCX creation | Yes |
| Pillow | Image handling (CMYK conversion) | Yes |
| pdf2docx | Direct PDF→DOCX conversion | Recommended |
| docx2pdf | DOCX→PDF via MS Word | Optional |
| LibreOffice | High-quality conversion | **Highly Recommended** |
