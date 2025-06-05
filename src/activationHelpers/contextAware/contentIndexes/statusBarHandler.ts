import * as vscode from "vscode";

export class IndexingStatusBarHandler {
    private static instance: IndexingStatusBarHandler;
    private statusBarItem: vscode.StatusBarItem;
    private indexCountsItem: vscode.StatusBarItem;
    private progressBarItem: vscode.StatusBarItem;

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.indexCountsItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.progressBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);

        // Add command to status bar item
        this.statusBarItem.command = 'translators-copilot.forceReindex';
        
        this.statusBarItem.show();
        this.indexCountsItem.show();
        this.progressBarItem.show();
    }

    public static getInstance(): IndexingStatusBarHandler {
        if (!IndexingStatusBarHandler.instance) {
            IndexingStatusBarHandler.instance = new IndexingStatusBarHandler();
        }
        return IndexingStatusBarHandler.instance;
    }

    public setIndexingActive(): void {
        this.statusBarItem.text = "$(sync~spin) Indexing...";
        this.statusBarItem.tooltip = "Translators Copilot is currently indexing. Click to force reindex.";
    }

    public setIndexingComplete(): void {
        this.statusBarItem.text = "$(check) Indexed";
        this.statusBarItem.tooltip = "Translators Copilot indexing complete. Click to force reindex.";
    }

    public updateTranslationProgress(percentage: number): void {
        const barLength = 10;
        const filledLength = Math.round((percentage / 100) * barLength);
        const emptyLength = barLength - filledLength;
        const progressBar = "█".repeat(filledLength) + "░".repeat(emptyLength);
        this.progressBarItem.text = `$(book) ${progressBar} ${percentage}%`;
        this.progressBarItem.tooltip = `Translation progress: ${percentage}%`;
    }

    public updateIndexCounts(translationPairsCount: number, sourceTextCount: number): void {
        this.indexCountsItem.text = `$(book) ${translationPairsCount} | $(globe) ${sourceTextCount}`;
        this.indexCountsItem.tooltip = `Translation Pairs: ${translationPairsCount}, Source Bible: ${sourceTextCount}`;
    }

    dispose() {
        this.statusBarItem.dispose();
        this.indexCountsItem.dispose();
        this.progressBarItem.dispose();
    }
}
