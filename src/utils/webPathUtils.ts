import * as vscode from 'vscode';

/**
 * Web-compatible path utilities that use URIs instead of file system paths
 */
export class WebPathUtils {
    /**
     * Get the basename of a URI
     */
    static getBasename(uri: vscode.Uri): string {
        const path = uri.path;
        const parts = path.split('/');
        return parts[parts.length - 1];
    }

    /**
     * Get the extension of a URI
     */
    static getExtension(uri: vscode.Uri): string {
        const basename = this.getBasename(uri);
        const parts = basename.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    }

    /**
     * Get the directory name of a URI
     */
    static getDirname(uri: vscode.Uri): string {
        const path = uri.path;
        const parts = path.split('/');
        parts.pop();
        return parts.join('/');
    }

    /**
     * Join path segments with a URI
     */
    static join(uri: vscode.Uri, ...paths: string[]): vscode.Uri {
        return vscode.Uri.joinPath(uri, ...paths);
    }

    /**
     * Check if a URI ends with a specific extension
     */
    static hasExtension(uri: vscode.Uri, extension: string): boolean {
        return this.getExtension(uri) === extension.toLowerCase();
    }

    /**
     * Get the name without extension
     */
    static getNameWithoutExtension(uri: vscode.Uri): string {
        const basename = this.getBasename(uri);
        const extension = this.getExtension(uri);
        return extension ? basename.slice(0, -(extension.length + 1)) : basename;
    }
} 