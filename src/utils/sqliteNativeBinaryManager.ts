/**
 * SQLite Native Binary Manager
 *
 * Downloads the platform-specific SQLite native addon (.node binary) on first startup.
 * Modeled after ffmpegManager.ts — detects the current platform/arch, downloads from
 * TryGhost/node-sqlite3 GitHub releases, and caches in extension global storage.
 *
 * The binary only needs to be downloaded once; subsequent startups reuse the cached file.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

/** Version of the TryGhost sqlite3 prebuilt binary we download */
const SQLITE3_VERSION = "5.1.7";

/** N-API version for the prebuilt binary (v6 is supported by all modern Node/Electron) */
const NAPI_VERSION = 6;

/** Base URL for prebuilt binary downloads */
const RELEASES_BASE_URL = `https://github.com/TryGhost/node-sqlite3/releases/download/v${SQLITE3_VERSION}`;

/** Subdirectory name inside extension global storage for the SQLite binary */
const SQLITE_STORAGE_DIR = "sqlite3-native";

/** The expected filename inside the tarball: build/Release/node_sqlite3.node */
const BINARY_NAME = "node_sqlite3.node";

/** Cached binary path (set after first successful resolution) */
let cachedBinaryPath: string | null = null;

/**
 * Determine the platform key used in the prebuilt binary filename.
 *
 * TryGhost builds for:
 *   darwin-arm64, darwin-x64, linux-arm64, linux-x64,
 *   linuxmusl-arm64, linuxmusl-x64, win32-ia32, win32-x64
 */
function getPlatformKey(): string | null {
    const platform = process.platform; // 'darwin', 'linux', 'win32'
    const arch = process.arch; // 'arm64', 'x64', 'ia32'

    if (platform === "darwin") {
        if (arch === "arm64" || arch === "x64") {
            return `darwin-${arch}`;
        }
    } else if (platform === "linux") {
        // Detect musl (Alpine Linux) vs glibc
        const isMusl = detectMusl();
        const prefix = isMusl ? "linuxmusl" : "linux";
        if (arch === "arm64" || arch === "x64") {
            return `${prefix}-${arch}`;
        }
    } else if (platform === "win32") {
        if (arch === "x64" || arch === "ia32") {
            return `win32-${arch}`;
        }
    }

    return null;
}

/**
 * Detect if we're running on a musl-based system (e.g., Alpine Linux).
 */
function detectMusl(): boolean {
    try {
        // Check for Alpine's /etc/alpine-release
        if (fs.existsSync("/etc/alpine-release")) {
            return true;
        }
        // Check if ldd reports musl
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const lddOutput = require("child_process")
            .execSync("ldd --version 2>&1 || true", { encoding: "utf8" });
        return lddOutput.toLowerCase().includes("musl");
    } catch {
        return false;
    }
}

/**
 * Get the download URL for the current platform's prebuilt binary.
 */
function getBinaryDownloadUrl(platformKey: string): string {
    const filename = `sqlite3-v${SQLITE3_VERSION}-napi-v${NAPI_VERSION}-${platformKey}.tar.gz`;
    return `${RELEASES_BASE_URL}/${filename}`;
}

/**
 * Get the expected binary file path in extension global storage.
 */
function getBinaryStoragePath(context: vscode.ExtensionContext): string {
    return path.join(
        context.globalStorageUri.fsPath,
        SQLITE_STORAGE_DIR,
        BINARY_NAME
    );
}

/**
 * Download a file from a URL, following redirects. Returns the data as a Buffer.
 */
function downloadFile(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith("https") ? require("https") : require("http");

        protocol.get(url, { headers: { "User-Agent": "codex-editor" } }, (response: any) => {
            // Follow redirects (301, 302)
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (!redirectUrl) {
                    reject(new Error("Redirect without location header"));
                    return;
                }
                downloadFile(redirectUrl).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                return;
            }

            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => resolve(Buffer.concat(chunks)));
            response.on("error", reject);
        }).on("error", reject);
    });
}

/**
 * Download and extract the SQLite native binary to extension storage.
 */
async function downloadBinary(
    context: vscode.ExtensionContext,
    platformKey: string
): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tar = require("tar");
    const downloadUrl = getBinaryDownloadUrl(platformKey);
    const storageDir = path.join(context.globalStorageUri.fsPath, SQLITE_STORAGE_DIR);
    const binaryPath = path.join(storageDir, BINARY_NAME);
    const tmpFile = path.join(os.tmpdir(), `sqlite3-native-${Date.now()}.tar.gz`);

    console.log(`[SQLite] Downloading native binary from: ${downloadUrl}`);

    // Download the tarball
    const data = await downloadFile(downloadUrl);

    // Write to temp file
    fs.writeFileSync(tmpFile, data);

    // Ensure storage directory exists
    fs.mkdirSync(storageDir, { recursive: true });

    // Extract: the tarball contains build/Release/node_sqlite3.node
    // We extract with strip=2 to get just the .node file in storageDir
    await tar.x({
        file: tmpFile,
        cwd: storageDir,
        strip: 2, // strip "build/Release/" to put node_sqlite3.node directly in storageDir
    });

    // Clean up temp file
    try {
        fs.unlinkSync(tmpFile);
    } catch {
        // Non-critical cleanup
    }

    // Verify the binary was extracted
    if (!fs.existsSync(binaryPath)) {
        throw new Error(
            `Binary extraction failed: ${BINARY_NAME} not found at ${binaryPath}`
        );
    }

    console.log(`[SQLite] Native binary installed at: ${binaryPath}`);
    return binaryPath;
}

/**
 * Ensure the SQLite native binary is available, downloading it if necessary.
 * This should be called on extension startup BEFORE any database operations.
 *
 * Shows a blocking progress dialog if download is needed.
 * Returns the path to the .node binary file.
 */
export async function ensureSqliteNativeBinary(
    context: vscode.ExtensionContext
): Promise<string> {
    // Return cached path if available
    if (cachedBinaryPath && fs.existsSync(cachedBinaryPath)) {
        return cachedBinaryPath;
    }

    // Check if binary already exists in storage
    const binaryPath = getBinaryStoragePath(context);
    if (fs.existsSync(binaryPath)) {
        cachedBinaryPath = binaryPath;
        console.log(`[SQLite] Using cached native binary: ${binaryPath}`);
        return binaryPath;
    }

    // Determine platform
    const platformKey = getPlatformKey();
    if (!platformKey) {
        throw new Error(
            `SQLite native binary not available for this platform: ` +
            `${process.platform}-${process.arch}. ` +
            `Supported: darwin-arm64, darwin-x64, linux-arm64, linux-x64, ` +
            `linuxmusl-arm64, linuxmusl-x64, win32-ia32, win32-x64`
        );
    }

    // Download with blocking progress dialog
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Setting up Codex Editor",
            cancellable: false,
        },
        async (progress) => {
            progress.report({
                message: "Downloading search engine components... (one-time setup)",
            });

            try {
                const downloadedPath = await downloadBinary(context, platformKey);
                progress.report({ message: "Search engine ready!" });
                return downloadedPath;
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(
                    `Failed to download SQLite native binary: ${msg}. ` +
                    `Database features (dictionary, search index) will be unavailable.`
                );
                throw error;
            }
        }
    );

    cachedBinaryPath = result;
    return result;
}

/**
 * Get the cached binary path without triggering a download.
 * Returns null if the binary hasn't been downloaded yet.
 */
export function getSqliteBinaryPath(): string | null {
    return cachedBinaryPath;
}

/**
 * Reset the cached binary path (useful for testing).
 */
export function resetSqliteBinaryCache(): void {
    cachedBinaryPath = null;
}
