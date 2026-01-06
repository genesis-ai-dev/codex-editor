import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * Creates Genesis sample content with full English source text
 * Reads from template file if available, otherwise generates a sample structure
 */
export async function createGenesisSampleContent(
    workspaceFolder: vscode.Uri,
    targetLanguageTag?: string
): Promise<{ sourceUri: vscode.Uri; targetUri: vscode.Uri }> {
    console.log("[genesisSample] Creating Genesis sample content");
    
    const sourceTextsDir = vscode.Uri.joinPath(workspaceFolder, ".project", "sourceTexts");
    const targetFilesDir = vscode.Uri.joinPath(workspaceFolder, "files", "target");

    // Ensure directories exist
    try {
        await vscode.workspace.fs.createDirectory(sourceTextsDir);
        await vscode.workspace.fs.createDirectory(targetFilesDir);
        console.log(`[genesisSample] Created/verified directories`);
    } catch (e) {
        console.log(`[genesisSample] Directories may already exist: ${e}`);
    }

    // Try to read from template file
    // First try extension resources, then fallback to user's example file
    const extensionPath = vscode.extensions.getExtension("project-accelerate.codex-editor-extension")?.extensionPath;
    const templatePaths = [
        extensionPath ? path.join(extensionPath, "resources", "genesis-template.source") : null,
        path.join(
            process.env.HOME || process.env.USERPROFILE || "",
            ".codex-projects",
            "test-eng-x06mru8vur08dqslklcyap",
            ".project",
            "sourceTexts",
            "GEN.source"
        ),
    ].filter((p): p is string => p !== null);

    let sourceContent: any;
    let targetContent: any;
    let templateFound = false;

    for (const templatePath of templatePaths) {
        try {
            if (fs.existsSync(templatePath)) {
                console.log(`[genesisSample] Reading template from: ${templatePath}`);
                const templateData = fs.readFileSync(templatePath, "utf-8");
                sourceContent = JSON.parse(templateData);
                console.log(`[genesisSample] Successfully loaded template with ${sourceContent.cells?.length || 0} cells`);
                templateFound = true;
                break;
            }
        } catch (error) {
            console.warn(`[genesisSample] Could not read template from ${templatePath}: ${error}`);
            continue;
        }
    }

    if (!templateFound) {
        console.warn(`[genesisSample] Template file not found, generating sample structure`);
        // Fallback: Generate a sample structure with first few verses
        sourceContent = generateSampleGenesisSource();
        targetContent = generateSampleGenesisTarget(sourceContent);
    }

    // Generate target content from source (empty values, same structure)
    if (!targetContent) {
        targetContent = generateTargetFromSource(sourceContent);
    }

    const sourceUri = vscode.Uri.joinPath(sourceTextsDir, "GEN.source");
    const targetUri = vscode.Uri.joinPath(targetFilesDir, "GEN.codex");

    try {
        await vscode.workspace.fs.writeFile(
            sourceUri,
            Buffer.from(JSON.stringify(sourceContent, null, 2), "utf-8")
        );
        console.log(`[genesisSample] Created source file: ${sourceUri.fsPath}`);

        await vscode.workspace.fs.writeFile(
            targetUri,
            Buffer.from(JSON.stringify(targetContent, null, 2), "utf-8")
        );
        console.log(`[genesisSample] Created target file: ${targetUri.fsPath}`);
    } catch (error) {
        console.error(`[genesisSample] Error writing files: ${error}`);
        throw error;
    }

    return { sourceUri, targetUri };
}

/**
 * Generates target file structure from source, with empty values
 */
function generateTargetFromSource(sourceContent: any): any {
    if (!sourceContent || !sourceContent.cells) {
        throw new Error("Invalid source content structure");
    }

    return {
        cells: sourceContent.cells.map((cell: any) => ({
            kind: cell.kind,
            value: "", // Empty value for translation
            languageId: cell.languageId,
            metadata: {
                ...cell.metadata,
                // Keep all metadata including originalText
            },
        })),
    };
}

/**
 * Fallback: Generate a sample Genesis structure (first few verses)
 * This is used if the template file is not available
 */
function generateSampleGenesisSource(): any {
    const verses = [
        { verse: 1, text: "In the beginning God created the heavens and the earth." },
        { verse: 2, text: "And the earth was waste and void; and darkness was upon the face of the deep: and the Spirit of God moved upon the face of the waters." },
        { verse: 3, text: "And God said, Let there be light: and there was light." },
        { verse: 4, text: "And God saw the light, that it was good: and God divided the light from the darkness." },
        { verse: 5, text: "And God called the light Day, and the darkness he called Night. And there was evening and there was morning, one day." },
    ];

    return {
        cells: verses.map((v) => ({
            kind: 2,
            value: v.text,
            languageId: "html",
            metadata: {
                id: `GEN 1:${v.verse}`,
                type: "verse",
                edits: [],
                book: "GEN",
                chapter: 1,
                verse: v.verse,
                cellLabel: String(v.verse),
                originalText: v.text,
                data: {},
            },
        })),
    };
}

/**
 * Generate target from sample source
 */
function generateSampleGenesisTarget(sourceContent: any): any {
    return generateTargetFromSource(sourceContent);
}

