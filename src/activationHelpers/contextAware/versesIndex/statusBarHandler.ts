import * as vscode from 'vscode';

export class StatusBarHandler {
    private static instance: StatusBarHandler;
    private statusBar: vscode.StatusBarItem;

    private constructor() {
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.setIndexingIdle();
        this.statusBar.show();
        this.statusBar.command = 'translators-copilot.showIndexOptions';
    }

    public static getInstance(): StatusBarHandler {
        if (!StatusBarHandler.instance) {
            StatusBarHandler.instance = new StatusBarHandler();
        }
        return StatusBarHandler.instance;
    }

    public setIndexingActive(): void {
        this.statusBar.text = '$(sync~spin) Indexing';
        this.statusBar.tooltip = 'Indexing in progress';
    }

    public setIndexingComplete(): void {
        this.statusBar.text = '$(check) Indexing Complete';
        this.statusBar.tooltip = 'Indexing completed successfully';
    }

    public setIndexingIdle(): void {
        this.statusBar.text = '$(database) Index';
        this.statusBar.tooltip = 'Click to show indexing options';
    }

    public dispose(): void {
        this.statusBar.hide();
        this.statusBar.dispose();
    }
}