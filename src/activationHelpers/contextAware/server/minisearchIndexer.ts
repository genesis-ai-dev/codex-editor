import * as vscode from "vscode";
import MiniSearch from 'minisearch';
import { verseRefRegex } from "../../../utils/verseRefUtils";
import { getWorkSpaceFolder } from "../../../utils";

interface MinisearchDoc {
    id: string;
    vref: string;
    book: string;
    chapter: string;
    verse: string;
    content: string;
    uri: string;
    line: number;
    isSourceBible: boolean;
}

class MinisearchIndexer {
    private miniSearch: MiniSearch;
    private workspaceFolder: string | undefined;

    constructor() {
        this.miniSearch = new MiniSearch({
            fields: ['vref', 'book', 'chapter', 'fullVref', 'content'],
            storeFields: ['vref', 'book', 'chapter', 'fullVref', 'content', 'uri', 'line'],
            searchOptions: {
                boost: { vref: 2, fullVref: 3 },
                fuzzy: 0.2
            }
        });
        this.workspaceFolder = getWorkSpaceFolder();
    }

    indexDocument(document: vscode.TextDocument, isSourceBible: boolean = false) {
        const uri = document.uri.toString();
        const lines = document.getText().split('\n');
        lines.forEach((line, lineIndex) => {
            const match = line.match(verseRefRegex);
            if (match) {
                const [vref] = match;
                const [book, chapterVerse] = vref.split(' ');
                const [chapter, verse] = chapterVerse.split(':');
                const content = line.substring(match.index! + match[0].length).trim();
                this.miniSearch.add({
                    id: `${isSourceBible ? 'source' : 'target'}:${uri}:${lineIndex}`,
                    vref,
                    book,
                    chapter,
                    verse,
                    content,
                    uri,
                    line: lineIndex,
                    isSourceBible
                } as MinisearchDoc);
            }
        });
    }

    async indexSourceBible() {
        const allSourceBiblesPath = vscode.Uri.file(
            `${this.workspaceFolder}/.project/sourceTextBibles`
        );
        
        if (this.workspaceFolder) {
            try {
                const files = await vscode.workspace.fs.readDirectory(allSourceBiblesPath);
                const biblePaths = files.filter(([name, type]) => name.endsWith('.bible') && type === vscode.FileType.File);
                
                if (biblePaths.length === 0) {
                    vscode.window.showWarningMessage('No source Bibles found to index.');
                    return;
                }

                for (const [fileName, _] of biblePaths) {
                    const sourcePath = vscode.Uri.joinPath(allSourceBiblesPath, fileName);
                    try {
                        const document = await vscode.workspace.openTextDocument(sourcePath);
                        this.indexDocument(document, true);
                        vscode.window.showInformationMessage(`Indexed source Bible: ${fileName}`);
                    } catch (error) {
                        console.error(`Error reading source Bible ${fileName}:`, error);
                        vscode.window.showErrorMessage(`Failed to read source Bible file: ${fileName}`);
                    }
                }
            } catch (error) {
                console.error('Error reading source Bible directory:', error);
                vscode.window.showErrorMessage('Failed to read source Bible directory.');
            }
        } else {
            vscode.window.showErrorMessage('Workspace folder not found.');
        }
    }

    async indexTargetBible() {
        const config = vscode.workspace.getConfiguration('translators-copilot-server');
        const targetBible = config.get<string>('targetBible');
        if (targetBible && this.workspaceFolder) {
            const targetDraftsPath = vscode.Uri.file(
                `${this.workspaceFolder}/files/target`
            );
            const targetPath = vscode.Uri.joinPath(targetDraftsPath, `${targetBible}.codex`);
            try {
                const document = await vscode.workspace.openTextDocument(targetPath);
                this.indexDocument(document);
            } catch (error) {
                console.error('Error reading target Bible:', error);
                vscode.window.showErrorMessage('Failed to read target Bible file.');
            }
        }
    }

    async indexTargetDrafts() {
        if (this.workspaceFolder) {
            const targetDraftsPath = vscode.Uri.file(
                `${this.workspaceFolder}/files/target`
            );
            const pattern = new vscode.RelativePattern(targetDraftsPath, '**/*.codex');
            const files = await vscode.workspace.findFiles(pattern);

            for (const file of files) {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                    this.indexDocument(document);
                } catch (error) {
                    console.error(`Error reading target draft ${file.fsPath}:`, error);
                }
            }
        }
    }

    async serializeIndex() {
        const minisearchIndexPath = vscode.Uri.file(
            `${this.workspaceFolder}/.vscode/minisearch_index.json`
        );
        const serialized = JSON.stringify(this.miniSearch.toJSON());
        await vscode.workspace.fs.writeFile(minisearchIndexPath, Buffer.from(serialized, 'utf8'));
    }

    async loadSerializedIndex(): Promise<boolean> {
        const minisearchIndexPath = vscode.Uri.file(
            `${this.workspaceFolder}/.vscode/minisearch_index.json`
        );
        try {
            const data = await vscode.workspace.fs.readFile(minisearchIndexPath);
            const serialized = Buffer.from(data).toString('utf8');
            this.miniSearch = MiniSearch.loadJSON(serialized, {
                fields: ['vref', 'book', 'chapter', 'fullVref', 'content'],
                storeFields: ['vref', 'book', 'chapter', 'fullVref', 'content', 'uri', 'line']
            });
            return true;
        } catch (error) {
            console.error('Error loading serialized index:', error);
            return false;
        }
    }

    async initializeIndexing() {
        const loadedIndex = await this.loadSerializedIndex();
        if (!loadedIndex) {
            vscode.window.showInformationMessage(`Building new index`);
            await this.indexSourceBible();
            await this.indexTargetBible();
            await this.indexTargetDrafts();
            vscode.workspace.textDocuments.forEach(doc => this.indexDocument(doc));
            await this.serializeIndex();
        } else {
            vscode.window.showInformationMessage(`Loaded serialized index`);
        }
    }

    updateIndex(event: vscode.TextDocumentChangeEvent) {
        const document = event.document;
        if (document.languageId === 'scripture' || document.fileName.endsWith('.codex')) {
            // Remove old entries for this document
            const docsToRemove = this.miniSearch.search(document.uri.toString(), {
                fields: ['uri'],
                combineWith: 'AND'
            });
            this.miniSearch.removeAll(docsToRemove.map(doc => doc.id));
            // Re-index the document
            this.indexDocument(document);
        }
    }

    search(query: string) {
        return this.miniSearch.search(query);
    }
}

export const minisearchIndexer = new MinisearchIndexer();