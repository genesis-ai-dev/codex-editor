from typing import List
from lsprotocol.types import CompletionParams, Range, CompletionItem, TextEdit
from pygls.server import LanguageServer
from utils import bia
from lsp_wrapper import LSPWrapper


class ServableForecasting:
    def __init__(self, lspw: LSPWrapper, chunk_size: int = 100):
        """
        Initialize the ServableTextGenerator class with server functions and chunk size.

        Args:
            sf (LSPWrapper): The server functions object that provides access to server-related utilities.
            chunk_size (int, optional): The size of the chunks for text generation. Defaults to 100.
        """
        self.bia = None
        self.chunk_size = chunk_size
        self.lspw: LSPWrapper = lspw

    def text_completion(self, lspw, params: CompletionParams, _range: Range) -> List:
        """
        Provide completion items for text generation in a document.

        Args:
            server (LanguageServer): The instance of the language server.
            params (CompletionParams): The parameters for the completion request.
            range (Range): The range within the document where the completion is requested.
            sf (LSPWrapper): The server functions object.

        Returns:
            List: A list of CompletionItem objects representing text completion suggestions.
        """
        if not self.bia:
            self.initialize()
        try:
            document_uri = params.text_document.uri
            document = lspw.server.workspace.get_document(document_uri)
            line = document.lines[params.position.line]

            seed_sentence = line.strip()
            print("sentence: ", seed_sentence)
            if self.bia is not None:
                completions = self.bia.get_possible_next(seed_sentence, options=4)
                return [CompletionItem(
                    label=completion,
                    text_edit=TextEdit(range=_range, new_text=completion),
                ) for completion in completions]
            else:
                return []
        except IndexError:
            return []

    def initialize(self):
        """
        Initialize the text generation functionality by setting up the text generator.

        Args:
            params: The initialization parameters.
            server (LanguageServer): The instance of the language server.
            sf (LSPWrapper): The server functions object.
        """
        print("initializing")
        path = self.lspw.paths.data_path + "/complete_draft.txt"
        print("path: ", path)
        try:
            print("opening")
            self.bia = bia.BidirectionalInverseAttention(path=path)
            print("success")
        except IndexError as e:
            print(str(e))

