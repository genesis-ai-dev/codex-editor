from lsprotocol.types import Diagnostic, DocumentDiagnosticParams, Position, Range, DiagnosticSeverity
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
            match = re.match(r'([A-Z][A-Z][A-Z]) (\d+):(\d+)', line)
            if match:
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