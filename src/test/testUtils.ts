import * as vscode from 'vscode';
import * as path from 'path';

export async function createTestFile(fileName: string, content: string): Promise<vscode.Uri> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    const testFileUri = vscode.Uri.joinPath(workspaceFolder.uri, '.test', fileName);
    
    // Ensure test directory exists
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, '.test'));
    
    // Write test file
    await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(content, 'utf8'));
    
    return testFileUri;
}

export async function cleanupTestFile(fileUri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(fileUri);
    } catch (error) {
        console.error(`Failed to cleanup test file: ${error}`);
    }
}
