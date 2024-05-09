import re
from typing import List
from lsprotocol.types import Diagnostic, DocumentDiagnosticParams, Position, Range, DiagnosticSeverity

def lad_diagnostic(lspw, params: DocumentDiagnosticParams) -> List[Diagnostic]:
    """
    Analyzes a document to identify and report diagnostics related to linguistic anomaly detection (LAD).

    This function searches for verses within a document and evaluates them using a LAD score. If the score
    is below a certain threshold, it generates a diagnostic warning for that verse.

    Args:
        lspw: The language server protocol wrapper instance, providing access to server operations and data.
        params (DocumentDiagnosticParams): Parameters containing the URI of the document to be analyzed.

    Returns:
        List[Diagnostic]: A list of Diagnostic objects representing the identified language anomalies.
    """
    diagnostics: List[Diagnostic] = []
    document_uri = params.text_document.uri
    # Check if the document is of a type that should be analyzed
    if ".codex" in document_uri or ".scripture" in document_uri:
        document = lspw.server.workspace.get_document(document_uri)
        content = document.source

        # Compile a regex pattern to identify verse references
        verse_pattern = re.compile(r'([A-Z]{3} \d{1,3}:\d{1,3})')
        lines = content.split('\n')

        for line_num, line in enumerate(lines):
            verses = verse_pattern.split(line)
            for i in range(1, len(verses), 2):
                vref = verses[i]
                verse = verses[i + 1].strip()

                if verse:
                    # Calculate the start and end positions of the verse in the line
                    verse_start = Position(line=line_num, character=line.find(verse))
                    verse_end = Position(line=line_num, character=line.find(verse) + len(verse))
                    # Retrieve the LAD score for the verse
                    score = int(lspw.socket_router.database.get_lad(verse, vref, 5))
                    # Generate a diagnostic if the score is below the threshold
                    if score is not None and score < 60:
                        range_ = Range(start=verse_start, end=verse_end)
                        diagnostics.append(Diagnostic(range=range_, message=f"Source and target have low overlap: {score} {vref}", severity=DiagnosticSeverity.Warning, source='Anomaly Detection'))

    return diagnostics