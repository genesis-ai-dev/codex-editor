import re
from typing import List
from lsprotocol.types import Diagnostic, DocumentDiagnosticParams, Position, Range, DiagnosticSeverity
import requests

def get_lad_score(verse, vref):
    if len(verse) < 13:
        return None
    try:
        response = requests.get(f"http://localhost:5554/line_lad?query={verse}&ref={vref}", timeout=1)
        if response.status_code == 200:
            score = response.json()['score']
            return float(score)
        else:
            return None
    except requests.exceptions.RequestException:
        return None

def lad_diagnostic(ls, params: DocumentDiagnosticParams, sf):
    """
    LAD diagnostic
    """
    diagnostics: List[Diagnostic] = []
    document_uri = params.text_document.uri
    if ".codex" in document_uri or ".scripture" in document_uri:
        document = ls.workspace.get_document(document_uri)

    lines = document.lines
    verse_pattern = re.compile(r'(\w{2,3})\s(\d+):(\d+)')
    verse = ""
    verse_start = None
    verse_end = None
    vref = ""

    for line_num, line in enumerate(lines):
        matches = verse_pattern.finditer(line)
        for match in matches:
            if verse:
                data = get_lad_score(verse, vref)
                if data:
                    score = round(data, 2)
                    if score and score < 39:
                        range_ = Range(start=verse_start, end=verse_end)
                        diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))
            
            verse = match.group()
            vref = f"{match.group(1)} {match.group(2)}:{match.group(3)}"
            verse_start = Position(line=line_num, character=match.start())
            verse_end = Position(line=line_num, character=match.end())
        
        if verse:
            verse += ' ' + line[verse_end.character:].strip()
            verse_end = Position(line=line_num, character=len(line))

    if verse:
        data = get_lad_score(verse, vref)
        if data:
            score = round(data, 2)
            if score and score < 39:
                range_ = Range(start=verse_start, end=verse_end)
                diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))

    return diagnostics