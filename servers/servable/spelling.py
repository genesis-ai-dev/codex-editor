from typing import List
import re
from enum import Enum
from tools.spell_check import Dictionary, SpellCheck
from tools.ls_tools import ServerFunctions
from lsprotocol.types import (DocumentDiagnosticParams, CompletionParams, 
    CodeActionParams, Range, CompletionItem, 
    TextEdit, Position, Diagnostic, CodeAction, WorkspaceEdit, CodeActionKind, Command, DiagnosticSeverity)
from pygls.server import LanguageServer

from tools.loadvrefs import get_verse_references_from_file, filter


refrences = get_verse_references_from_file('src/utils/verseRefUtils/verseData.ts')

class SPELLING_MESSAGE(Enum):
    TYPO = f"❓🔤: '{{word}}'"
    ADD_WORD = f"'{{word}}' → 📖"
    ADD_ALL_WORDS = f"Add all {{count}} 📖" # Not implemented yet
    REPLACE_WORD = f"'{{word}}' → '{{correction}}'"


class ServableSpelling:
    def __init__(self, sf: ServerFunctions):
        """
        Initialize the ServableSpelling class with server functions and a flag for relative checking.

        Args:
            sf (ServerFunctions): The server functions object that provides access to server-related utilities.
            relative_checking (bool, optional): Flag to determine if relative checking is enabled. Defaults to False.
        """
        self.dictionary: Dictionary = None
        self.spell_check: SpellCheck = None
        self.sf: ServerFunctions = sf
        self.sf.initialize_functions.append(self.initialize)

    def spell_completion(self, server: LanguageServer, params: CompletionParams, range: Range, sf: ServerFunctions) -> List:
        """
        Provide completion items for spelling corrections in a document.

        Args:
            server (LanguageServer): The instance of the language server.
            params (CompletionParams): The parameters for the completion request.
            range (Range): The range within the document where the completion is requested.
            sf (ServerFunctions): The server functions object.

        Returns:
            List: A list of CompletionItem objects representing spelling suggestions.
        """
        try:
            document_uri = params.text_document.uri
            document = server.workspace.get_document(document_uri)
            line = document.lines[params.position.line]
            word = line.strip().split(" ")[-1]
            if self.spell_check is not None:
                completions = self.spell_check.complete(word=word)
                return [CompletionItem(
                    label=word+completion,
                    text_edit=TextEdit(range=range, new_text=completion),
                    ) for completion in completions]
            else:
                return []
        except IndexError:
            return []

    def spell_diagnostic(self, ls: LanguageServer, params: DocumentDiagnosticParams, sf: ServerFunctions) -> List[Diagnostic]:
        """
        Generate diagnostics for spelling errors in a document.

        Args:
            ls (LanguageServer): The instance of the language server.
            params (DocumentDiagnosticParams): The parameters for the diagnostic request.
            sf (ServerFunctions): The server functions object.

        Returns:
            List[Diagnostic]: A list of Diagnostic objects representing spelling errors.
        """
        diagnostics: List[Diagnostic] = []
        document_uri = params.text_document.uri
        #if ".codex" in document_uri or ".scripture" in document_uri:
        document = ls.workspace.get_document(document_uri)
        lines = document.lines
        for line_num, line in enumerate(lines):
            if len(line) % 5 == 0:
                line = filter(line, refrences)
            words = line.split(" ")
            edit_window = 0

            for word in words:
                if self.spell_check and self.spell_check.is_correction_needed(word):
                    start_char = edit_window
                    end_char = start_char + len(word)
                    
                    range = Range(start=Position(line=line_num, character=start_char),
                                end=Position(line=line_num, character=end_char))
                    
                    tokenized_word = self.spell_check.dictionary.tokenizer.tokenize(word)
                    detokenized_word = self.spell_check.dictionary.tokenizer.tokenizer.detokenize(tokenized_word, join="--")
                    formatted_message = SPELLING_MESSAGE.TYPO.value.format(word=detokenized_word)

                    diagnostics.append(Diagnostic(range=range, message=formatted_message, severity=DiagnosticSeverity.Information, source='Spell-Check', data={"color": "rgba(255, 0, 0, .5})"}))
                # Add one if the next character is whitespace
                if edit_window + len(word) < len(line) and line[edit_window + len(word)] == ' ':
                    edit_window += len(word) + 1
                else:
                    edit_window += len(word)
        return diagnostics 
    
    def spell_action(self, ls: LanguageServer, params: CodeActionParams, range: Range, sf: ServerFunctions) -> List[CodeAction]:
        """
        Generate code actions for spelling corrections in a document.

        Args:
            ls (LanguageServer): The instance of the language server.
            params (CodeActionParams): The parameters for the code action request.
            range (Range): The range within the document where the code action is requested.
            sf (ServerFunctions): The server functions object.

        Returns:
            List[CodeAction]: A list of CodeAction objects representing spelling correction actions.
        """
        document_uri = params.text_document.uri
        document = ls.workspace.get_document(document_uri)
        diagnostics = params.context.diagnostics
        
        actions = []
        typo_diagnostics = []
        start_line = None
        for diagnostic in diagnostics:
            if SPELLING_MESSAGE.TYPO.value.split(":")[0] in diagnostic.message:
                typo_diagnostics.append(diagnostic)
                start_line = diagnostic.range.start.line
                start_character = diagnostic.range.start.character
                end_character = diagnostic.range.end.character
                word = document.lines[start_line][start_character:end_character]
                line = document.lines[start_line][end_character:-1]
                try:
                    corrections = self.spell_check.check(word)
                except IndexError:
                    corrections = []
                for correction in corrections:
                    edit = TextEdit(range=diagnostic.range, new_text=correction)
     

                    action = CodeAction(
                        title=SPELLING_MESSAGE.REPLACE_WORD.value.format(word=word, correction=correction),
                        kind=CodeActionKind.QuickFix,
                        diagnostics=[diagnostic],
                        edit=WorkspaceEdit(changes={document_uri: [edit]}))
                    
                    actions.append(action)

                add_word_action = CodeAction(
                    title=SPELLING_MESSAGE.ADD_WORD.value.format(word=word),
                    kind=CodeActionKind.QuickFix,
                    diagnostics=[diagnostic],
                    command=Command('Add to Dictionary', command='pygls.server.add_dictionary', arguments=[[word]]),
                )
                actions.append(add_word_action)
                add_word_action = CodeAction(
                            # title=f'{SPELLING_MESSAGE.ADD_ALL_WORDS.value} ({len(typo_diagnostics)})', # FIXME: typo_diagnostics is not the right variable here. How can we count all the fixes? Can we inside this loop?
                            title="Add all words",
                            kind=CodeActionKind.QuickFix,
                            diagnostics=[diagnostic],
                            command=Command('Add to Dictionary', command='pygls.server.add_dictionary', arguments=[document.lines[start_line].split(" ")])
                        )
                actions.append(add_word_action)
            
        return actions
    
    def add_dictionary(self, args):
        """
        Add words to the dictionary.

        Args:
            args (List[str]): A list of words to be added to the dictionary.
        """
        args = args[0]
        for word in args:
            self.dictionary.define(word)
        self.sf.server.show_message("Dictionary updated.")

    def initialize(self, params, server: LanguageServer, sf):
        """
        Initialize the spell checking functionality by setting up the dictionary and spell checker.

        Args:
            params: The initialization parameters.
            server (LanguageServer): The instance of the language server.
            sf (ServerFunctions): The server functions object.
        """
        self.dictionary = Dictionary(self.sf.raw_path + "/drafts/")
        self.spell_check = SpellCheck(dictionary=self.dictionary)