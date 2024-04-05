"""
LAD
"""
import requests
from typing import List
from lsprotocol.types import Diagnostic, DocumentDiagnosticParams, Position, Range, DiagnosticSeverity

last_diagnostics: List[Diagnostic] = []

def get_lad_score(line):
    try:
        response = requests.get("http://localhost:5554/line_lad?query="+line, timeout=2)
        if response.status_code == 200:
            score = response.json()['score']
            return float(score)
        else:
            return 0
    except requests.exceptions.RequestException:
        return 0

def lad_diagnostic(ls, params: DocumentDiagnosticParams, sf):
    """
    LAD diagnostic
    """    

    diagnostics = []
    document_uri = params.text_document.uri
    if ".codex" in document_uri or ".scripture" in document_uri:
        document = ls.workspace.get_document(document_uri)
    
    lines = document.lines
    for line_num, line in enumerate(lines):
        score = get_lad_score(line)
        if score < 6 and len(line) > 11:
            range_ = Range(start=Position(line=line_num, character=0),
                                end=Position(line=line_num, character=len(line)))
            diagnostics.append(Diagnostic(range=range_, message=f"Low LAD: {score}.", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))
        # Update the last call time
    return diagnostics