from lsprotocol.types import *
from pygls.server import LanguageServer
import re
from enum import Enum
from typing import List


class VrefMessages(Enum):
    VERSE_SHOULD_COME_BEFORE = "The verse {verse} should come before {next}"
    VERSE_MISSING = "The verse {missing_verse} is missing after {after}"
    INCORRECT_BOOK = "The reference {reference} is not correct for book {book}"
    VERSE_DOES_NOT_EXIST = "The verse {verse} does not exist"
    FIRST_VERSE_MISSING = "The first verse is missing"
    DUPLICATE_VERSE = "The verse {verse} is duplicated"


class ServableVrefs:
    def __init__(self, sf):
        self.ls = sf

    def validate_verses(self, lines) -> List[Diagnostic]:
        diagnostics = []
        expected_book = None
        last_verse = None
        seen_verses = set()
        for i, line in enumerate(lines):
            matches = re.finditer(r'(\d*[A-Z]+) (\d+):(\d+)', line)
            for match in matches:
                book, chapter, verse = match.groups()
                verse_ref = f"{book} {chapter}:{verse}"
                if verse_ref in seen_verses:
                    diagnostics.append(self.create_diagnostic(i, line, match, VrefMessages.DUPLICATE_VERSE.value.format(verse=verse_ref)))
                    continue
                else:
                    seen_verses.add(verse_ref)

                if expected_book is None:
                    expected_book = book
                elif expected_book != book:
                    diagnostics.append(self.create_diagnostic(i, line, match, VrefMessages.INCORRECT_BOOK.value.format(reference=verse_ref, book=expected_book)))
                    continue

                if last_verse:
                    last_chapter, last_verse_num = map(int, last_verse.split(':'))
                    current_chapter, current_verse_num = int(chapter), int(verse)
                    if current_chapter < last_chapter or (current_chapter == last_chapter and current_verse_num < last_verse_num):
                        diagnostics.append(self.create_diagnostic(i, line, match, VrefMessages.VERSE_SHOULD_COME_BEFORE.value.format(verse=verse_ref, next=last_verse)))
                    elif current_chapter == last_chapter and current_verse_num != last_verse_num + 1:
                        for missing_verse_num in range(last_verse_num + 1, current_verse_num):
                            missing_verse = f"{book} {last_chapter}:{missing_verse_num}"
                            diagnostics.append(self.create_diagnostic(i, line, match, VrefMessages.VERSE_MISSING.value.format(missing_verse=missing_verse, after=last_verse)))

                last_verse = f"{chapter}:{verse}"
        return diagnostics

    def create_diagnostic(self, line_num: int, line: str, match, message: str) -> Diagnostic:
        start_char = line.find(match.group(0))
        end_char = start_char + len(match.group(0))
        diagnostic_range = Range(start=Position(line=line_num, character=start_char),
                                 end=Position(line=line_num, character=end_char))
        return Diagnostic(range=diagnostic_range, message=message, severity=DiagnosticSeverity.Warning, source='Vrefs')

    def vref_diagnostics(self, ls: LanguageServer, params: DocumentDiagnosticParams, sf) -> List[Diagnostic]:
        document_uri = params.text_document.uri
        document = self.ls.server.workspace.get_document(document_uri)
        lines = document.lines
        return self.validate_verses(lines)
    
    def vref_code_actions(self, ls: LanguageServer, params: CodeActionParams, range: Range, sf) -> List[CodeAction]:
        """
        Generate code actions for verse validation corrections in a document.

        Args:
            ls (LanguageServer): The instance of the language server.
            params (CodeActionParams): The parameters for the code action request.

        Returns:
            List[CodeAction]: A list of CodeAction objects representing verse validation correction actions.
        """
        document_uri = params.text_document.uri
        diagnostics = params.context.diagnostics

        actions = []

        for diagnostic in diagnostics:
            if 'duplicated' in diagnostic.message:
                # Extract the verse reference from the diagnostic message
                verse = diagnostic.message.split(" ")[-1]
                action = CodeAction(
                    title=f"Remove duplicate verse {verse}",
                    kind=CodeActionKind.QuickFix,
                    diagnostics=[diagnostic],
                    edit=WorkspaceEdit(changes={
                        document_uri: [TextEdit(range=diagnostic.range, new_text="")]
                    })
                )
                actions.append(action)

            elif "missing" in diagnostic.message:
                # Extract the missing verse and the verse after which it is missing from the diagnostic message
                missing_verse = " ".join(diagnostic.message.split(" ")[2:4])
                # Determine the position to insert the missing verse above the current line
                insert_position = diagnostic.range.start
                # Create a new range starting at the beginning of the line
                insert_range = Range(start=Position(line=insert_position.line, character=0), end=Position(line=insert_position.line, character=0))
                action = CodeAction(
                    title=f"Add missing verse {missing_verse}",
                    kind=CodeActionKind.QuickFix,
                    diagnostics=[diagnostic],
                    edit=WorkspaceEdit(changes={
                        document_uri: [TextEdit(range=insert_range, new_text=f"{missing_verse}\n")]
                    })
                )
                actions.append(action)

            elif "is not correct for book" in diagnostic.message:
                # This case might require more complex logic to determine the correct book or offer suggestions
                # For simplicity, we'll just offer an action to remove the incorrect reference
                action = CodeAction(
                    title="Remove incorrect book reference",
                    kind=CodeActionKind.QuickFix,
                    diagnostics=[diagnostic],
                    edit=WorkspaceEdit(changes={
                        document_uri: [TextEdit(range=diagnostic.range, new_text="")]
                    })
                )
                actions.append(action)

        return actions