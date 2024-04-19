import wildebeest.wb_analysis as analyze
from lsprotocol.types import Diagnostic, DiagnosticOptions, DocumentDiagnosticParams, Position, Range, DiagnosticSeverity
from typing import List
import time

last_call_time = 0
last_diagnostics: List[Diagnostic] = []
def wb_line_diagnostic(lspw, params: DocumentDiagnosticParams):
    global last_call_time, last_diagnostics
    current_time = time.time()
    
    # Check if less than 2 seconds have passed since the last call
    if current_time - last_call_time < 2:
        return last_diagnostics

    diagnostics = []
    document_uri = params.text_document.uri
    if ".codex" in document_uri or ".scripture" in document_uri:
        document = lspw.server.workspace.get_document(document_uri)
    
    lines = document.lines
    for line_num, line in enumerate(lines):
        summary = analyze.process(string=line).summary_list_of_issues()
        if summary:
            for element in summary:
                _range = Range(start=Position(line=line_num, character=0),
                                    end=Position(line=line_num, character=len(line)))
                diagnostics.append(Diagnostic(range=_range, message=str(element), severity=DiagnosticSeverity.Error, source='Wildebeest'))
    
    # Update the last call time
    last_call_time = int(current_time)
    last_diagnostics = diagnostics
    return diagnostics
