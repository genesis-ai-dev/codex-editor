import os
import subprocess
import sys
import threading

import socket
from typing import List, NoReturn

def install_dependencies() -> None:
    """Install required dependencies from requirements.txt."""
    script_directory = os.path.dirname(os.path.abspath(__file__))
    requirements_file = os.path.join(script_directory, "requirements.txt")
    try:
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "--break-system-packages", "-q", "-r", requirements_file])
        except subprocess.CalledProcessError:
            # If the previous command fails, try without the --break-system-packages option
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "-r", requirements_file])
    except:
        print("bummer")


install_dependencies()

def is_port_in_use(port: int) -> bool:
    """Check if the given port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0


def start_flask_server() -> None:
    """Start the Flask server if the designated port is not in use."""
    FLASK_PORT = 5554
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
            print(f"Error while killing process on port {FLASK_PORT}: {e}")

    flask_server_path = os.path.join(os.path.dirname(__file__), "flask_server.py")
    with open(os.devnull, 'w') as devnull:
        subprocess.Popen([sys.executable, flask_server_path], stdout=devnull, stderr=devnull)




from pygls.server import LanguageServer
from servable.servable_embedding import ServableEmbedding
from servable.servable_wb import wb_line_diagnostic
from servable.servable_lad import lad_diagnostic
from servable.spelling import ServableSpelling
from servable.servable_forcasting import ServableForcasting
from servable.verse_validator import ServableVrefs
from tools.ls_tools import ServerFunctions



def add_dictionary(args: List[str]) -> bool:
    """Add a dictionary to the spelling servable."""
    return spelling.add_dictionary(args)


def on_highlight(params: List[str]) -> None:
    """Handle text selection event."""
    server_functions.on_selected(str(params[0]))


# Initialize the language server with metadata
server = LanguageServer("code-action-server", "v0.1")

# Create server functions and servables
server_functions = ServerFunctions(server=server, data_path='/.project')
forcasting = ServableForcasting(sf=server_functions, chunk_size=20)
spelling = ServableSpelling(sf=server_functions)
vrefs = ServableVrefs(sf=server_functions)

# Register completions, diagnostics, and actions with the server
server_functions.add_completion(spelling.spell_completion)
server_functions.add_completion(forcasting.text_completion)

server_functions.add_diagnostic(spelling.spell_diagnostic)
server_functions.add_diagnostic(wb_line_diagnostic)
#server_functions.add_diagnostic(lad_diagnostic)
server_functions.add_diagnostic(vrefs.vref_diagnostics)

server_functions.add_action(spelling.spell_action)
server_functions.add_action(vrefs.vref_code_actions)

# Register close function and commands with the server
embedding = ServableEmbedding(sf=server_functions)
server_functions.add_close_function(embedding.on_close)
server.command("pygls.server.add_dictionary")(add_dictionary)
server.command("pygls.server.textSelected")(on_highlight)
# Start the Flask server and the language server
print('Running server...')
threading.Thread(target=start_flask_server, daemon=True).start()

server_functions.start()
server.start_io()