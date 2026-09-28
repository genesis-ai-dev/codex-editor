import * as vscode from "vscode";

const CORE_EXTENSIONS = ["project-accelerate.codex-editor-extension", "frontier-rnd.frontier-authentication"];

/** Read the desktop extension registry; never rewrite private profile storage.
 * A compatible current profile is not proof that Default has the same packages.
 */
export async function verifyDefaultProfileExtensions(): Promise<void> {
    const editor = vscode.extensions.getExtension(CORE_EXTENSIONS[0]);
    if (!editor || editor.extensionUri.scheme !== "file") {
        throw new Error("Cannot verify the Default profile. Install the updated Editor and Frontier into Default before opening this project.");
    }
    const directory = vscode.Uri.joinPath(editor.extensionUri, "..");
    await verifyDefaultExtensionRegistry(directory);
}

export async function verifyDefaultExtensionRegistry(directory: vscode.Uri): Promise<void> {
    try {
        const entries: { identifier?: { id?: string }; relativeLocation?: string }[] = JSON.parse(
            Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(directory, "extensions.json"))).toString("utf8")
        );
        for (const id of CORE_EXTENSIONS) {
            const entry = entries.find(item => item.identifier?.id?.toLowerCase() === id);
            const location = entry?.relativeLocation;
            if (!location || location.includes("/") || location.includes("\\") || location === "..") { throw new Error(`Missing ${id}`); }
            const manifest = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(directory, location, "package.json")
            )).toString("utf8"));
            if (manifest.codexProjectPinPolicyVersion !== 1) { throw new Error(`Incompatible ${id}`); }
        }
    } catch (error) {
        throw new Error(`Default still has missing or older extension packages. Install the updated Editor and Frontier builds into Default before switching profiles. ${String(error)}`);
    }
}

export const defaultProfileCompatibility = { verify: verifyDefaultProfileExtensions };
