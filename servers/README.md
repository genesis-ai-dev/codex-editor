# Language Server Protocol Extension with Python and VSCode

This README will guide you through the process of using the `ServerFunctions` class to extend the functionality of a Language Server Protocol (LSP) implementation using Python and Visual Studio Code (VSCode). The `ServerFunctions` class provides a way to add custom completion, diagnostic, and action features to your language server.

> Note: The information below may be somewhat out of date.

## Prerequisites

Before you begin, ensure you have the following installed:

- Visual Studio Code
- Install `scripture-language-support` from the extension store
- Python 3.11 or higher:
  - Check your python version by running `python3 --version`.  At this time we need Python version `3.11.x`. If you have an older version of Python, download newer version from `https://www.python.org/downloads/release/python-3118/`. If the language server fails to start, you may have multiple versions of python installed and an older version is first in the path.  To find out all the Python3 installs on your system, do `where python3` (`which python3` on Mac).  For each install query the version (e.g by doing `/usr/bin/python3 --version`).  When you find the correct version, you need to configure VsCode to use that version by doing `View / Command Prompt /  Preferences: Open Workspace Settings`. Then navigate to `User Tab / Extensions / Codex Scripture Editor / Server Configuration`.  And put the path to the correct Python version in `Pygls > Server: PythonPath`

## How it works

1. First, you need to create an instance of `LanguageServer` from the `pygls` package:

    ```python
    from pygls.server import LanguageServer

    server = LanguageServer("your-language-server-name", "your-version")
    ```

2. Then, create an instance of `ServerFunctions` by providing the `server` object and a path to store project data (this is relative to the workspace):

    ```python
    from your_module import ServerFunctions

    server_functions = ServerFunctions(server=server, data_path='/path_to_project_data')
    ```

## Adding Custom Server Functions

### Implementing a Skeleton Class

Create a skeleton class that will hold the logic for your completion, diagnostic, and action handlers:

```python

def my_completion_handler(server, params, range, sf):
    # Implement your completion logic here
    pass

def my_diagnostic_handler(server, params, sf):
    # Implement your diagnostic logic here
    pass

def my_action_handler(server, params, range, sf):
    # Implement your action logic here
    pass
```

### Registering Handlers

Register your feature handlers with the `ServerFunctions` instance:

```python
# Instantiate your custom feature class
import custom_features

# Register completion, diagnostic, and action handlers
server_functions.add_completion(custom_features.my_completion_handler)
server_functions.add_diagnostic(custom_features.my_diagnostic_handler)
server_functions.add_action(custom_features.my_action_handler)
```

### Starting the Server

After registering all your handlers, you must start the server functions and then start the language server:

```python
if __name__ == "__main__":
    server_functions.start()
    server.start_io()
```

## Using LLMs

### Prerequisites for using LLMs

Before you begin, ensure you have the following installed:

- `LM Studio` if you want to run a local language model
  - also download an LLM to use (a good example we experiment with is Intel's "neural chat" 7b model, which you can find in LM Studio. Be sure to get a quantization of the model such as the `Q4_K_M`, as the full model is too large to run on most machines).
  - Note that the smaller the model, the faster it will run, but the less accurate and/or useful it will be. This will be especially noticeable in the chat feature, though the draft suggestions will also be less useful.

### Configure with LM Studio

#### Set up LM Studio

- click on the local server icon on left (`<->`)
- In the top dropdown select a model to load, and wait for load to complete (smaller models will load faster)
- Click the `Start Server` button
- Copy the path to the server shown in the Server Logs.  It should look like `http://localhost:1234/v1`

#### Configure VsCode

- Under Props do  `View / Command Prompt / Preferences: Open Workspace Settings`. Then navigate to `User Tab / Extensions / Codex Scripture Editor / Translators-copilot` and put path in `Pygls > Server: Python Path`
- Paste the path to the server into `Translators-copilot: Llm Endpoint`

### Configure with OpenAI

- Under Props do  `View / Command Prompt / Preferences: Open Workspace Settings`.
- Then navigate to `User Tab / Extensions / Codex Scripture Editor / Translators-copilot` and put `https://api.openai.com/v1` in `Pygls > Server: Python Path`
- And then enter your OpenAI key into `Translators-copilot: Api_key`
