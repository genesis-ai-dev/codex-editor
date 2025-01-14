import * as vscode from "vscode";

interface ICEEditRecord {
    original: string;
    replacement: string;
    leftToken: string;
    rightToken: string;
    frequency: number;
    lastUpdated: number;
}

interface ICECandidateSuggestion {
    original: string;
    replacement: string;
    confidence: "high" | "low";
    frequency: number;
}

export class ICEEdits {
    private iceEditsPath: vscode.Uri;
    private editRecords: Map<string, ICEEditRecord> = new Map();

    constructor(workspaceFolder: string) {
        this.iceEditsPath = vscode.Uri.joinPath(
            vscode.Uri.file(workspaceFolder),
            "files",
            "ice_edits.json"
        );
        this.ensureFileExists();
    }

    private async ensureFileExists(): Promise<void> {
        try {
            await vscode.workspace.fs.stat(this.iceEditsPath);
        } catch (error) {
            if ((error as any).code === "FileNotFound") {
                await vscode.workspace.fs.writeFile(this.iceEditsPath, new Uint8Array());
            } else {
                throw error;
            }
        }
    }

    private async loadEditRecords(): Promise<void> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(this.iceEditsPath);
            const fileString = fileContent.toString();
            const records: Record<string, ICEEditRecord> = fileString ? JSON.parse(fileString) : {};
            this.editRecords = new Map(Object.entries(records));
        } catch (error) {
            console.error("Error loading ICE edit records:", error);
            this.editRecords = new Map();
        }
    }

    private async saveEditRecords(): Promise<void> {
        try {
            const records = Object.fromEntries(this.editRecords);
            await vscode.workspace.fs.writeFile(
                this.iceEditsPath,
                Buffer.from(JSON.stringify(records, null, 2))
            );
        } catch (error) {
            console.error("Error saving ICE edit records:", error);
        }
    }

    private getRecordKey(original: string, leftToken: string, rightToken: string): string {
        return `${leftToken}|${original}|${rightToken}`;
    }

    async recordEdit(
        original: string,
        replacement: string,
        leftToken: string,
        rightToken: string
    ): Promise<void> {
        await this.loadEditRecords();

        const key = this.getRecordKey(original, leftToken, rightToken);
        const existingRecord = this.editRecords.get(key);

        if (existingRecord && existingRecord.replacement === replacement) {
            // Increment frequency for existing identical edit
            this.editRecords.set(key, {
                ...existingRecord,
                frequency: existingRecord.frequency + 1,
                lastUpdated: Date.now(),
            });
        } else {
            // Create new record
            this.editRecords.set(key, {
                original,
                replacement,
                leftToken,
                rightToken,
                frequency: 1,
                lastUpdated: Date.now(),
            });
        }

        await this.saveEditRecords();
    }

    async calculateSuggestions(
        text: string,
        leftToken: string,
        rightToken: string
    ): Promise<ICECandidateSuggestion[]> {
        await this.loadEditRecords();
        const suggestions: ICECandidateSuggestion[] = [];

        // Look for exact matches with context
        const exactKey = this.getRecordKey(text, leftToken, rightToken);
        const exactMatch = this.editRecords.get(exactKey);
        if (exactMatch) {
            suggestions.push({
                original: text,
                replacement: exactMatch.replacement,
                confidence: "high",
                frequency: exactMatch.frequency,
            });
        }

        // Look for matches without context or with partial context
        for (const [key, record] of this.editRecords.entries()) {
            if (key !== exactKey && record.original === text) {
                suggestions.push({
                    original: text,
                    replacement: record.replacement,
                    confidence: "low",
                    frequency: record.frequency,
                });
            }
        }

        // Sort by frequency descending
        return suggestions.sort((a, b) => b.frequency - a.frequency);
    }
}
