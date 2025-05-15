import * as vscode from 'vscode';
import { FsClient } from 'isomorphic-git';

export function createGitFsAdapter(workspaceRoot: vscode.Uri): FsClient {
    return {
        async readFile(filepath: string) {
            const uri = vscode.Uri.joinPath(workspaceRoot, filepath);
            const data = await vscode.workspace.fs.readFile(uri);
            return data;
        },
        async writeFile(filepath: string, data: Uint8Array) {
            const uri = vscode.Uri.joinPath(workspaceRoot, filepath);
            await vscode.workspace.fs.writeFile(uri, data);
        },
        async unlink(filepath: string) {
            const uri = vscode.Uri.joinPath(workspaceRoot, filepath);
            await vscode.workspace.fs.delete(uri);
        },
        async readdir(filepath: string) {
            const uri = vscode.Uri.joinPath(workspaceRoot, filepath);
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries.map(([name, type]) => ({
                name,
                type: type === vscode.FileType.Directory ? 'dir' : 'file'
            }));
        },
        async mkdir(filepath: string) {
            const uri = vscode.Uri.joinPath(workspaceRoot, filepath);
            await vscode.workspace.fs.createDirectory(uri);
        },
        async rmdir(filepath: string) {
            const uri = vscode.Uri.joinPath(workspaceRoot, filepath);
            await vscode.workspace.fs.delete(uri, { recursive: true });
        },
        async lstat(filepath: string) {
            const uri = vscode.Uri.joinPath(workspaceRoot, filepath);
            const stat = await vscode.workspace.fs.stat(uri);
            return {
                type: stat.type === vscode.FileType.Directory ? 'dir' : 'file',
                mode: 0o644,
                size: stat.size,
                mtime: stat.mtime
            };
        },
        async stat(filepath: string) {
            const uri = vscode.Uri.joinPath(workspaceRoot, filepath);
            const stat = await vscode.workspace.fs.stat(uri);
            return {
                type: stat.type === vscode.FileType.Directory ? 'dir' : 'file',
                mode: 0o644,
                size: stat.size,
                mtime: stat.mtime
            };
        }
    };
} 