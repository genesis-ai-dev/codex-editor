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
    rejected?: boolean;
}

interface ICECandidateSuggestion {
    original: string;
    replacement: string;
    confidence: "high" | "low";
    frequency: number;
    leftToken: string;
    rightToken: string;
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

        let oldIndex = 0;
        let skipNextAdded = false; // Flag to skip processing added parts that were already handled as replacements

        for (let i = 0; i < diff.length; i++) {
            const part = diff[i];

            if (part.removed) {
                // Handle removals (with potential replacements)
                const removedTokens = part.value.split(/\s+/);

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
                        await this.recordEdit("", token, leftToken, rightToken);
                    }
                }
            } else {
                // Skip unchanged tokens
                const skipTokens = part.value.split(/\s+/).filter((t) => t).length;
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

    private async loadEditRecords(): Promise<Record<string, ICEEditRecord>> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(this.iceEditsPath);
            const fileString = fileContent.toString();
            const records: Record<string, ICEEditRecord> = fileString ? JSON.parse(fileString) : {};

            // Filter out rejected records when loading
            const filteredRecords = Object.fromEntries(
                Object.entries(records).filter(([_, record]) => !record.rejected)
            );

            // Update the in-memory records
            this.editRecords = new Map(Object.entries(filteredRecords));

            // Return all records (including rejected ones) for reference
            return records;
        } catch (error) {
            console.error("Error loading ICE edit records:", error);
            return {};
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
        currentToken: string,
        leftToken: string,
        rightToken: string
    ): Promise<Array<{ replacement: string; confidence: string; frequency: number }>> {
        console.log("[RYDER] Calculating suggestions for:", {
            currentToken,
            leftToken,
            rightToken,
        });

        const allRecords = await this.loadEditRecords();
        console.log("[RYDER] allRecords details:", allRecords);

        const suggestions: Array<{ replacement: string; confidence: string; frequency: number }> =
            [];

        for (const [key, record] of Object.entries(allRecords || {})) {
            // Skip rejected records
            if (record.rejected) {
                console.log("[RYDER] Skipping rejected record:", { key, record });
                continue;
            }

            console.log("[RYDER] Comparing record:", {
                key,
                recordOriginal: record.original,
                recordReplacement: record.replacement,
                expectedOriginal: currentToken,
                expectedReplacement: record.replacement,
                recordLeft: record.leftToken,
                recordRight: record.rightToken,
                currentLeft: leftToken,
                currentRight: rightToken,
            });

            const {
                original: recordOriginal,
                replacement: recordReplacement,
                leftToken: recordLeftToken,
                rightToken: recordRightToken,
                rejected: recordRejected,
            } = record;

            // Only add suggestion if it matches exactly and isn't rejected
            if (
                recordOriginal === currentToken &&
                recordLeftToken === leftToken &&
                recordRightToken === rightToken &&
                !recordRejected // Double-check rejection status
            ) {
                console.log("[RYDER] found matching record", { key, record });
                suggestions.push({
                    replacement: record.replacement,
                    confidence: "high",
                    frequency: record.frequency || 1,
                });
            }
        }

        console.log("[RYDER] Final suggestions:", suggestions);
        return suggestions;
    }

    /**
     * Mark an edit suggestion as rejected
     */
    async rejectEdit(
        original: string,
        replacement: string,
        leftToken: string,
        rightToken: string
    ): Promise<void> {
        console.log("[RYDER] rejectEdit called from ICEEdits class", {
            original,
            replacement,
            leftToken,
            rightToken,
        });
        await this.loadEditRecords();

        // Load all records including rejected ones
        const fileContent = await vscode.workspace.fs.readFile(this.iceEditsPath);
        const fileString = fileContent.toString();
        const allRecords: Record<string, ICEEditRecord> = fileString ? JSON.parse(fileString) : {};

        // Log all record keys to help debug
        console.log("[RYDER] allRecords details:", JSON.stringify(allRecords, null, 2));

        // Find the record by matching fields directly
        const entries = Object.entries(allRecords);

        // Debug each comparison
        entries.forEach(([key, record]) => {
            console.log("[RYDER] Comparing record:", {
                key,
                recordOriginal: record.original,
                recordReplacement: record.replacement,
                expectedOriginal: original,
                expectedReplacement: replacement,
                originalMatches: record.original === original,
                replacementMatches: record.replacement === replacement,
                // Debug the actual string values
                recordOriginalType: typeof record.original,
                recordReplacementType: typeof record.replacement,
                originalType: typeof original,
                replacementType: typeof replacement,
                // Debug string lengths
                recordOriginalLength: record.original.length,
                recordReplacementLength: record.replacement.length,
                originalLength: original.length,
                replacementLength: replacement.length,
                // Debug character codes
                recordOriginalCodes: [...record.original].map((c) => c.charCodeAt(0)),
                recordReplacementCodes: [...record.replacement].map((c) => c.charCodeAt(0)),
                originalCodes: [...original].map((c) => c.charCodeAt(0)),
                replacementCodes: [...replacement].map((c) => c.charCodeAt(0)),
            });
        });

        const matchingEntry = entries.find(([_, record]) => {
            const originalMatch = original === record.original;
            const replacementMatch = replacement === record.replacement;
            const leftTokenMatch = leftToken === record.leftToken;
            const rightTokenMatch = rightToken === record.rightToken;

            return (
                originalMatch &&
                replacementMatch &&
                leftTokenMatch &&
                rightTokenMatch &&
                !record.rejected
            );
        });

        console.log(matchingEntry);

        if (matchingEntry) {
            const [key, record] = matchingEntry;
            console.log("[RYDER] found matching record", { key, record });

            // Create the updated record and verify it has the rejected flag
            const updatedRecord = { ...record, rejected: true };
            console.log("[RYDER] updated record", { updatedRecord });

            allRecords[key] = updatedRecord;
            console.log("[RYDER] allRecords after rejection", JSON.stringify(allRecords, null, 2));

            await vscode.workspace.fs.writeFile(
                this.iceEditsPath,
                Buffer.from(JSON.stringify(allRecords, null, 2))
            );
            console.log("[RYDER] Successfully wrote to file");

            // Update in-memory records
            this.editRecords.delete(key);
        } else {
            // Log why we didn't find a match
            console.log("[RYDER] Did not find matching record for:", {
                original,
                replacement,
                availableRecords: entries.map(([key, record]) => ({
                    key,
                    original: record.original,
                    replacement: record.replacement,
                })),
            });
        }
    }
}
