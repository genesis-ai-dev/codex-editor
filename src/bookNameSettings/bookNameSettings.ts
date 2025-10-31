import { CustomNotebookMetadata } from "@types";
import * as vscode from "vscode";
import * as xml2js from "xml2js";

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

    // Dynamic import for fs and path
    const fs = await import("fs");
    const path = await import("path");

    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error("No workspace folder is open.");
        panel.dispose();
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Correctly get the extension context - this needs to be passed in or retrieved differently
    // For now, let's assume we can get the extension path this way, but it might need adjustment
    const extension = vscode.extensions.getExtension("project-accelerate.codex-editor-extension");
    if (!extension) {
        vscode.window.showErrorMessage("Could not find the Codex Editor extension.");
        panel.dispose();
        return;
    }
    const extensionPath = extension.extensionPath;

    // Construct the path to the default books JSON relative to the extension's install location
    const defaultBooksPath = path.join(
        extensionPath,
        "webviews/codex-webviews/src/assets/bible-books-lookup.json"
    );
    console.log(`Attempting to load default books from: ${defaultBooksPath}`); // Log the path

    let defaultBooks: any[] = [];
    try {
        const raw = fs.readFileSync(defaultBooksPath, "utf8");
        defaultBooks = JSON.parse(raw);
    } catch (err: any) {
        // Improved error logging
        console.error(`Error loading default book names from ${defaultBooksPath}:`, err);
        vscode.window.showErrorMessage(
            `Could not load default book names. Check console for details. Path: ${defaultBooksPath}. Error: ${err.message}`
        );
        panel.dispose();
        return;
    }

    // Build current overrides from codex metadata (fileDisplayName) instead of localized-books.json
    const displayNameByAbbr: Record<string, string> = {};
    try {
        const codexUris = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceRoot, "files/target/**/*.codex"));
        const serializer = new (await import("../serializer")).CodexContentSerializer();
        for (const uri of codexUris) {
            try {
                const content = await vscode.workspace.fs.readFile(uri);
                const notebookData = await serializer.deserializeNotebook(content, new vscode.CancellationTokenSource().token);
                const abbr = path.basename(uri.fsPath, ".codex");
                const dn = (notebookData.metadata as CustomNotebookMetadata)?.fileDisplayName;
                if (abbr && typeof dn === "string" && dn.trim()) {
                    displayNameByAbbr[abbr] = dn.trim();
                }
            } catch (error) {
                console.error(`Error reading fileDisplayName from ${uri.fsPath}:`, error);
            }
        }
    } catch (error) {
        console.error(`Error reading fileDisplayName from codex files:`, error);
    }

    // Merge for UI: always show all books, use fileDisplayName from metadata if present
    const mergedBooks = defaultBooks.map((book: any) => ({
        abbr: book.abbr,
        defaultName: book.name,
        name: displayNameByAbbr[book.abbr] || "",
        ord: book.ord,
        testament: book.testament,
    }));

    panel.webview.html = getWebviewContent(mergedBooks);

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "save": {
                try {
                    // Only persist non-blank names different from default into codex file metadata
                    const updates = new Map<string, string>(); // abbr -> newName
                    mergedBooks.forEach((book, i) => {
                        const newName = message.books[i]?.name?.trim();
                        if (newName && newName !== book.defaultName) {
                            updates.set(book.abbr, newName);
                        }
                    });

                    if (updates.size === 0) {
                        vscode.window.showInformationMessage("No changes to save");
                        panel.dispose();
                        break;
                    }

                    const rootUri = vscode.Uri.file(workspaceRoot);
                    const codexPattern = new vscode.RelativePattern(rootUri.fsPath, "files/target/**/*.codex");
                    const codexUris = await vscode.workspace.findFiles(codexPattern);
                    const serializer = new (await import("../serializer")).CodexContentSerializer();
                    let updatedCount = 0;

                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Saving book name overrides",
                        cancellable: false,
                    }, async () => {
                        for (const uri of codexUris) {
                            const abbr = path.basename(uri.fsPath, ".codex");
                            const newName = updates.get(abbr);
                            if (!newName) continue;
                            try {
                                const content = await vscode.workspace.fs.readFile(uri);
                                const notebookData = await serializer.deserializeNotebook(content, new vscode.CancellationTokenSource().token);
                                (notebookData.metadata as CustomNotebookMetadata) = {
                                    ...(notebookData.metadata || {}),
                                    fileDisplayName: newName,
                                };
                                const updatedContent = await serializer.serializeNotebook(notebookData, new vscode.CancellationTokenSource().token);
                                await vscode.workspace.fs.writeFile(uri, updatedContent);
                                updatedCount++;
                            } catch (error) {
                                console.error(`Error saving book name to ${uri.fsPath}:`, error);
                            }
                        }
                    });

                    vscode.window.showInformationMessage(`Book names updated in ${updatedCount} file(s)`);
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
                    const xmlFilePath = fileUris[0].fsPath;
                    const xmlContent = fs.readFileSync(xmlFilePath, "utf8");

                    // Parse XML to JSON
                    const parser = new xml2js.Parser({
                        explicitArray: false,
                        mergeAttrs: true,
                    });

                    parser.parseString(xmlContent, async (err: any, result: any) => {
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
                                const name = book[nameType]; // Use the selected name type

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
                                importSource: `${path.basename(xmlFilePath)} (${selectedOption.label})`,
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

function getWebviewContent(books: any[], options: { importSource?: string; } = {}) {
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

export async function importBookNamesFromXmlContent(
    xmlContent: string,
    nameType: 'long' | 'short' | 'abbr' = 'long'
): Promise<boolean> {
    try {
        // Dynamic import for fs and path
        const fs = await import("fs");
        const path = await import("path");

        // Get workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            console.error("No workspace folder is open.");
            return false;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Parse XML to JSON
        const parser = new xml2js.Parser({
            explicitArray: false,
            mergeAttrs: true,
        });

        return new Promise((resolve) => {
            parser.parseString(xmlContent, async (err: any, result: any) => {
                if (err) {
                    console.error(`Failed to parse XML: ${err.message}`);
                    resolve(false);
                    return;
                }

                try {
                    // Extract book data from XML
                    const books = Array.isArray(result.BookNames.book)
                        ? result.BookNames.book
                        : [result.BookNames.book];

                    // Create mapping from XML based on selected name type
                    const xmlBooks: Record<string, any> = {};
                    books.forEach((book: any) => {
                        const abbr = book.code;
                        const name = book[nameType];

                        if (abbr && name) {
                            xmlBooks[abbr] = name;
                        }
                    });

                    // Get the extension for default books
                    const extension = vscode.extensions.getExtension("project-accelerate.codex-editor-extension");
                    if (!extension) {
                        console.error("Could not find the Codex Editor extension.");
                        resolve(false);
                        return;
                    }
                    const extensionPath = extension.extensionPath;
                    const defaultBooksPath = path.join(
                        extensionPath,
                        "webviews/codex-webviews/src/assets/bible-books-lookup.json"
                    );

                    // Load default books
                    const raw = fs.readFileSync(defaultBooksPath, "utf8");
                    const defaultBooks = JSON.parse(raw);

                    // Apply overrides directly to codex metadata
                    const rootUri = vscode.Uri.file(workspaceRoot);
                    const codexPattern = new vscode.RelativePattern(rootUri.fsPath, "files/target/**/*.codex");
                    const codexUris = await vscode.workspace.findFiles(codexPattern);
                    const serializer = new (await import("../serializer")).CodexContentSerializer();
                    let updatedCount = 0;

                    for (const uri of codexUris) {
                        try {
                            const abbr = path.basename(uri.fsPath, ".codex");
                            const customName = xmlBooks[abbr];
                            if (!customName) continue;
                            const content = await vscode.workspace.fs.readFile(uri);
                            const notebookData = await serializer.deserializeNotebook(content, new vscode.CancellationTokenSource().token);
                            (notebookData.metadata) = {
                                ...(notebookData.metadata || {}),
                                fileDisplayName: customName,
                            };
                            const updatedContent = await serializer.serializeNotebook(notebookData, new vscode.CancellationTokenSource().token);
                            await vscode.workspace.fs.writeFile(uri, updatedContent);
                            updatedCount++;
                        } catch (error) {
                            console.error(`Error applying book names to ${uri.fsPath}:`, error);
                        }
                    }

                    vscode.window.showInformationMessage(`Imported book names applied to ${updatedCount} file(s)`);

                    resolve(true);
                } catch (error: any) {
                    console.error(`Error processing XML data: ${error.message}`);
                    resolve(false);
                }
            });
        });
    } catch (error: any) {
        console.error(`Error importing XML: ${error.message}`);
        return false;
    }
}
