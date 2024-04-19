import re
from typing import List, Union
from lsprotocol.types import Diagnostic, DocumentDiagnosticParams, Position, Range, DiagnosticSeverity


def lad_diagnostic(lspw, params: DocumentDiagnosticParams):
    """
    LAD diagnostic
    """
    diagnostics: List[Diagnostic] = []
    document_uri = params.text_document.uri
    if ".codex" in document_uri or ".scripture" in document_uri:
        document = lspw.server.workspace.get_document(document_uri)

    lines = document.lines
    verse_pattern = re.compile(r'(\w{2,3})\s(\d+):(\d+)')
    verse = ""
    verse_start: Union[None, Position] = None
    verse_end: Union[None, Position] = None
    vref = ""

    for line_num, line in enumerate(lines):
        matches = verse_pattern.finditer(line)
        for match in matches:
            if verse:
                if len(verse) < 15:
                    continue
                data = lspw.socket_router.verse_lad(verse, vref)
                
                if data:
                    score = round(data, 2)
                    if score and score < 39 and isinstance(verse_start, Position) and isinstance(verse_end, Position):
                        range_ = Range(start=verse_start, end=verse_end)
                        diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))
            
            verse = match.group()
            vref = f"{match.group(1)} {match.group(2)}:{match.group(3)}"
            verse_start = Position(line=line_num, character=match.start())
            verse_end = Position(line=line_num, character=match.end())
        
        if verse:
            verse += ' ' + line[verse_end.character:].strip()
            verse_end = Position(line=line_num, character=len(line))

    if verse and len(verse) > 15:
        data = lspw.socket_router.verse_lad(verse, vref)
        if data:
            score = round(data, 2)
            if score and score < 39:
                range_ = Range(start=verse_start, end=verse_end)
                diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))

    return diagnostics