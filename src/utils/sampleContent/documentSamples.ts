import * as vscode from "vscode";

/**
 * Creates sample company document content
 * Returns sample markdown document
 */
export async function createDocumentSampleContent(
    workspaceFolder: vscode.Uri
): Promise<{ sourceUri: vscode.Uri; targetUri: vscode.Uri }> {
    // Put document files in files/ directory
    const filesDir = vscode.Uri.joinPath(workspaceFolder, "files");
    
    // Ensure directory exists
    try {
        await vscode.workspace.fs.createDirectory(filesDir);
    } catch {
        // Directory might already exist
    }

    // Create source document
    const sourceContent = `# Company Policy Document

## Introduction

This document outlines the key policies and procedures for our organization.

## Section 1: Code of Conduct

All employees are expected to maintain the highest standards of professional behavior. This includes:

- Respectful communication with colleagues
- Adherence to company values
- Professional appearance and demeanor

## Section 2: Work Hours

Standard work hours are Monday through Friday, 9:00 AM to 5:00 PM. Flexible arrangements may be available upon request.

## Section 3: Benefits

Our company offers comprehensive benefits including:

- Health insurance
- Retirement plans
- Paid time off
- Professional development opportunities

## Conclusion

We are committed to creating a positive and productive work environment for all team members.
`;

    // Create target document (empty for translation)
    const targetContent = `# Company Policy Document

## Introduction


## Section 1: Code of Conduct



## Section 2: Work Hours


## Section 3: Benefits



## Conclusion

`;

    const sourceUri = vscode.Uri.joinPath(filesDir, "company-policy.md");
    const targetUri = vscode.Uri.joinPath(filesDir, "company-policy-target.md");

    await vscode.workspace.fs.writeFile(
        sourceUri,
        Buffer.from(sourceContent, "utf-8")
    );
    await vscode.workspace.fs.writeFile(
        targetUri,
        Buffer.from(targetContent, "utf-8")
    );

    return { sourceUri, targetUri };
}

