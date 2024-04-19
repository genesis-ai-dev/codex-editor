import requests
from typing import List
from lsprotocol.types import CompletionParams, Range, CompletionItem, TextEdit, Position
from pygls.server import LanguageServer
from experiments.bia import BidirectionalInverseAttention
from tools.ls_tools import ServerFunctions


# def print(*args, **kwargs):
#     text = " ".join(map(str, args))

#     requests.get(f"http://localhost:5554/add_debug?text={text}")

class ServableForcasting:
    def __init__(self, sf: ServerFunctions, chunk_size: int = 100):
        """
        Initialize the ServableTextGenerator class with server functions and chunk size.

        Args:
            sf (ServerFunctions): The server functions object that provides access to server-related utilities.
            chunk_size (int, optional): The size of the chunks for text generation. Defaults to 100.
        """
        self.bai = None
        self.chunk_size = chunk_size
        self.sf: ServerFunctions = sf

    def text_completion(self, server: LanguageServer, params: CompletionParams, range: Range, sf: ServerFunctions) -> List:
        """
        Provide completion items for text generation in a document.

        Args:
            server (LanguageServer): The instance of the language server.
            params (CompletionParams): The parameters for the completion request.
            range (Range): The range within the document where the completion is requested.
            sf (ServerFunctions): The server functions object.

        Returns:
            List: A list of CompletionItem objects representing text completion suggestions.
        """
        if not self.bai:
            self.initialize()
        try:
            document_uri = params.text_document.uri
            document = server.workspace.get_document(document_uri)
            line = document.lines[params.position.line]

            seed_sentence = line.strip()
            print("sentence: ", seed_sentence)
            if self.bai is not None:
                completions = self.bai.get_possible_next(seed_sentence, options=4)
                return [CompletionItem(
                    label=completion,
                    text_edit=TextEdit(range=range, new_text=completion),
                ) for completion in completions]
            else:
                return []
        except Exception:
            return []

    def initialize(self):
        """
        Initialize the text generation functionality by setting up the text generator.

        Args:
            params: The initialization parameters.
            server (LanguageServer): The instance of the language server.
            sf (ServerFunctions): The server functions object.
        """
        print("initializing")
        path = self.sf.data_path + "/complete_draft.txt"
        print("path: ", path)
        try:
            print("opening")
            self.bai = BidirectionalInverseAttention(path=path)
            print("success")
        except Exception as e:
            print(str(e))

