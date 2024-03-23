import subprocess
import os
import threading
import socket
from typing import NoReturn
import sys
from pygls.server import LanguageServer
from tools.ls_tools import ServerFunctions
from servable.spelling import ServableSpelling
from servable.servable_wb import wb_line_diagnostic
from servable.verse_validator import ServableVrefs
from servable.servable_embedding import ServableEmbedding
from servable.servable_forcasting import ServableForcasting
try:
    import sys # TODO: See if this takes too much time

    script_directory = os.path.dirname(os.path.abspath(__file__))
    requirements_file = os.path.join(script_directory, "requirements.txt")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--break-system-packages", "-q", "-r", requirements_file])
    import genetok
    import flask # forces install if it is not installed
    import flask_cors # forces install if it is not installed
    import sklearn
    import sys
except ImportError:
    import sys
    script_directory = os.path.dirname(os.path.abspath(__file__))
    requirements_file = os.path.join(script_directory, "requirements.txt")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--break-system-packages", "-q", "-r", requirements_file])
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

def start_flask_server() -> None:
    """Start the Flask server if the designated port is not in use.

    If the port is in use, attempt to kill the process that is using it.
    
    This version works across platforms including Windows.
    """
    FLASK_PORT = 5554  # Flask server port
    if is_port_in_use(FLASK_PORT):
        try:
            if os.name == 'nt':  # Windows
                result = subprocess.run(["netstat", "-aon"], capture_output=True, text=True)
                for line in result.stdout.splitlines():
                    if f":{FLASK_PORT}" in line and 'LISTENING' in line:
                        pid = line.rstrip().split()[-1]
                        subprocess.run(["taskkill", "/F", "/PID", pid])
                        break
            else:  # Unix/Linux
                result = subprocess.run(["lsof", "-i", f":{FLASK_PORT}"], capture_output=True, text=True)
                for line in result.stdout.splitlines():
                    if "LISTEN" in line:
                        pid = line.split()[1]
                        subprocess.run(["kill", "-9", pid])
                        break
        except Exception as e:
            pass  # Optionally, log the exception e

    flask_server_path = os.path.join(os.path.dirname(__file__), "flask_server.py")
    with open(os.devnull, 'w') as devnull:
        subprocess.Popen([sys.executable, flask_server_path], stdout=devnull, stderr=devnull)

threading.Thread(target=start_flask_server, daemon=True).start()

# Initialize the language server with metadata
server = LanguageServer("code-action-server", "v0.1")  # TODO: #1 Dynamically populate metadata from package.json?

# Create server functions and servables
server_functions = ServerFunctions(server=server, data_path='/.project')
spelling = ServableSpelling(sf=server_functions, relative_checking=True)
vrefs = ServableVrefs(sf=server_functions)
forcasting = ServableForcasting(sf=server_functions, chunk_size=7)

# Register completions, diagnostics, and actions with the server
#server_functions.add_completion(spelling.spell_completion)
server_functions.add_completion(forcasting.text_completion)

server_functions.add_diagnostic(spelling.spell_diagnostic)
server_functions.add_diagnostic(wb_line_diagnostic)
server_functions.add_diagnostic(vrefs.vref_diagnostics)


server_functions.add_action(spelling.spell_action)
server_functions.add_action(vrefs.vref_code_actions)


embedding = ServableEmbedding(sf=server_functions)
server_functions.add_close_function(embedding.on_close)
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

def on_highlight(params):
    return server_functions.on_selected(str(params[0]))

server.command("pygls.server.textSelected")(on_highlight) #server_functions.on_selected)


if __name__ == "__main__":
    print('Running server...')
    server_functions.start()
    server.start_io()
