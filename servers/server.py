"""
Pygls language server
"""
import os
from typing import List
import webbrowser
from pygls.server import LanguageServer
import servable_forecasting
import utils.servable_lad as servable_lad
import utils.install_packages as install_packages
import utils.verse_validator as verse_validator

import lsp_wrapper
import spelling as spelling

print(install_packages.INSTALLED)
WORKSPACE_PATH = os.environ.get('WORKSPACE_PATH', '')





def add_dictionary(args: List[str]) -> bool:
    """Add a dictionary to the spelling servable."""
    return spelling.add_dictionary(args)

def add_line_dictionary(args): # its counter intuitive but this is the best way
    return spelling.add_dictionary([], mode='many')

def on_highlight(params: List[str]) -> None:
    """Handle text selection event."""
    lsp_wrapper.on_selected(str(params[0]))

# def on_hover(lspw, params, word):
#     webbrowser.open("https://www.google.com/?q="+word)
# Initialize the language server with metadata
server = LanguageServer("code-action-server", "v0.1")

def callback(text: str):
    """
    useless callback
    """
    webbrowser.open("https://www.mindguardian.com/?q="+text)

# Create server functions and servables
lsp_wrapper = lsp_wrapper.LSPWrapper(server=server, data_path='/.project')
forcasting = servable_forecasting.ServableForecasting(lspw=lsp_wrapper, chunk_size=20)
spelling = spelling.ServableSpelling(lspw=lsp_wrapper)
vrefs = verse_validator.ServableVrefs(lspw=lsp_wrapper)

# Register completions, diagnostics, and actions with the server
lsp_wrapper.add_completion(spelling.spell_completion)
lsp_wrapper.add_completion(forcasting.text_completion)

lsp_wrapper.add_diagnostic(spelling.spell_diagnostic)
lsp_wrapper.add_diagnostic(servable_lad.lad_diagnostic)
lsp_wrapper.add_diagnostic(vrefs.vref_diagnostics)

lsp_wrapper.add_action(spelling.spell_action)
lsp_wrapper.add_action(vrefs.vref_code_actions)

#lsp_wrapper.add_hover(on_hover)
# Register close function and commands with the server
server.command("pygls.server.add_dictionary")(add_dictionary)
server.command("pygls.server.add_line_dictionary")(add_line_dictionary)
server.command("pygls.server.textSelected")(on_highlight)
# Start the Flask server and the language server

lsp_wrapper.start()
server.start_io()
