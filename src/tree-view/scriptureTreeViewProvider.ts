import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class Node extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: 'notebook' | 'chapter',
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
    }
}

export class CodexNotebookProvider implements vscode.TreeDataProvider<Node> {

    private _onDidChangeTreeData: vscode.EventEmitter<Node | undefined | void> = new vscode.EventEmitter<Node | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<Node | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string | undefined) {
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: Node): vscode.TreeItem {
        return element;
    }

    getChildren(element?: Node): Promise<Node[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No notebooks in empty workspace');
            return Promise.resolve([]);
        }

        if (element) {
            if (element.type === 'notebook') {
                // Read the chapters from the .codex file
                const notebookPath = path.join(this.workspaceRoot, 'drafts', 'Bible', `${element.label}.codex`);
                const chapters = this.getChaptersInNotebook(notebookPath);
                return Promise.resolve(chapters);
            } else {
                // Handle the case when element.type is not 'notebook'
                return Promise.resolve([]);
            }
        } else {
            // Read the .codex files from the drafts/Bible directory
            const notebooksPath = path.join(this.workspaceRoot, 'drafts', 'Bible');
            const notebooks = this.getNotebooksInDirectory(notebooksPath);
            return Promise.resolve(notebooks);
        }
    }

    private getNotebooksInDirectory(dirPath: string): Node[] {
        if (!fs.existsSync(dirPath)) {
            return [];
        }

        const files = fs.readdirSync(dirPath);
        const notebooks = files.filter(file => path.extname(file) === '.codex')
            .map(file => new Node(path.basename(file, '.codex'), 'notebook', vscode.TreeItemCollapsibleState.Collapsed));

        return notebooks;
    }

    private getChaptersInNotebook(notebookPath: string): Node[] {
        // Read the .codex file and create a Node for each chapter
        // ...
        return [];
    }

    private pathExists(p: string): boolean {
        try {
            fs.accessSync(p);
        } catch (err) {
            return false;
        }

        return true;
    }
}


