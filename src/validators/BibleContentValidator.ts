import { verseRefRegex } from "../utils/verseRefUtils";
import * as vscode from "vscode";

export enum BibleValidationErrorCode {
    INVALID_FORMAT = "INVALID_FORMAT",
    EMPTY_CONTENT = "EMPTY_CONTENT",
    MISSING_VERSES = "MISSING_VERSES",
}

export interface BibleValidationError {
    code: BibleValidationErrorCode;
    message: string;
    details?: string;
}

export interface BibleValidationResult {
    isValid: boolean;
    errors: BibleValidationError[];
    validLines: string[];
    validLineIndices: number[];
}

export class BibleContentValidator {
    async validateContent(fileUri: vscode.Uri): Promise<BibleValidationResult> {
        try {
            console.log("Validating file:", fileUri.fsPath);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const textContent = Buffer.from(content).toString("utf-8");
            const lines = textContent.split(/\r?\n/);

            console.log("Found lines:", lines.length);
            const errors: BibleValidationError[] = [];
            const validLines: string[] = [];
            const validLineIndices: number[] = [];

            // Check for completely empty content
            if (lines.length === 0) {
                errors.push({
                    code: BibleValidationErrorCode.EMPTY_CONTENT,
                    message: "The Bible content is empty",
                });
                return { isValid: false, errors, validLines: [], validLineIndices: [] };
            }

            // Filter and collect valid lines
            lines.forEach((line, index) => {
                if (this.isValidVerseLine(line)) {
                    validLines.push(line);
                    validLineIndices.push(index);
                }
            });

            // Check if we have any valid content
            if (validLines.length === 0) {
                errors.push({
                    code: BibleValidationErrorCode.MISSING_VERSES,
                    message: "No valid verse content found",
                    details: "The Bible text should contain at least some valid verses",
                });
            }

            return {
                isValid: validLines.length > 0,
                errors,
                validLines,
                validLineIndices,
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
                validLines: [],
                validLineIndices: [],
            };
        }
    }

    private isValidVerseLine(line: string): boolean {
        const trimmedLine = line.trim();

        // Totallympty lines are considered an error
        if (trimmedLine.length === 0) {
            return false;
        }

        // verseRefRegex should be in line
        const match = trimmedLine.match(verseRefRegex);
        if (!match) {
            return false;
        }

        // Basic checks for valid text content
        return trimmedLine.length >= 2; // At least 2 characters
    }
}
