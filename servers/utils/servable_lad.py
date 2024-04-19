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

        verse_start = None
        verse_content = ''

        for line_num, line in enumerate(lines):
            verses = verse_pattern.split(line)
            for i in range(1, len(verses), 2):
                vref = verses[i]
                verse = verses[i + 1].strip()

                if verse:
                    if verse_start is None:
                        verse_start = Position(line=line_num, character=line.find(verse))
                    verse_content += verse + ' '
                else:
                    if verse_start is not None:
                        verse_end = Position(line=line_num, character=line.find(verse) + len(verse))
                        score = int(lspw.socket_router.verse_lad(verse_content.strip(), vref))
                        if score is not None and score < 39:
                            range_ = Range(start=verse_start, end=verse_end)
                            diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))
                        verse_start = None
                        verse_content = ''

                # Reset verse_content when a new verse reference is encountered
                if i < len(verses) - 2:
                    verse_content = ''

        # Check if there's any remaining verse content
        if verse_start is not None:
            verse_end = Position(line=len(lines) - 1, character=len(lines[-1]))
            score = int(lspw.socket_router.verse_lad(verse_content.strip(), vref))
            if score is not None and score < 39:
                range_ = Range(start=verse_start, end=verse_end)
                diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))

    return diagnostics