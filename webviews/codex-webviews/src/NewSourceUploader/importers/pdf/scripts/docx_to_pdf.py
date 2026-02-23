#!/usr/bin/env python3
"""
DOCX to PDF Converter - Hybrid Approach

Tries multiple conversion methods in order of availability:
1. LibreOffice headless (free, cross-platform, no MS Office required)
2. docx2pdf (requires Microsoft Word on Windows/macOS)

This ensures the conversion works on systems without Microsoft Office.
"""

import sys
import os
import json
import base64
import tempfile
import shutil
import subprocess
from pathlib import Path


def find_libreoffice() -> str | None:
    """Find LibreOffice executable on the system."""
    if sys.platform == 'win32':
        possible_paths = [
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            os.path.expandvars(r"%PROGRAMFILES%\LibreOffice\program\soffice.exe"),
            os.path.expandvars(r"%PROGRAMFILES(X86)%\LibreOffice\program\soffice.exe"),
        ]
        for path in possible_paths:
            if os.path.exists(path):
                return path
        try:
            result = subprocess.run(['where', 'soffice'], capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip().split('\n')[0]
        except:
            pass
    else:
        possible_paths = [
            '/usr/bin/soffice',
            '/usr/bin/libreoffice',
            '/Applications/LibreOffice.app/Contents/MacOS/soffice',
            '/opt/libreoffice/program/soffice',
        ]
        for path in possible_paths:
            if os.path.exists(path):
                return path
        try:
            result = subprocess.run(['which', 'soffice'], capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except:
            pass
        try:
            result = subprocess.run(['which', 'libreoffice'], capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except:
            pass
    
    return None


def convert_with_libreoffice(docx_path: str, output_path: str) -> dict:
    """
    Convert DOCX to PDF using LibreOffice headless mode.
    This is the preferred method as it doesn't require Microsoft Office.
    """
    soffice = find_libreoffice()
    if not soffice:
        return {
            "success": False,
            "error": "LibreOffice not found",
            "method": "libreoffice"
        }
    
    try:
        print(json.dumps({"info": "Converting with LibreOffice..."}), file=sys.stderr)
        
        # Create temp directory for output
        temp_dir = tempfile.mkdtemp(prefix="lo_pdf_")
        
        try:
            # LibreOffice command for DOCX to PDF conversion
            cmd = [
                soffice,
                "--headless",
                "--convert-to", "pdf",
                "--outdir", temp_dir,
                docx_path
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            if result.returncode != 0:
                error_msg = result.stderr or result.stdout or "Unknown error"
                return {
                    "success": False,
                    "error": f"LibreOffice conversion failed: {error_msg}",
                    "method": "libreoffice"
                }
            
            # Find the output file
            docx_basename = os.path.splitext(os.path.basename(docx_path))[0]
            temp_output = os.path.join(temp_dir, f"{docx_basename}.pdf")
            
            if not os.path.exists(temp_output):
                # Try finding any PDF in the output dir
                for f in os.listdir(temp_dir):
                    if f.endswith('.pdf'):
                        temp_output = os.path.join(temp_dir, f)
                        break
            
            if not os.path.exists(temp_output):
                return {
                    "success": False,
                    "error": "LibreOffice did not create PDF output",
                    "method": "libreoffice"
                }
            
            # Verify file has content
            file_size = os.path.getsize(temp_output)
            if file_size == 0:
                return {
                    "success": False,
                    "error": "LibreOffice created empty PDF",
                    "method": "libreoffice"
                }
            
            # Move to final location
            shutil.move(temp_output, output_path)
            
            # Read and encode PDF
            with open(output_path, 'rb') as f:
                pdf_bytes = f.read()
            
            pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
            
            print(json.dumps({"info": f"LibreOffice PDF conversion successful ({file_size} bytes)"}), file=sys.stderr)
            
            return {
                "success": True,
                "pdfBase64": pdf_base64,
                "outputPath": output_path,
                "method": "libreoffice"
            }
            
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
            
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": "LibreOffice conversion timed out",
            "method": "libreoffice"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"LibreOffice error: {str(e)}",
            "method": "libreoffice"
        }


def convert_with_docx2pdf(docx_path: str, output_path: str) -> dict:
    """
    Convert DOCX to PDF using docx2pdf library.
    Requires Microsoft Word on Windows/macOS.
    """
    try:
        from docx2pdf import convert
    except ImportError:
        return {
            "success": False,
            "error": "docx2pdf not installed. Install with: pip install docx2pdf",
            "method": "docx2pdf"
        }
    
    try:
        print(json.dumps({"info": "Converting with docx2pdf (requires MS Word)..."}), file=sys.stderr)
        
        convert(docx_path, output_path)
        
        if not os.path.exists(output_path):
            return {
                "success": False,
                "error": "docx2pdf did not create PDF. Is Microsoft Word installed?",
                "method": "docx2pdf"
            }
        
        file_size = os.path.getsize(output_path)
        if file_size == 0:
            return {
                "success": False,
                "error": "docx2pdf created empty PDF",
                "method": "docx2pdf"
            }
        
        # Read and encode PDF
        with open(output_path, 'rb') as f:
            pdf_bytes = f.read()
        
        pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
        
        print(json.dumps({"info": f"docx2pdf conversion successful ({file_size} bytes)"}), file=sys.stderr)
        
        return {
            "success": True,
            "pdfBase64": pdf_base64,
            "outputPath": output_path,
            "method": "docx2pdf"
        }
        
    except Exception as e:
        error_msg = str(e) if str(e) else repr(e)
        
        # Provide helpful error messages
        if any(x in error_msg for x in ["COM", "Word", "win32com", "Microsoft"]):
            error_msg += ". docx2pdf requires Microsoft Word to be installed."
        
        return {
            "success": False,
            "error": error_msg,
            "method": "docx2pdf"
        }


def convert_docx_to_pdf(docx_path: str, output_path: str) -> dict:
    """
    Convert DOCX to PDF using the best available method.
    
    Tries methods in order:
    1. LibreOffice headless (preferred, free, no MS Office needed)
    2. docx2pdf (requires Microsoft Word)
    """
    print(json.dumps({"info": "Starting DOCX to PDF conversion..."}), file=sys.stderr)
    
    # Verify input file exists
    if not os.path.exists(docx_path):
        return {
            "success": False,
            "error": f"Input DOCX file not found: {docx_path}"
        }
    
    # Ensure output directory exists
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    methods_tried = []
    
    # Method 1: Try LibreOffice (preferred, free)
    print(json.dumps({"info": "Attempting Method 1: LibreOffice..."}), file=sys.stderr)
    result = convert_with_libreoffice(docx_path, output_path)
    methods_tried.append(f"LibreOffice: {result.get('error', 'success') if not result['success'] else 'success'}")
    
    if result["success"]:
        print(json.dumps({"info": "✓ LibreOffice PDF conversion successful"}), file=sys.stderr)
        return result
    else:
        print(json.dumps({"warning": f"LibreOffice failed: {result.get('error', 'unknown')}"}), file=sys.stderr)
    
    # Method 2: Try docx2pdf (requires MS Word)
    print(json.dumps({"info": "Attempting Method 2: docx2pdf..."}), file=sys.stderr)
    result = convert_with_docx2pdf(docx_path, output_path)
    methods_tried.append(f"docx2pdf: {result.get('error', 'success') if not result['success'] else 'success'}")
    
    if result["success"]:
        print(json.dumps({"info": "✓ docx2pdf conversion successful"}), file=sys.stderr)
        return result
    else:
        print(json.dumps({"warning": f"docx2pdf failed: {result.get('error', 'unknown')}"}), file=sys.stderr)
    
    # All methods failed
    return {
        "success": False,
        "error": f"All conversion methods failed. Install LibreOffice (free) from https://www.libreoffice.org/ or Microsoft Word. Tried: {'; '.join(methods_tried)}"
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({
            "success": False,
            "error": "Usage: docx_to_pdf.py <docx_file_path> <output_pdf_path>"
        }))
        sys.exit(1)
    
    docx_path = sys.argv[1]
    output_path = sys.argv[2]
    
    result = convert_docx_to_pdf(docx_path, output_path)
    print(json.dumps(result))
