import urllib
from lsprotocol.types import DidCloseTextDocumentParams
from tools.ls_tools import ServerFunctions
from tools.embedding_tools import DataBase
from lsprotocol.types import (DocumentDiagnosticParams, CompletionParams, 
    CodeActionParams, Range, CompletionItem, CompletionItemKind, 
    TextEdit, Position, Diagnostic, DiagnosticOptions, CodeAction, WorkspaceEdit, CodeActionKind, Command, DiagnosticSeverity)
from pygls.server import LanguageServer
from typing import List
import time
from servable.spelling import is_bible_ref

def uri_to_filepath(uri):
    # Decode the URL
    decoded_url = urllib.parse.unquote(uri) # TODO: #5 need to make sure we are using the vscode api conventions to use the workspace-relative URI. See line 52 below

    # Remove the scheme and the first slash if present
    if decoded_url.startswith('vscode-notebook-cell:/'):
        decoded_url = decoded_url[len('vscode-notebook-cell:/'):]

    # Remove the first slash if present
    if decoded_url.startswith('/'):
        decoded_url = decoded_url[1:]

    return decoded_url.split("#")[0]

class ServableEmbedding:
    def __init__(self, sf: ServerFunctions):
        self.database = None 
        self.sf = sf
        self.sf.initialize_functions.append(self.initialize)
        self.sf.close_functions.append(self.on_close)
        self.last_served = []
        self.time_last_serverd = time.time()

    def embed_document(self, params, sf):
        path = params[0]['fsPath']
        if ".codex" in path:
            sf.server.show_message(message="Embedding document.")
            self.database.upsert_codex_file(path=path)
            sf.server.show_message(message=f"The Codex file '{path}' has been upserted into 'database'")

    def on_close(self, ls, params: DidCloseTextDocumentParams, fs):
        path = uri_to_filepath(params.text_document.uri)
        self.embed_document([{'fsPath': path}], fs)
        ls.show_message("Closed file")
    
    def embed_completion(self, server: LanguageServer, params: CompletionParams, range: Range, sf: ServerFunctions) -> List:
        document_uri = params.text_document.uri
        document = server.workspace.get_document(document_uri)
        line = document.lines[params.position.line].strip()
        if time.time() - self.time_last_serverd > 2 or self.last_served == []:
            if not is_bible_ref(line):
                result = self.database.search(line, limit=2)
                if not result:
                    return []
                result = [CompletionItem(label=result[0]['text'][:20]+ '...', text_edit=TextEdit(range=range, new_text=f'\nSimilar: \n{str(result[0]["text"])}\n'))]
                self.last_served = result
                return result
        return []

    def initialize(self, server, params, sf):
        self.database = DataBase(sf.data_path+"/database")
    

        