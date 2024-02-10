import subprocess
import os
import threading
import socket
from typing import NoReturn

try:
    from pygls.server import LanguageServer
    from tools.ls_tools import ServerFunctions
    from servable.spelling import ServableSpelling
    from servable.servable_wb import wb_line_diagnostic
    from servable.servable_embedding import ServableEmbedding
    from servable.verse_validator import ServableVrefs
    import flask
    import sys
except ImportError:
    import sys
    script_directory = os.path.dirname(os.path.abspath(__file__))
    requirements_file = os.path.join(script_directory, "requirements.txt")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--break-system-packages", "-r", requirements_file])
    exit()



def is_port_in_use(port: int) -> bool:
    """Check if the given port is already in use.

    Args:
        port (int): The port number to check.

    Returns:
        bool: True if the port is in use, False otherwise.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0

def start_flask_server() -> NoReturn:
    """Start the Flask server if the designated port is not in use.

    If the port is in use, attempt to kill the process that is using it.
    """
    FLASK_PORT = 5554  # Flask server port
    if is_port_in_use(FLASK_PORT):
        try:
            result = subprocess.run(["lsof", "-i", f":{FLASK_PORT}"], capture_output=True, text=True)
            for line in result.stdout.splitlines():
                if "LISTEN" in line:
                    pid = int(line.split()[1])
                    subprocess.run(["kill", "-9", str(pid)])
                    # No print statement here
                    break
        except Exception:
            # No print statement here
            pass
    flask_server_path = os.path.join(os.path.dirname(__file__), "flask_server.py")
    with open(os.devnull, 'w') as devnull:
        subprocess.Popen([sys.executable, flask_server_path], stdout=devnull, stderr=devnull)
threading.Thread(target=start_flask_server, daemon=True).start()

# Initialize the language server with metadata
server = LanguageServer("code-action-server", "v0.1")  # TODO: #1 Dynamically populate metadata from package.json?

# Create server functions and servables
server_functions = ServerFunctions(server=server, data_path='/drafts')
spelling = ServableSpelling(sf=server_functions, relative_checking=True)
#embedding = ServableEmbedding(sf=server_functions) I don't think this will be needed anymore?
vrefs = ServableVrefs(sf=server_functions)

# Register completions, diagnostics, and actions with the server
server_functions.add_completion(spelling.spell_completion)
#server_functions.add_completion(embedding.embed_completion)
server_functions.add_diagnostic(spelling.spell_diagnostic)
server_functions.add_diagnostic(wb_line_diagnostic)
server_functions.add_diagnostic(vrefs.vref_diagnostics)
server_functions.add_action(spelling.spell_action)

def add_dictionary(args: list) -> bool:
    """Add a dictionary to the spelling servable.

    Args:
        args (list): Arguments required for adding a dictionary.

    Returns:
        bool: True if the dictionary was added successfully, False otherwise.
    """
    return spelling.add_dictionary(args)

# Register the add_dictionary command with the server
server.command("pygls.server.add_dictionary")(add_dictionary)

if __name__ == "__main__":
    print('Running server...')
    server_functions.start()
    server.start_io()
