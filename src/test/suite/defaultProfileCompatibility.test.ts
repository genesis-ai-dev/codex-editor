import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { verifyDefaultExtensionRegistry } from "../../utils/defaultProfileCompatibility";

suite("Default profile package compatibility", () => {
    test("checks Default's selected copies, not same-version sideloads elsewhere", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "default-pins-"));
        try {
            const ids = ["project-accelerate.codex-editor-extension", "frontier-rnd.frontier-authentication"];
            for (const id of ids) {
                for (const suffix of ["-fixed", "-universal"]) {
                    const location = path.join(directory, id + suffix);
                    fs.mkdirSync(location);
                    fs.writeFileSync(path.join(location, "package.json"), JSON.stringify({ version: "1.0.0", codexProjectPinPolicyVersion: suffix === "-fixed" ? 1 : undefined }));
                }
            }
            const registry = path.join(directory, "extensions.json");
            fs.writeFileSync(registry, JSON.stringify(ids.map(id => ({ identifier: { id }, relativeLocation: id + "-universal" }))));
            await assert.rejects(verifyDefaultExtensionRegistry(vscode.Uri.file(directory)), /Default still has/);
            fs.writeFileSync(registry, JSON.stringify(ids.map(id => ({ identifier: { id }, relativeLocation: id + "-fixed" }))));
            await verifyDefaultExtensionRegistry(vscode.Uri.file(directory));
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});
