# codex-notebook-extension

This is a very simple extension sample demonstrating the use of the notebook serializer and controller APIs. This sample includes:

-   A notebook serializer that is activated for files matching `*.sample-json-notebook`. It serializes notebook data into a simple JSON-based format.
-   A notebook controller that "executes" JSON-type code cells by adding an output to the cell that includes the content of the cell parsed as JSON.
-   A command "Create Codex Notebook" that creates a new untitled notebook of this type.

## Running this sample

1.  `cd codex-notebook-extension`
1.  `code .`: Open the folder in VS Code
1.  Hit `F5` to build+debug
1.  Run the command "Create Codex Notebook"
1.  Add and edit cells, and click the run button to invoke the controller

## Run tests

-   Open the debug viewlet (`Ctrl+Shift+D` or `Cmd+Shift+D` on Mac) and from the launch configuration dropdown pick `Extension Tests`.
-   Press `F5` to run the tests in a new window with your extension loaded.
-   See the output of the test result in the debug console.
-   Make changes to `src/test/suite/extension.test.ts` or create new test files inside the `test/suite` folder.
    -   The provided test runner will only consider files matching the name pattern `**.test.ts`.
    -   You can create folders inside the `test` folder to structure your tests any way you want.
