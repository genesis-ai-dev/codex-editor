import * as vscode from 'vscode';

export class StatusBarHandler {
    private static instance: StatusBarHandler;
    private statusBarItem: vscode.StatusBarItem;
    private indexCountsItem: vscode.StatusBarItem;
    private progressBarItem: vscode.StatusBarItem;

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.indexCountsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.progressBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
        this.statusBarItem.show();
        this.indexCountsItem.show();
        this.progressBarItem.show();
    }

    public static getInstance(): StatusBarHandler {
        if (!StatusBarHandler.instance) {
            StatusBarHandler.instance = new StatusBarHandler();
        }
        return StatusBarHandler.instance;
    }

    public setIndexingActive(): void {
        this.statusBarItem.text = "$(sync~spin) Indexing...";
        this.statusBarItem.tooltip = "Translators Copilot is currently indexing";
    }

    public setIndexingComplete(): void {
        this.statusBarItem.text = "$(check) Indexed";
        this.statusBarItem.tooltip = "Translators Copilot indexing complete";
    }

    public updateTranslationProgress(percentage: number): void {
        const barLength = 10;
        const filledLength = Math.round(percentage / 100 * barLength);
        const emptyLength = barLength - filledLength;
        const progressBar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
        this.progressBarItem.text = `$(book) ${progressBar} ${percentage}%`;
        this.progressBarItem.tooltip = `Translation progress: ${percentage}%`;
    }

    public updateIndexCounts(translationPairsCount: number, sourceBibleCount: number): void {
        this.indexCountsItem.text = `$(book) ${translationPairsCount} | $(globe) ${sourceBibleCount}`;
        this.indexCountsItem.tooltip = `Translation Pairs: ${translationPairsCount}, Source Bible: ${sourceBibleCount}`;
    }

    dispose() {
        this.statusBarItem.dispose();
        this.indexCountsItem.dispose();
        this.progressBarItem.dispose();
    }
}