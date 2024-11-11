# Codex Translation Editor Extension

The Codex Translation Editor Extension is a powerful Visual Studio Code extension designed to enhance the experience of working with scripture translation projects. It provides support for `.codex` notebooks, `.bible` source files, and `.scripture` raw scripture files, integrating seamlessly with Translator's Copilot Language Server for scripture drafting, checking diagnostics, and offering advanced features to streamline the translation process.

> Note: this extension is in active development and may have bugs or incomplete features. Please report any issues or suggestions on the [GitHub repository](https://github.com/genesis-ai-dev/codex-editor).

Read more about Codex Translation Editor Extension in the [documentation](https://codex-editor.gitbook.io/).

## Features

-   **Notebook Support**: Utilize `.codex` notebooks for organizing and managing your scripture translation projects.
-   **Language Support**: Syntax highlighting and language support for `.scripture` and `.codex` files to improve readability and editing.
-   **Translator's Copilot Integration**: Access to Translator's Copilot Language Server for advanced drafting and diagnostics.
-   **Custom Views and Panels**: Dedicated views for resources, comments, parallel passages, and more, tailored for scripture translation workflows.
-   **Commands and Shortcuts**: A set of commands for common tasks such as creating new projects, opening files, indexing references, and more, accessible directly from the command palette.
-   **Customizable Settings**: Configure the extension to suit your workflow with settings for the language server, document selectors, and more.

### Getting Started

1. **Installation**: Install the extension from the Visual Studio Code Marketplace.
2. **Setup a Project**: Use the "Start a new Project" command to initialize your translation project. If you open the Scripture Explorer panel, you will see a button to create a new project as well.
3. **Explore the Features**: Navigate through the custom views like the Genesis Translator, Parallel Passages, and Resource Explorer to access the tools and resources you need.
4. **Edit and Translate**: Open `.codex` or `.scripture` files, or navigate to a chapter of a biblical book in the Scripture Explorer and start translating with the help of syntax highlighting and language support. You can also use the Translator's Copilot Language Server to get advanced drafting and diagnostics.

You can also use the "Create Codex Notebook" command to generate a new Codex Notebook for your project.

> Note: If you are using the Translator's Copilot AI chat or the LLM-powered drafting suggestions, you will need to configure the server endpoint and API keys in the extension settings. By default, the extension uses the local server spun up by [LM Studio](https://lmstudio.ai), but you can also use the OpenAI API by providing your API key.

### Key Commands

-   `Start a new Project`: Initializes a new translation project.
-   `Open File`: Opens a `.codex` or `.scripture` file.
-   `Create Codex Notebook`: Generates a new Codex Notebook for your project.
-   `Show Scripture References`: Displays references for the current scripture.
-   `Refresh`: Updates the entries in the resource explorer and other views.

### Custom Views

-   **Genesis Translator**: A webview panel for accessing translation tools and resources.
-   **Parallel Passages**: View parallel passages to compare translations.
-   **Comments**: Manage and view comments on your translations.
-   **Scripture Explorer**: Navigate through your scripture files easily.
-   **Dictionary Table**: Access a comprehensive dictionary for translation help.

### Configuration

Customize the Codex Translation Editor Extension to fit your needs with configurable settings for the Translator's Copilot, server setup, client configuration, and more. Adjust settings like the language server endpoint, API keys, and document selectors to optimize your translation workflow.

### Contributing

We welcome contributions and suggestions! Please visit our [GitHub repository](https://github.com/genesis-ai-dev/codex-editor) to contribute or report issues.

### License

This extension is licensed under the MIT License. See the LICENSE file in the GitHub repository for more information.

---

This extension is part of Project Accelerate, aiming to accelerate scripture translation through innovative technology solutions. Join us in our mission to make scripture accessible to every language and people.

## Developers: Running this extension locally in VS Code

First you need to clone the repository and install the dependencies. If you have `pnpm` installed, you can use it to install the dependencies. If you don't have `pnpm` installed, you can install it by running `npm install -g pnpm`. `pnpm` is a package manager that is faster and more efficient than `npm` and `yarn`, but you can just use `npm` if you prefer.

```bash
git clone https://github.com/genesis-ai-dev/codex-editor.git
cd codex-editor
```

-   Make sure you have the following extensions loaded into vsCode: python and scripture-language-support,

````bash

Note: Before running the extension, you need to install the dependencies for **both** the extension itself, and any children webviews, such as the `ChatSideBar`. To do this, open a terminal and run the following command:

```bash
# First let's install the dependencies for the extension
pnpm i # if you're using pnpm, or npm install if you're using npm

# Next, let's install the dependencies for the webview
#FIXME: we can just add this step to a setup script
## build the codex-webviews
codex-editor % cd webviews/codex-webviews
codex-webviews % pnpm i
codex-webviews % pnpm run build:all


## build the editable-react-table
#FIXME: if you get this error -
#         you may have to do:
#           `pnpm add @types/react`
#           `pnpm add @types/react-dom`
#         and then run build command again
dictionary-side-panel % cd ../editable-react-table
editable-react-table % pnpm i
editable-react-table % pnpm run build

# Now, let's go back to the root of the project and start the extension
ChatSideBar % cd ../..
codex-editor % code . # this opens the project in VS Code, but you can also open it manually by opening VS Code and opening the extension folder you cloned
````

Now that you have the extension open in VS Code, you can run the extension by pressing `F5`. This will open a new VS Code window with the extension running. You can then open a new untitled file and run the "Create Codex Notebook" command to create a new untitled notebook of this type.

With the extension project open in VS Code, do the following:

1. Hit `F5` to build+debug
2. Run the command "Create Codex Notebook"
3. Add and edit cells, and click the run button to invoke the controller

## Run tests

-   Open the debug viewlet (`Ctrl+Shift+D` or `Cmd+Shift+D` on Mac) and from the launch configuration dropdown pick `Extension Tests`.
-   Press `F5` to run the tests in a new window with your extension loaded.
-   See the output of the test result in the debug console.
-   Make changes to `src/test/suite/extension.test.ts` or create new test files inside the `test/suite` folder.
    -   The provided test runner will only consider files matching the name pattern `**.test.ts`.
    -   You can create folders inside the `test` folder to structure your tests any way you want.

## Translator's Copilot Server

This server is running in the background. See the README under the `servers` folder on the GitHub repository for more information.
