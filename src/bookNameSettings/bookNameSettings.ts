import * as vscode from "vscode";
import * as xml2js from "xml2js";
import * as path from "path";

export async function openBookNameEditor() {
    const panel = vscode.window.createWebviewPanel(
        "bookNameEditor",
        "Edit Book Names",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error("No workspace folder is open.");
        panel.dispose();
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri;
    const localizedPath = vscode.Uri.joinPath(workspaceRoot, "localized-books.json");

    // Get the extension context
    const extension = vscode.extensions.getExtension("project-accelerate.codex-editor-extension");
    if (!extension) {
        vscode.window.showErrorMessage("Could not find the Codex Editor extension.");
        panel.dispose();
        return;
    }
    const extensionPath = extension.extensionPath;

    // Construct the path to the default books JSON relative to the extension's install location
    const defaultBooksPath = vscode.Uri.file(path.join(
        extensionPath,
        "webviews/codex-webviews/src/assets/bible-books-lookup.json"
    ));
    console.log(`Attempting to load default books from: ${defaultBooksPath.fsPath}`); // Log the path

    let defaultBooks: any[] = [];
    try {
        const raw = await vscode.workspace.fs.readFile(defaultBooksPath);
        defaultBooks = JSON.parse(new TextDecoder().decode(raw));
    } catch (err: any) {
        // Improved error logging
        console.error(`Error loading default book names from ${defaultBooksPath.fsPath}:`, err);
        vscode.window.showErrorMessage(
            `Could not load default book names. Check console for details. Path: ${defaultBooksPath.fsPath}. Error: ${err.message}`
        );
        panel.dispose();
        return;
    }

    // Load localized books if present
    let localizedBooks: Record<string, string> = {};
    try {
        const localizedFileExists = await vscode.workspace.fs.stat(localizedPath).then(
            () => true,
            () => false
        );
        
        if (localizedFileExists) {
            const raw = await vscode.workspace.fs.readFile(localizedPath);
            const arr = JSON.parse(new TextDecoder().decode(raw));
            for (const book of arr) {
                if (book.abbr && book.name) {
                    localizedBooks[book.abbr] = book.name;
                }
            }
        }
    } catch (err) {
        // Ignore, fallback to default
    }

    // Merge for UI: always show all books, use localized name if present
    const mergedBooks = defaultBooks.map((book: any) => ({
        abbr: book.abbr,
        defaultName: book.name,
        name: localizedBooks[book.abbr] || "",
        ord: book.ord,
        testament: book.testament,
    }));

    panel.webview.html = getWebviewContent(mergedBooks);

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "save": {
                try {
                    // Only save books with a non-blank name different from default
                    const toSave = mergedBooks
                        .map((book, i) => {
                            const newName = message.books[i]?.name?.trim();
                            if (newName && newName !== book.defaultName) {
                                return {
                                    abbr: book.abbr,
                                    name: newName,
                                    ord: book.ord,
                                    testament: book.testament,
                                };
                            }
                            return null;
                        })
                        .filter(Boolean);
                    
                    const fileData = new TextEncoder().encode(JSON.stringify(toSave, null, 2));
                    await vscode.workspace.fs.writeFile(localizedPath, fileData);
                    vscode.window.showInformationMessage("Book names updated successfully");
                    panel.dispose();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to save book names: ${error}`);
                }
                break;
            }
            case "cancel":
                panel.dispose();
                break;
            case "importXml": {
                try {
                    // Show file open dialog
                    const fileUris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        filters: { "XML Files": ["xml"] },
                        title: "Import Book Names from XML",
                    });

                    if (!fileUris || fileUris.length === 0) {
                        return; // User canceled
                    }

                    // Read the XML file
                    const xmlFilePath = fileUris[0];
                    const xmlContent = await vscode.workspace.fs.readFile(xmlFilePath);
                    const xmlText = new TextDecoder().decode(xmlContent);

                    // Parse XML to JSON
                    const parser = new xml2js.Parser({
                        explicitArray: false,
                        mergeAttrs: true,
                    });

                    parser.parseString(xmlText, async (err: any, result: any) => {
                        if (err) {
                            vscode.window.showErrorMessage(`Failed to parse XML: ${err.message}`);
                            return;
                        }

                        try {
                            // Extract book data from XML first to check available fields
                            const books = Array.isArray(result.BookNames.book)
                                ? result.BookNames.book
                                : [result.BookNames.book];

                            // Check which name types are available in the XML
                            const hasLong = books.some((book: any) => book.long);
                            const hasShort = books.some((book: any) => book.short);
                            const hasAbbr = books.some((book: any) => book.abbr);

                            // Build options for the quick pick based on what's available
                            const options = [];
                            if (hasLong)
                                options.push({
                                    label: "Long Names",
                                    value: "long",
                                    description: "Full names (e.g., 'كِتَابُ عِزْرَا')",
                                });
                            if (hasShort)
                                options.push({
                                    label: "Short Names",
                                    value: "short",
                                    description: "Short names (e.g., 'عزرا')",
                                });
                            if (hasAbbr)
                                options.push({
                                    label: "Abbreviations",
                                    value: "abbr",
                                    description: "Abbreviations (e.g., 'عز')",
                                });

                            if (options.length === 0) {
                                vscode.window.showErrorMessage(
                                    "No name formats found in the XML file."
                                );
                                return;
                            }

                            // Ask user which name format to use
                            const selectedOption = await vscode.window.showQuickPick(options, {
                                placeHolder: "Select which name format to import",
                                title: "Book Name Format",
                            });

                            if (!selectedOption) {
                                return; // User canceled
                            }

                            const nameType = selectedOption.value;

                            // Create mapping from XML based on selected name type
                            const xmlBooks: Record<string, any> = {};
                            books.forEach((book: any) => {
                                const abbr = book.code;
                                let name = book[nameType]; // Use the selected name type

                                if (abbr && name) {
                                    xmlBooks[abbr] = name;
                                }
                            });

                            // Update the UI with new imported book names
                            const updatedBooks = mergedBooks.map((book) => {
                                // If XML contains a value for this book, use it
                                if (xmlBooks[book.abbr]) {
                                    book.name = xmlBooks[book.abbr];
                                }
                                return book;
                            });

                            // Update the webview with new book data
                            panel.webview.html = getWebviewContent(updatedBooks, {
                                importSource: `${path.basename(xmlFilePath.fsPath)} (${selectedOption.label})`,
                            });

                            // Show success message
                            vscode.window.showInformationMessage(
                                `Book names imported from XML (${selectedOption.label})`
                            );
                        } catch (error: any) {
                            vscode.window.showErrorMessage(
                                `Error processing XML data: ${error.message}`
                            );
                        }
                    });
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Error importing XML: ${error.message}`);
                }
                break;
            }
        }
    });
}

function getWebviewContent(books: any[], options: { importSource?: string } = {}) {
    // Escape HTML utility
    const escapeHtml = (unsafe: string) =>
        unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

    // Table rows
    const rows = books
        .map(
            (book, i) => `
        <tr>
            <td>${escapeHtml(book.abbr)}</td>
            <td>${escapeHtml(book.defaultName)}</td>
            <td><input type="text" data-idx="${i}" value="${escapeHtml(book.name)}" placeholder="(default)" style="width: 100%" /></td>
        </tr>
    `
        )
        .join("");

    // Import source notice
    const importNotice = options.importSource
        ? `<div class="import-notice">Imported from: ${escapeHtml(options.importSource)}</div>`
        : "";

    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 0; }
        .container { padding: 24px; max-width: 700px; margin: 0 auto; }
        h2 { margin-top: 0; }
        .toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th, td { padding: 8px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
        th { background: var(--vscode-editorWidget-background); text-align: left; }
        input[type="text"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 4px 8px; }
        .actions { display: flex; gap: 12px; justify-content: flex-end; }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; padding: 8px 16px; cursor: pointer; font-size: 1em; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .desc { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
        .import-notice { 
            background-color: var(--vscode-editorWidget-background);
            border-left: 3px solid var(--vscode-button-background);
            padding: 8px 12px;
            margin-bottom: 16px;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>Edit Book Names</h2>
        <div class="desc">Customize the display names for each Bible book. Leave blank to use the default English name. Only changed names will be saved.</div>
        
        ${importNotice}
        
        <div class="toolbar">
            <button type="button" id="importXmlBtn">Import from XML</button>
        </div>
        
        <form id="bookForm">
            <table>
                <thead>
                    <tr><th>Abbr</th><th>Default Name</th><th>Custom Name</th></tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
            <div class="actions">
                <button type="button" class="secondary" id="cancelBtn">Cancel</button>
                <button type="submit" id="saveBtn">Save</button>
            </div>
        </form>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const form = document.getElementById('bookForm');
        const cancelBtn = document.getElementById('cancelBtn');
        const importXmlBtn = document.getElementById('importXmlBtn');
        
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const books = [];
            document.querySelectorAll('tbody tr').forEach((row, i) => {
                const abbr = row.children[0].textContent;
                const defaultName = row.children[1].textContent;
                const name = row.querySelector('input').value;
                books.push({ abbr, defaultName, name });
            });
            vscode.postMessage({ command: 'save', books });
        });
        
        cancelBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });
        
        importXmlBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'importXml' });
        });
    </script>
</body>
</html>`;
}
