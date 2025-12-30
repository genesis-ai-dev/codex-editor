import * as vscode from "vscode";

/**
 * Creates sample subtitle/caption content
 * Returns sample SRT file with timestamps
 */
export async function createSubtitleSampleContent(
    workspaceFolder: vscode.Uri
): Promise<{ sourceUri: vscode.Uri; targetUri: vscode.Uri }> {
    // Put subtitle files in files/ directory (not sourceTexts since they're not .source files)
    const filesDir = vscode.Uri.joinPath(workspaceFolder, "files");
    
    // Ensure directory exists
    try {
        await vscode.workspace.fs.createDirectory(filesDir);
    } catch {
        // Directory might already exist
    }

    // Create source SRT file
    const sourceContent = `1
00:00:00,000 --> 00:00:03,500
Welcome to our video tutorial.

2
00:00:03,500 --> 00:00:07,200
Today we'll learn about translation workflows.

3
00:00:07,200 --> 00:00:11,800
This is a sample subtitle file for demonstration.

4
00:00:11,800 --> 00:00:15,400
You can edit these subtitles and translate them.

5
00:00:15,400 --> 00:00:19,000
Each subtitle has a start and end timestamp.
`;

    // Create target SRT file (empty for translation)
    const targetContent = `1
00:00:00,000 --> 00:00:03,500


2
00:00:03,500 --> 00:00:07,200


3
00:00:07,200 --> 00:00:11,800


4
00:00:11,800 --> 00:00:15,400


5
00:00:15,400 --> 00:00:19,000

`;

    const sourceUri = vscode.Uri.joinPath(filesDir, "sample-video.srt");
    const targetUri = vscode.Uri.joinPath(filesDir, "sample-video-target.srt");

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

