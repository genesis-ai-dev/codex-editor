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
        content = document.source

        verse_pattern = re.compile(r'([A-Z]{3} \d{1,3}:\d{1,3})')
        lines = content.split('\n')

        for line_num, line in enumerate(lines):
            verses = verse_pattern.split(line)
            for i in range(1, len(verses), 2):
                vref = verses[i]
                verse = verses[i + 1].strip()

                if verse:
                    verse_start = Position(line=line_num, character=line.find(verse))
                    verse_end = Position(line=line_num, character=line.find(verse) + len(verse))
                    score = int(lspw.socket_router.database.get_lad(verse, vref, 5))
                    if score is not None and score < 60:
                        range_ = Range(start=verse_start, end=verse_end)
                        diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score} {vref}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))

    return diagnostics