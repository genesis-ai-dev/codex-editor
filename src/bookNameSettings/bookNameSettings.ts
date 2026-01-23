import * as vscode from "vscode";
import * as xml2js from "xml2js";

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
