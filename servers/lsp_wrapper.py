"""
Tools for the language server
"""
import time
import os
import sys
import threading
import socket
import dataclasses
import json
from typing import Callable, List, Any, Union
from pygls.server import LanguageServer
from lsprotocol.types import (Range, Position, DiagnosticSeverity, 
                            TEXT_DOCUMENT_DID_CLOSE,
                            DidCloseTextDocumentParams,
                            DidOpenTextDocumentParams, 
                            TEXT_DOCUMENT_DID_OPEN)
import lsprotocol.types as lsp_types
import socket_functions
from utils import bia

router = socket_functions.universal_socket_router

def block_print():
    """
    Redirects the sys.stdout to /dev/null to block print statements.
    """
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')

def unblock_print():
    """
    Restores the sys.stdout to its default value to enable print statements.
    """
    sys.stdout = sys.__stdout__


@dataclasses.dataclass
class ListableFunctions:
    """
    Contains list of functions
    """
    completion_functions: List[Callable]
    diagnostic_functions: List[Callable]
    action_functions: List[Callable]
    initialize_functions: List[Callable]
    close_functions: List[Callable]
    open_functions: List[Callable]
    on_selected_functions: List[Callable]

@dataclasses.dataclass
class Paths:
    """
    Paths
    """
    raw_path: str
    data_path: str

@dataclasses.dataclass
class HighLevelFunctions:
    """
    Higher level functions
    """
    action_function: Union[None, Callable]
    diagnostic_function: Union[None, Callable]
    completion_function: Union[None, Callable]
class LSPWrapper:
    """
    Functions for the language server
    """
    def __init__(self, server: LanguageServer, data_path: str):
        self.server = server
        self.functions = ListableFunctions(
            completion_functions=[],
            diagnostic_functions=[],
            action_functions=[],
            initialize_functions=[],
            close_functions=[],
            open_functions=[],
            on_selected_functions=[]
        )
        self.high_level_functions = HighLevelFunctions(
            completion_function = None,
            diagnostic_function = None,
            action_function = None
        )
        self.socket_router = router
        self.paths = Paths("", data_path=data_path)
      
        self.last_closed = time.time()
    
    def add_diagnostic(self, function: Callable):
        """
        Adds a function to the diagnostic functions list.
        """
        self.functions.diagnostic_functions.append(function)

    def add_completion(self, function: Callable):
        """
        Adds a function to the completion functions list.
        """
        self.functions.completion_functions.append(function)

    def add_action(self, function: Callable):
        """
        Adds a function to the action functions list.
        """
        self.functions.action_functions.append(function)
    
    # def add_close_function(self, function: Callable):
    #     """
    #     Adds a function to the close functions list.
    #     """
    #     self.functions.close_functions.append(function)
    
    # def add_open_function(self, function: Callable):
    #     """
    #     Adds a function to the open functions list.
    #     """
    #     self.functions.open_functions.append(function)
    
    def add_selected_text_functions(self, function: Callable):
        """
        Adds a function to the on selected functions list.
        """
        self.functions.on_selected_functions.append(function)

    def handle_connection(self, conn):
        with conn:
            data = conn.recv(1024).decode('utf-8')
            if self.socket_router:
                response = self.socket_router.route_to(data)
                conn.sendall(response.encode('utf-8'))

    def start_socket_server(self, host, port):
        """
        Starts socket
        """
        def socket_server():
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind((host, port))
                s.listen()
                while True:
                    conn, _ = s.accept()
                    thread = threading.Thread(target=self.handle_connection, args=(conn,))
                    thread.start()

        

        thread = threading.Thread(target=socket_server)
        thread.daemon = True
        thread.start()

    def start(self, socket_host='localhost', socket_port=8857):
        """
        Starts ls_tools
        """
        @self.server.feature(
            lsp_types.TEXT_DOCUMENT_CODE_ACTION,
        )
        def actions(params: Union [Any, lsp_types.CodeActionParams]):
            items = []
            document_uri = params.text_document.uri
            document = self.server.workspace.get_document(document_uri)
            start_line = params.range.start.line
            end_line = params.range.end.line

            lines = document.lines[start_line : end_line + 1]
            for idx, line in enumerate(lines):
                _range = Range(
                        start=Position(line=start_line + idx, character=0),
                        end=Position(line=start_line + idx, character=len(line) - 1),
                    )
                for action_function in self.functions.action_functions:
                    items.extend(action_function(self, params, _range))
            return items
        self.high_level_functions.action_function = actions

        @self.server.feature(lsp_types.TEXT_DOCUMENT_DID_CHANGE)
        def diagnostics(params: lsp_types.DidChangeTextDocumentParams):
            document_uri = params.text_document.uri
            all_diagnostics = []
            for diagnostic_function in self.functions.diagnostic_functions:
                all_diagnostics.extend(diagnostic_function(self, params))
            error_diagnostics = [diagnostic for diagnostic in all_diagnostics if diagnostic.severity == DiagnosticSeverity.Error]
            if error_diagnostics:
                self.server.publish_diagnostics(document_uri, error_diagnostics)
            else:
                self.server.publish_diagnostics(document_uri, all_diagnostics)
        self.high_level_functions.diagnostic_function = diagnostics

        @self.server.feature(lsp_types.TEXT_DOCUMENT_COMPLETION, lsp_types.CompletionOptions(trigger_characters=["", " "]))
        def completions(params: lsp_types.CompletionParams):
            range_ = Range(start=params.position,
                          end=Position(line=params.position.line, character=params.position.character + 5))
            completions = []
            for completion_function in self.functions.completion_functions:
                completions.extend(completion_function(self, params, range_))
            return lsp_types.CompletionList(items = completions, is_incomplete=False)
        self.high_level_functions.completion_function = completions

        @self.server.feature(lsp_types.INITIALIZED)
        def initialize(params: lsp_types.InitializedParams):
            assert self.server # make pylint behave
            block_print()
            self.initialize(self, params)
            for function in self.functions.initialize_functions:
                function(self, params)
            unblock_print()

        # @self.server.feature(TEXT_DOCUMENT_DID_CLOSE)
        # def on_close(server, params: DidCloseTextDocumentParams):
        #     assert server # make pylint happy
        #     if time.time() - self.last_closed > 10: # fix bug where pygls calls close many times
        #         self.last_closed = time.time()
        #         for function in self.functions.close_functions:
        #             function(self, params)
        
    
        # @self.server.feature(TEXT_DOCUMENT_DID_OPEN)
        # def on_open(server, params: DidOpenTextDocumentParams):
        #     assert server # make pylint happy
        #     for function in self.functions.open_functions:
        #         function(self, params)
        
        self.start_socket_server(socket_host, socket_port)
    

    def on_selected(self, text):
        """
        On text selected
        """
        # self.server.show_message("Text selected: "+text)
        for f in self.functions.on_selected_functions:
            f(text)

    def initialize(self, lspw, params):
        """
        Initialize things once the workspace is all set
        """
        assert params # just to get rid of the anoying pylint stuff
        self.paths.data_path = lspw.server.workspace.root_path + self.paths.data_path
        self.paths.raw_path = lspw.server.workspace.root_path
        print("initializing BIA")
        path = self.paths.data_path + "/complete_draft.txt"
        print("path: ", path)
        try:
            print("opening")
            self.socket_router.bia = bia.BidirectionalInverseAttention(path=path)
            print("success")
        except IndexError as e:
            print(str(e))
        self.socket_router.prepare(self.paths.raw_path)
