/**
 * FFmpeg/FFprobe manager that prefers system binaries and only downloads as fallback
 * This dramatically reduces VSIX size while maintaining full functionality
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BinaryInfo {
    path: string;
    source: 'system' | 'downloaded' | 'bundled';
    version?: string;
}

let ffmpegInfo: BinaryInfo | null = null;
let ffprobeInfo: BinaryInfo | null = null;

/**
 * Check if a command is available on the system
 */
async function isCommandAvailable(command: string): Promise<boolean> {
    try {
        const checkCmd = process.platform === 'win32' ? 'where' : 'which';
        await execAsync(`${checkCmd} ${command}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the path to a system binary
 */
async function getSystemBinaryPath(command: string): Promise<string | null> {
    try {
        const checkCmd = process.platform === 'win32' ? 'where' : 'which';
        const { stdout } = await execAsync(`${checkCmd} ${command}`);
        const path = stdout.trim().split('\n')[0]; // Get first match on Windows
        return path || null;
    } catch {
        return null;
    }
}

/**
 * Download platform-specific binaries to extension storage
 */
async function downloadBinaries(context: vscode.ExtensionContext): Promise<{ ffmpeg: string; ffprobe: string } | null> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tar = require('tar');
    const storageUri = context.globalStorageUri;
    
    // Create storage directory if it doesn't exist
    try {
        await vscode.workspace.fs.createDirectory(storageUri);
    } catch {
        // Directory might already exist
    }
    
    const storagePath = storageUri.fsPath;
    const platform = process.platform;
    const arch = process.arch;
    const platformKey = `${platform}-${arch}`;
    
    // Map to installer package names
    // VS Code supports: win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64, linux-arm64, linux-arm
    // Note: Windows 32-bit (win32-ia32) was dropped in VS Code 1.83 (Sept 2023)
    const platformMap: Record<string, { ffmpeg: string; ffprobe: string }> = {
        'win32-x64': { ffmpeg: '4.1.0', ffprobe: '5.0.0' },
        'win32-arm64': { ffmpeg: '4.1.0', ffprobe: '5.0.0' }, // Windows ARM64 (Surface, etc.)
        'darwin-arm64': { ffmpeg: '4.1.5', ffprobe: '5.0.1' }, // Apple Silicon
        'darwin-x64': { ffmpeg: '4.1.0', ffprobe: '5.0.0' }, // Intel Mac
        'linux-x64': { ffmpeg: '4.1.0', ffprobe: '5.0.0' },
        'linux-arm64': { ffmpeg: '4.1.0', ffprobe: '5.0.0' }, // Raspberry Pi 4, ARM servers
        'linux-arm': { ffmpeg: '4.1.0', ffprobe: '5.0.0' }, // Raspberry Pi 3
    };
    
    const versions = platformMap[platformKey];
    if (!versions) {
        vscode.window.showErrorMessage(
            `Audio import not supported on platform: ${platformKey}. ` +
            `Please install FFmpeg manually: https://ffmpeg.org/download.html`
        );
        return null;
    }
    
    const ffmpegDir = path.join(storagePath, 'ffmpeg');
    const ffprobeDir = path.join(storagePath, 'ffprobe');
    
    // Check if already downloaded
    const ffmpegBinary = path.join(ffmpegDir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const ffprobeBinary = path.join(ffprobeDir, platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    
    if (fs.existsSync(ffmpegBinary) && fs.existsSync(ffprobeBinary)) {
        return { ffmpeg: ffmpegBinary, ffprobe: ffprobeBinary };
    }
    
    // Show progress
    return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Downloading audio processing tools...",
        cancellable: false
    }, async (progress) => {
        progress.report({ message: "This only happens once" });
        
        try {
            // Download FFmpeg
            progress.report({ message: "Downloading FFmpeg..." });
            await downloadAndExtractPackage(
                `@ffmpeg-installer/${platformKey}`,
                versions.ffmpeg,
                ffmpegDir
            );
            
            // Download FFprobe
            progress.report({ message: "Downloading FFprobe..." });
            await downloadAndExtractPackage(
                `@ffprobe-installer/${platformKey}`,
                versions.ffprobe,
                ffprobeDir
            );
            
            // Make binaries executable on Unix
            if (platform !== 'win32') {
                fs.chmodSync(ffmpegBinary, 0o755);
                fs.chmodSync(ffprobeBinary, 0o755);
            }
            
            return { ffmpeg: ffmpegBinary, ffprobe: ffprobeBinary };
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to download audio processing tools: ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
        }
    });
}

/**
 * Download and extract a package from npm
 */
async function downloadAndExtractPackage(packageName: string, version: string, destDir: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tar = require('tar');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    
    const tarballUrl = `https://registry.npmjs.org/${packageName}/-/${packageName.split('/')[1]}-${version}.tgz`;
    const tmpFile = path.join(os.tmpdir(), `${packageName.replace('/', '-')}-${Date.now()}.tgz`);
    
    return new Promise((resolve, reject) => {
        https.get(tarballUrl, (response: any) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                https.get(response.headers.location, (redirectResponse: any) => {
                    const fileStream = fs.createWriteStream(tmpFile);
                    redirectResponse.pipe(fileStream);
                    fileStream.on('finish', async () => {
                        fileStream.close();
                        try {
                            if (!fs.existsSync(destDir)) {
                                fs.mkdirSync(destDir, { recursive: true });
                            }
                            await tar.x({ file: tmpFile, cwd: destDir, strip: 1 });
                            fs.unlinkSync(tmpFile);
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    });
                }).on('error', reject);
            } else if (response.statusCode === 200) {
                const fileStream = fs.createWriteStream(tmpFile);
                response.pipe(fileStream);
                fileStream.on('finish', async () => {
                    fileStream.close();
                    try {
                        if (!fs.existsSync(destDir)) {
                            fs.mkdirSync(destDir, { recursive: true });
                        }
                        await tar.x({ file: tmpFile, cwd: destDir, strip: 1 });
                        fs.unlinkSync(tmpFile);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            } else {
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
            }
        }).on('error', reject);
    });
}

/**
 * Initialize and get FFmpeg binary path
 */
export async function getFFmpegPath(context?: vscode.ExtensionContext): Promise<string> {
    if (ffmpegInfo) {
        return ffmpegInfo.path;
    }
    
    // 1. Try system FFmpeg first
    const systemPath = await getSystemBinaryPath('ffmpeg');
    if (systemPath) {
        ffmpegInfo = { path: systemPath, source: 'system' };
        console.log(`[audioProcessor] Using system FFmpeg: ${systemPath}`);
        return systemPath;
    }
    
    // 2. Try to download if context is available
    if (context) {
        const downloaded = await downloadBinaries(context);
        if (downloaded) {
            ffmpegInfo = { path: downloaded.ffmpeg, source: 'downloaded' };
            console.log(`[audioProcessor] Downloaded FFmpeg: ${downloaded.ffmpeg}`);
            return downloaded.ffmpeg;
        }
    }
    
    // 3. Last resort: try bundled version (if any)
    try {
        const req = eval('require') as any;
        const ffmpegInstaller = req('@ffmpeg-installer/ffmpeg');
        if (ffmpegInstaller.path) {
            ffmpegInfo = { path: ffmpegInstaller.path, source: 'bundled' };
            console.log(`[audioProcessor] Using bundled FFmpeg: ${ffmpegInstaller.path}`);
            return ffmpegInstaller.path;
        }
    } catch {
        // No bundled version available
    }
    
    throw new Error(
        'FFmpeg not found. Please install FFmpeg on your system:\n' +
        '  • Windows: choco install ffmpeg\n' +
        '  • macOS: brew install ffmpeg\n' +
        '  • Linux: sudo apt install ffmpeg'
    );
}

/**
 * Initialize and get FFprobe binary path
 */
export async function getFFprobePath(context?: vscode.ExtensionContext): Promise<string> {
    if (ffprobeInfo) {
        return ffprobeInfo.path;
    }
    
    // 1. Try system FFprobe first
    const systemPath = await getSystemBinaryPath('ffprobe');
    if (systemPath) {
        ffprobeInfo = { path: systemPath, source: 'system' };
        console.log(`[audioProcessor] Using system FFprobe: ${systemPath}`);
        return systemPath;
    }
    
    // 2. Try to download if context is available
    if (context) {
        const downloaded = await downloadBinaries(context);
        if (downloaded) {
            ffprobeInfo = { path: downloaded.ffprobe, source: 'downloaded' };
            console.log(`[audioProcessor] Downloaded FFprobe: ${downloaded.ffprobe}`);
            return downloaded.ffprobe;
        }
    }
    
    // 3. Last resort: try bundled version (if any)
    try {
        const req = eval('require') as any;
        const ffprobeInstaller = req('@ffprobe-installer/ffprobe');
        if (ffprobeInstaller.path) {
            ffprobeInfo = { path: ffprobeInstaller.path, source: 'bundled' };
            console.log(`[audioProcessor] Using bundled FFprobe: ${ffprobeInstaller.path}`);
            return ffprobeInstaller.path;
        }
    } catch {
        // No bundled version available
    }
    
    throw new Error(
        'FFprobe not found. Please install FFmpeg (includes FFprobe) on your system:\n' +
        '  • Windows: choco install ffmpeg\n' +
        '  • macOS: brew install ffmpeg\n' +
        '  • Linux: sudo apt install ffmpeg'
    );
}

/**
 * Check if FFmpeg/FFprobe are available
 */
export async function checkAudioToolsAvailable(): Promise<boolean> {
    try {
        await Promise.all([
            isCommandAvailable('ffmpeg'),
            isCommandAvailable('ffprobe')
        ]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Reset cached binary information (useful for testing)
 */
export function resetBinaryCache(): void {
    ffmpegInfo = null;
    ffprobeInfo = null;
}

