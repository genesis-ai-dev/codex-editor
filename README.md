# codex-editor-extension

This is a very simple extension sample demonstrating the use of the notebook serializer and controller APIs. This sample includes:

> Note: we are building this extension up to be the core features you need to use the Codex app for translation projects. It will include `.codex` notebook functionality, Scripture language-related functionality, and schemas for relevant data types. Subject to change!

-   A notebook serializer that is activated for files matching `*.sample-json-notebook`. It serializes notebook data into a simple JSON-based format.
-   A notebook controller that "executes" JSON-type code cells by adding an output to the cell that includes the content of the cell parsed as JSON.
-   A command "Create Codex Notebook" that creates a new untitled notebook of this type.

## Running this sample

First you need to clone the repository and install the dependencies. If you have `pnpm` installed, you can use it to install the dependencies. If you don't have `pnpm` installed, you can install it by running `npm install -g pnpm`. `pnpm` is a package manager that is faster and more efficient than `npm` and `yarn`, but you can just use `npm` if you prefer.

```bash
git clone https://github.com/genesis-ai-dev/codex-editor.git
cd codex-editor
```

```bash

Note: Before running the extension, you need to install the dependencies for **both** the extension itself, and any children webviews, such as the `ChatSideBar`. To do this, open a terminal and run the following command:

```bash
# First let's install the dependencies for the extension
pnpm install # if you're using pnpm, or npm install if you're using npm

# Next, let's install the dependencies for the webview 
#FIXME: we can just add this step to a setup script 
codex-editor % cd webviews/ChatSideBar
ChatSideBar % pnpm i
ChatSideBar % pnpm run watch

# Now, let's go back to the root of the project and start the extension
ChatSideBar % cd ../..
codex-editor % code . # this opens the project in VS Code, but you can also open it manually by opening VS Code and opening the extension folder you cloned
```

Now that you have the extension open in VS Code, you can run the extension by pressing `F5`. This will open a new VS Code window with the extension running. You can then open a new untitled file and run the "Create Codex Notebook" command to create a new untitled notebook of this type.

With the extension project open in VS Code, do the following:

1.  Hit `F5` to build+debug
2.  Run the command "Create Codex Notebook"
3.  Add and edit cells, and click the run button to invoke the controller

## Run tests

-   Open the debug viewlet (`Ctrl+Shift+D` or `Cmd+Shift+D` on Mac) and from the launch configuration dropdown pick `Extension Tests`.
-   Press `F5` to run the tests in a new window with your extension loaded.
-   See the output of the test result in the debug console.
-   Make changes to `src/test/suite/extension.test.ts` or create new test files inside the `test/suite` folder.
    -   The provided test runner will only consider files matching the name pattern `**.test.ts`.
    -   You can create folders inside the `test` folder to structure your tests any way you want.

## Translator's Copilot Server

This server is running in the background.

Here is the README content from the original copilot server repo:

# Language Server Protocol Extension with Python and VSCode

This README will guide you through the process of using the `ServerFunctions` class to extend the functionality of a Language Server Protocol (LSP) implementation using Python and Visual Studio Code (VSCode). The `ServerFunctions` class provides a way to add custom completion, diagnostic, and action features to your language server.

## Prerequisites

Before you begin, ensure you have the following installed:

-   Python 3.7 or higher
-   Visual Studio Code
-   Install `scripture-language-support` from the extension store

## How it works:

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
