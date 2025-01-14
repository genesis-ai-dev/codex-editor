import * as vscode from "vscode";
import { diffWords } from "diff";
import { tokenizeText } from "@/utils/nlpUtils";

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

    private stripHtml(text: string): string {
        // Remove HTML tags
        let strippedText = text.replace(/<[^>]*>/g, "");
        // Remove common HTML entities
        strippedText = strippedText.replace(/&nbsp;/g, " ");
        // Keep apostrophe or typographic apostrophe
        strippedText = strippedText.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#34;/g, "");
        // Remove other numeric HTML entities
        strippedText = strippedText.replace(/&#\d+;/g, "");
        // Remove any remaining & entities
        strippedText = strippedText.replace(/&[a-zA-Z]+;/g, "");
        return strippedText;
    }

    /**
     * Performs a full diff-based recording of ICE edits.
     * Strips HTML, diffs old/new text, and calls recordEdit(token, replacement, left, right).
     */
    public async recordFullEdit(oldText: string, newText: string): Promise<void> {
        // 1) Strip HTML
        const cleanOld = this.stripHtml(oldText);
        const cleanNew = this.stripHtml(newText);

        // 2) Tokenize both texts for context
        const oldTokens = tokenizeText({ method: "whitespace", text: cleanOld });
        const newTokens = tokenizeText({ method: "whitespace", text: cleanNew });

        // 3) Diff them
        const diff = diffWords(cleanOld, cleanNew);

        console.log("[RYDER] diff", { cleanOld, cleanNew, oldTokens, newTokens, diff });

        let oldIndex = 0;
        let skipNextAdded = false; // Flag to skip processing added parts that were already handled as replacements

        for (let i = 0; i < diff.length; i++) {
            const part = diff[i];

            if (part.removed) {
                // Handle removals (with potential replacements)
                const removedTokens = part.value.split(/\s+/);
                console.log("[ICE] Processing removed tokens:", {
                    removedTokens,
                    oldIndex,
                    partValue: part.value,
                });

                for (let t = 0; t < removedTokens.length; t++) {
                    const token = removedTokens[t];
                    if (!token) continue; // Skip empty tokens

                    // Get the actual preceding and following tokens from the original text
                    const leftToken = oldIndex > 0 ? oldTokens[oldIndex - 1] : "";
                    const rightToken =
                        oldIndex + 1 < oldTokens.length ? oldTokens[oldIndex + 1] : "";

                    // Look ahead for added part to mark this as a replacement
                    const nextPart = diff[i + 1];
                    if (nextPart && nextPart.added) {
                        const addedTokens = nextPart.value.split(/\s+/).filter((t) => t); // Filter out empty tokens
                        console.log("[ICE] Found replacement:", {
                            removedToken: token,
                            addedTokens,
                            tokenIndex: t,
                            context: { left: leftToken, right: rightToken },
                        });

                        if (t < addedTokens.length) {
                            await this.recordEdit(token, addedTokens[t], leftToken, rightToken);
                        }
                        skipNextAdded = true; // Skip processing this added part later
                    } else {
                        // Only record removal if we have some context
                        if (leftToken || rightToken) {
                            await this.recordEdit(token, "", leftToken, rightToken);
                        }
                    }
                    oldIndex++;
                }
            } else if (part.added && !skipNextAdded) {
                // Handle pure additions (no preceding removal)
                const addedTokens = part.value.split(/\s+/).filter((t) => t); // Filter out empty tokens
                console.log("[ICE] Processing pure additions:", {
                    addedTokens,
                    oldIndex,
                    partValue: part.value,
                });

                for (let t = 0; t < addedTokens.length; t++) {
                    const token = addedTokens[t];
                    if (!token) continue; // Skip empty tokens

                    // For pure additions, get the actual surrounding context
                    const contextIndex = oldIndex > 0 ? oldIndex - 1 : 0;
                    const leftToken = contextIndex > 0 ? oldTokens[contextIndex - 1] : "";
                    const rightToken =
                        contextIndex < oldTokens.length ? oldTokens[contextIndex] : "";

                    // Only record addition if we have some context
                    if (leftToken || rightToken) {
                        console.log("[ICE] Recording pure addition:", {
                            addedToken: token,
                            context: { left: leftToken, right: rightToken },
                        });
                        await this.recordEdit("", token, leftToken, rightToken);
                    }
                }
            } else {
                // Skip unchanged tokens
                const skipTokens = part.value.split(/\s+/).filter((t) => t).length;
                console.log("[ICE] Skipping unchanged tokens:", {
                    count: skipTokens,
                    value: part.value,
                });
                oldIndex += skipTokens;
            }

            // Reset the skip flag after processing an added part
            if (part.added) {
                skipNextAdded = false;
            }
        }
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
        // Don't create records with all empty values
        if (!original && !leftToken && !rightToken) {
            return ""; // Return empty string instead of null
        }
        return `${leftToken}|${original}|${rightToken}`;
    }

    async recordEdit(
        original: string,
        replacement: string,
        leftToken: string,
        rightToken: string
    ): Promise<void> {
        // Skip if trying to record an empty edit
        if (!original && !replacement) {
            return;
        }

        console.log("[RYDER] recordEdit called from ICEEdits class", {
            original,
            replacement,
            leftToken,
            rightToken,
        });
        await this.loadEditRecords();

        const key = this.getRecordKey(original, leftToken, rightToken);
        // Skip if key is empty (all empty values)
        if (!key) {
            return;
        }

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
        if (exactKey) {
            const exactMatch = this.editRecords.get(exactKey);
            if (exactMatch && exactMatch.replacement !== text) {
                // Don't suggest the same text
                suggestions.push({
                    original: text,
                    replacement: exactMatch.replacement,
                    confidence: "high",
                    frequency: exactMatch.frequency,
                });
            }
        }

        // Look for matches with partial context
        for (const [key, record] of this.editRecords.entries()) {
            if (key !== exactKey && record.original === text) {
                // Only add if we haven't already suggested this replacement
                if (!suggestions.some((s) => s.replacement === record.replacement)) {
                    suggestions.push({
                        original: text,
                        replacement: record.replacement,
                        confidence: "low",
                        frequency: record.frequency,
                    });
                }
            }
        }

        // Sort by frequency descending
        return suggestions.sort((a, b) => b.frequency - a.frequency);
    }
}
