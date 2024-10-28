import { verseRefRegex } from "src/utils/verseRefUtils";
import * as vscode from "vscode";

export enum BibleValidationErrorCode {
    INVALID_FORMAT = "INVALID_FORMAT",
    EMPTY_CONTENT = "EMPTY_CONTENT",
    MISSING_VERSES = "MISSING_VERSES",
    INVALID_STRUCTURE = "INVALID_STRUCTURE",
}

export interface BibleValidationError {
    code: BibleValidationErrorCode;
    message: string;
    details?: string;
}

export interface BibleValidationResult {
    isValid: boolean;
    errors: BibleValidationError[];
}

export class BibleContentValidator {
    async validateContent(fileUri: vscode.Uri): Promise<BibleValidationResult> {
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const textContent = Buffer.from(content).toString("utf-8");

            const errors: BibleValidationError[] = [];

            // Check for empty content
            if (!textContent.trim()) {
                errors.push({
                    code: BibleValidationErrorCode.EMPTY_CONTENT,
                    message: "The Bible content is empty",
                });
            }

            // Basic structure validation
            if (!this.hasValidStructure(textContent)) {
                errors.push({
                    code: BibleValidationErrorCode.INVALID_STRUCTURE,
                    message: "The Bible content does not follow the required structure",
                });
            }

            // Check for verse content
            if (!this.hasVerseContent(textContent)) {
                errors.push({
                    code: BibleValidationErrorCode.MISSING_VERSES,
                    message: "No valid verse content found in the Bible text",
                });
            }

            return {
                isValid: errors.length === 0,
                errors,
            };
        } catch (error) {
            return {
                isValid: false,
                errors: [
                    {
                        code: BibleValidationErrorCode.INVALID_FORMAT,
                        message: "Failed to read or parse Bible content",
                        details: error instanceof Error ? error.message : "Unknown error",
                    },
                ],
            };
        }
    }

    private hasValidStructure(content: string): boolean {
        // Expected format: Each line should be "BookName Chapter:Verse Text"
        const lines = content.split("\n").filter((line) => line.trim());
        const structureRegex = /^[\w\s]+\s+\d+:\d+\s+.+$/;

        return lines.some((line) => structureRegex.test(line.trim()));
    }

    private hasVerseContent(content: string): boolean {
        const lines = content.split("\n").filter((line) => line.trim());
        const verseRefRegex = /^[\w\s]+\s+\d+:\d+\s*/;

        return lines.some((line) => {
            const verseContent = line.trim().replace(verseRefRegex, "");
            return verseContent.length > 0;
        });
    }
}
