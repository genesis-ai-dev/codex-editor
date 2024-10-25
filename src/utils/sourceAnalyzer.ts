import * as vscode from "vscode";
import { BookPreview, FileType, SourcePreview, ValidationResult } from "../../types";
import { SourceFileValidator } from "../validation/sourceFileValidator";
import { getFileType } from "./fileTypeUtils";
import { analyzeUsfmContent, analyzeUsxContent, analyzePlainTextContent } from "./contentAnalyzers";

export class SourceAnalyzer {
    constructor(private validator: SourceFileValidator) {}

    async generatePreview(fileUri: vscode.Uri): Promise<SourcePreview> {
        // Validate file
        const validationResult = await this.validator.validateSourceFile(fileUri);

        // Get basic file info
        const fileStat = await vscode.workspace.fs.stat(fileUri);
        const fileType = getFileType(fileUri);

        // Analyze content based on file type
        const content = await vscode.workspace.fs.readFile(fileUri);
        const textContent = new TextDecoder().decode(content);

        let expectedBooks: BookPreview[];

        switch (fileType) {
            case "usfm":
                expectedBooks = await analyzeUsfmContent(textContent);
                break;
            case "usx":
                expectedBooks = await analyzeUsxContent(textContent);
                break;
            default:
                expectedBooks = await analyzePlainTextContent(textContent);
        }

        return {
            fileName: vscode.workspace.asRelativePath(fileUri),
            fileSize: fileStat.size,
            fileType,
            expectedBooks,
            validationResults: [validationResult],
        };
    }
}
