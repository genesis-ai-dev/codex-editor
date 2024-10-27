import * as vscode from "vscode";
import { BookPreview, FileType, SourcePreview, ValidationResult } from "../../types";
import { SourceFileValidator } from "./sourceFileValidator";
import { getFileType } from "../utils/fileTypeUtils";
import {
    analyzeUsfmContent,
    analyzeUsxContent,
    analyzePlainTextContent,
} from "../utils/contentAnalyzers";
import { SourceTransformer } from "./sourceTransformer";

export class SourceAnalyzer {
    private transformer: SourceTransformer;

    constructor(private validator: SourceFileValidator) {
        this.transformer = new SourceTransformer();
    }

    async generatePreview(fileUri: vscode.Uri): Promise<SourcePreview> {
        // Validate file
        const validationResult = await this.validator.validateSourceFile(fileUri);

        // Get basic file info
        const fileStat = await vscode.workspace.fs.stat(fileUri);
        const fileType = getFileType(fileUri);

        // Get original content
        const content = await vscode.workspace.fs.readFile(fileUri);
        const textContent = new TextDecoder().decode(content);

        // Analyze content based on file type
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

        // Generate transformed content
        const transformedContent = await this.transformer.transformToNotebooks(fileUri);

        return {
            fileName: vscode.workspace.asRelativePath(fileUri),
            fileSize: fileStat.size,
            fileType,
            type: "source",
            original: {
                preview: textContent.slice(0, 1000), // First 1000 chars as preview
                validationResults: [validationResult],
            },
            transformed: {
                books: expectedBooks,
                sourceNotebooks: transformedContent.sourceNotebooks,
                codexNotebooks: transformedContent.codexNotebooks,
                validationResults: transformedContent.validationResults,
            },
        };
    }
}
