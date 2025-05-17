import * as vscode from 'vscode';

export class VSCodeFsAdapter {
    constructor(private fs: vscode.FileSystem) {}

    async readFile(filepath: string, options?: { encoding?: string }): Promise<Buffer | string> {
        const uri = vscode.Uri.file(filepath);
        const content = await this.fs.readFile(uri);
        if (options?.encoding) {
            return content.toString();
        }
        return Buffer.from(content);
    }

    async writeFile(filepath: string, data: Buffer | string): Promise<void> {
        const uri = vscode.Uri.file(filepath);
        const content = typeof data === 'string' ? Buffer.from(data) : data;
        await this.fs.writeFile(uri, content);
    }

    async unlink(filepath: string): Promise<void> {
        const uri = vscode.Uri.file(filepath);
        await this.fs.delete(uri);
    }

    async readdir(filepath: string): Promise<string[]> {
        const uri = vscode.Uri.file(filepath);
        const entries = await this.fs.readDirectory(uri);
        return entries.map(([name]) => name);
    }

    async mkdir(filepath: string): Promise<void> {
        const uri = vscode.Uri.file(filepath);
        await this.fs.createDirectory(uri);
    }

    async rmdir(filepath: string): Promise<void> {
        const uri = vscode.Uri.file(filepath);
        await this.fs.delete(uri, { recursive: true });
    }

    async lstat(filepath: string): Promise<{ isDirectory(): boolean }> {
        const uri = vscode.Uri.file(filepath);
        const stat = await this.fs.stat(uri);
        return {
            isDirectory: () => (stat.type & vscode.FileType.Directory) !== 0
        };
    }

    async stat(filepath: string): Promise<{ isDirectory(): boolean }> {
        return this.lstat(filepath);
    }

    // Add missing methods for web compatibility
    async createReadStream(filepath: string): Promise<ReadableStream> {
        const uri = vscode.Uri.file(filepath);
        const content = await this.fs.readFile(uri);
        return new ReadableStream({
            start(controller) {
                controller.enqueue(content);
                controller.close();
            }
        });
    }

    async createWriteStream(filepath: string): Promise<WritableStream> {
        const uri = vscode.Uri.file(filepath);
        const fs = this.fs; // Capture fs reference
        return new WritableStream({
            async write(chunk) {
                const content = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
                await fs.writeFile(uri, content);
            }
        });
    }

    async exists(filepath: string): Promise<boolean> {
        try {
            const uri = vscode.Uri.file(filepath);
            await this.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    async copyFile(src: string, dest: string): Promise<void> {
        const srcUri = vscode.Uri.file(src);
        const destUri = vscode.Uri.file(dest);
        const content = await this.fs.readFile(srcUri);
        await this.fs.writeFile(destUri, content);
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        const oldUri = vscode.Uri.file(oldPath);
        const newUri = vscode.Uri.file(newPath);
        const content = await this.fs.readFile(oldUri);
        await this.fs.writeFile(newUri, content);
        await this.fs.delete(oldUri);
    }

    async access(filepath: string, mode?: number): Promise<void> {
        const uri = vscode.Uri.file(filepath);
        await this.fs.stat(uri);
    }

    async chmod(filepath: string, mode: number): Promise<void> {
        // VSCode web API doesn't support chmod
        return;
    }

    async chown(filepath: string, uid: number, gid: number): Promise<void> {
        // VSCode web API doesn't support chown
        return;
    }

    async utimes(filepath: string, atime: number | Date, mtime: number | Date): Promise<void> {
        // VSCode web API doesn't support utimes
        return;
    }
} 