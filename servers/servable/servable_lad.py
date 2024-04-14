"""
LAD
"""
import requests
from typing import List
from lsprotocol.types import Diagnostic, DocumentDiagnosticParams, Position, Range, DiagnosticSeverity
import math

last_diagnostics: List[Diagnostic] = []

def get_lad_score(line):
    try:
        response = requests.get("http://localhost:5554/line_lad?query="+line, timeout=1)
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
    for line_num, line in enumerate(lines):
        if len(line) > 12:
            data = get_lad_score(line)
            if data:
                score = round(data, 2)
                if score and score < 39:
                    range_ = Range(start=Position(line=line_num, character=0),
                                end=Position(line=line_num, character=len(line)))
                    diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))
    return diagnostics
