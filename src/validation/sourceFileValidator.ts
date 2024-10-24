import * as vscode from "vscode";
import { SourceFileValidationOptions, ValidationResult, ValidationError } from "../../types";
import { ValidationErrorCode } from "../../types/enums";

const DEFAULT_OPTIONS: SourceFileValidationOptions = {
    maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
    supportedExtensions: [".txt", ".usfm", ".usx", ".xml"],
    minDiskSpaceBytes: 100 * 1024 * 1024, // 100MB
};

export class SourceFileValidator {
    constructor(private options: SourceFileValidationOptions = DEFAULT_OPTIONS) {}

    async validateSourceFile(fileUri: vscode.Uri): Promise<ValidationResult> {
        const errors: ValidationError[] = [];

        try {
            // File size validation
            const fileStat = await vscode.workspace.fs.stat(fileUri);
            if (this.options.maxFileSizeBytes && fileStat.size > this.options.maxFileSizeBytes) {
                errors.push({
                    code: ValidationErrorCode.FILE_SIZE_EXCEEDED,
                    message: `File size exceeds maximum allowed size of ${this.options.maxFileSizeBytes} bytes`,
                    details: { actualSize: fileStat.size },
                });
            }

            // File type validation
            const fileExtension = fileUri.path.toLowerCase().split(".").pop();
            if (
                this.options.supportedExtensions &&
                !this.options.supportedExtensions.includes(`.${fileExtension}`)
            ) {
                errors.push({
                    code: ValidationErrorCode.UNSUPPORTED_FILE_TYPE,
                    message: `Unsupported file type: ${fileExtension}`,
                    details: { supportedTypes: this.options.supportedExtensions },
                });
            }

            // Disk space validation
            if (this.options.minDiskSpaceBytes) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const freeSpace = await this.getAvailableDiskSpace(workspaceFolder.uri);
                    if (freeSpace < this.options.minDiskSpaceBytes) {
                        errors.push({
                            code: ValidationErrorCode.INSUFFICIENT_SPACE,
                            message: `Insufficient disk space. Required: ${this.options.minDiskSpaceBytes} bytes`,
                            details: { availableSpace: freeSpace },
                        });
                    }
                }
            }

            // Content validation (basic check)
            const content = await vscode.workspace.fs.readFile(fileUri);
            const isValidContent = await this.validateFileContent(content, fileExtension);
            if (!isValidContent) {
                errors.push({
                    code: ValidationErrorCode.INVALID_CONTENT,
                    message: "File content validation failed",
                });
            }
        } catch (error) {
            errors.push({
                code: ValidationErrorCode.SYSTEM_ERROR,
                message: error instanceof Error ? error.message : "Unknown error during validation",
                details: error,
            });
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }

    private async getAvailableDiskSpace(uri: vscode.Uri): Promise<number> {
        // Using workspace.fs to get disk space info
        const stat = await vscode.workspace.fs.stat(uri);
        // Note: This is a simplified version. In production, you'd want to use
        // platform-specific APIs to get actual free space
        return Number.MAX_SAFE_INTEGER; // Placeholder
    }

    private async validateFileContent(
        content: Uint8Array,
        fileExtension?: string
    ): Promise<boolean> {
        // Basic content validation - should be expanded based on file type
        if (!content.length) {
            return false;
        }

        // Add specific validation for different file types
        switch (fileExtension) {
            case "usfm":
                return this.validateUsfmContent(content);
            case "usx":
                return this.validateUsxContent(content);
            default:
                return true;
        }
    }

    private validateUsfmContent(content: Uint8Array): boolean {
        // Basic USFM validation - should be expanded
        const text = new TextDecoder().decode(content);
        return text.includes("\\id") || text.includes("\\h");
    }

    private validateUsxContent(content: Uint8Array): boolean {
        // Basic USX validation - should be expanded
        const text = new TextDecoder().decode(content);
        return text.includes("<usx") && text.includes("</usx>");
    }
}
