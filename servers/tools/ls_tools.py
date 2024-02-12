from typing import Callable, List
from pygls.server import LanguageServer
from lsprotocol.types import (Range, Position, TextEdit, DiagnosticSeverity, 
                              TEXT_DOCUMENT_DID_CLOSE, DidCloseTextDocumentParams, DidOpenTextDocumentParams, TEXT_DOCUMENT_DID_OPEN)

import lsprotocol.types as lsp_types
import time


class ServerFunctions:
    def __init__(self, server: LanguageServer, data_path: str):
        self.server = server
        self.completion_functions = []
        self.diagnostic_functions = []
        self.action_functions = []
        self.initialize_functions = []
        self.close_functions = []
        self.open_functions = []
        self.on_selected_functions = []


        self.completion = None
        self.diagnostic = None
        self.action = None
        self.data_path = data_path 
        self.last_closed = time.time()
    
    def add_diagnostic(self, function: Callable):#, #trigger_characters: List):
        self.diagnostic_functions.append((function, None))

    def add_completion(self, function: Callable, kind: lsp_types.CompletionItemKind = lsp_types.CompletionItemKind.Text):
        self.completion_functions.append((function, kind))

    def add_action(self, function: Callable, kind: lsp_types.CodeAction = lsp_types.CodeActionKind.QuickFix):
        self.action_functions.append((function, kind))
    
    def add_close_function(self, function: Callable):
        self.close_functions.append(function)
    
    def add_open_function(self, function: Callable):
        self.open_functions.append(function)
    
    def add_selected_text_functiosn(self, function: Callable):
        self.on_selected_functions.append(function)



    def start(self):
        @self.server.feature(
            lsp_types.TEXT_DOCUMENT_CODE_ACTION,
            lsp_types.CodeActionOptions(code_action_kinds=[action[1] for action in self.action_functions]),
        )
        def actions(params: lsp_types.CodeAction):
            items = []
            document_uri = params.text_document.uri
            document = self.server.workspace.get_document(document_uri)
            start_line = params.range.start.line
            end_line = params.range.end.line

            lines = document.lines[start_line : end_line + 1]
            for idx, line in enumerate(lines):
                range = Range(
                        start=Position(line=start_line + idx, character=0),
                        end=Position(line=start_line + idx, character=len(line) - 1),
                    )
                for action_function in self.action_functions:
                    items.extend(action_function[0](self.server, params, range, self))
            return items
        self.action = actions

        @self.server.feature(lsp_types.TEXT_DOCUMENT_DID_CHANGE)
        def diagnostics(ls, params: lsp_types.DidChangeTextDocumentParams):
            document_uri = params.text_document.uri
            all_diagnostics = []
            for diagnostic_function in self.diagnostic_functions:
                all_diagnostics.extend(diagnostic_function[0](ls, params, self))
            error_diagnostics = [diagnostic for diagnostic in all_diagnostics if diagnostic.severity == DiagnosticSeverity.Error]
            if error_diagnostics:
                ls.publish_diagnostics(document_uri, error_diagnostics)
            else:
                ls.publish_diagnostics(document_uri, all_diagnostics)
        self.diagnostic = diagnostics

        @self.server.feature(lsp_types.TEXT_DOCUMENT_COMPLETION, lsp_types.CompletionOptions(trigger_characters=[""]))
        def completions(ls, params: lsp_types.CompletionParams):
            range = Range(start=params.position,
                          end=Position(line=params.position.line, character=params.position.character + 5))
            completions = []
            for completion_function in self.completion_functions:
                completions.extend(completion_function[0](ls, params, range, self))
            return lsp_types.CompletionList(items = completions, is_incomplete=False)
        self.completion = completions

        @self.server.feature(lsp_types.INITIALIZED)
        def initialize(ls, params: lsp_types.InitializedParams):
            self.initialize(ls, params, self)
            for function in self.initialize_functions:
                function(ls, params, self)
        
        @self.server.feature(TEXT_DOCUMENT_DID_CLOSE)
        def on_close(ls, params: DidCloseTextDocumentParams):
            if time.time() - self.last_closed > 10: # fix bug where pygls calls close many times
                self.last_closed = time.time()
                for function in self.close_functions:
                    function(ls, params, self)
        
    
        
        @self.server.feature(TEXT_DOCUMENT_DID_OPEN)
        def on_open(ls, params: DidOpenTextDocumentParams):
            for function in self.open_functions:
                function(ls, params, self)
        

    

    def on_selected(self, text):
        self.server.show_message("Text selected: "+text)
        for f in self.on_selected_functions:
            f(text)
    def initialize(self, server, params, fs):        
        self.data_path = server.workspace.root_path + self.data_path
