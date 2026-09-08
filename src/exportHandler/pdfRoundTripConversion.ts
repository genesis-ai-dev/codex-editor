import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { ExportCancelledError } from "./exportDownloadUtils";

const execFileAsync = promisify(execFile);

export const pdfConversionProcess = {
    async run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
        const { stdout } = await execFileAsync(command, args, {
            encoding: "utf8", maxBuffer: 50 * 1024 * 1024, signal,
        });
        return stdout;
    },
};

/** Conversion intermediates belong to this operation, never to project attachments. */
export async function convertDocxToPdfViaExtension(docxData: ArrayBuffer, signal?: AbortSignal): Promise<Uint8Array> {
    const checkCancellation = () => {
        if (signal?.aborted) throw new ExportCancelledError();
    };
    checkCancellation();
    const extension = vscode.extensions.getExtension("project-accelerate.codex-editor-extension");
    if (!extension) throw new Error("Could not find Codex Editor extension");
    const scriptPath = path.join(extension.extensionPath, "webviews", "codex-webviews", "src",
        "NewSourceUploader", "importers", "pdf", "scripts", "docx_to_pdf.py");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-roundtrip-pdf-"));
    try {
        const docxPath = path.join(tempDir, "translated.docx");
        const pdfPath = path.join(tempDir, "translated.pdf");
        await fs.writeFile(docxPath, new Uint8Array(docxData));
        checkCancellation();
        const pythonCmd = process.platform === "win32" ? "python" : "python3";
        let stdout: string;
        try {
            stdout = await pdfConversionProcess.run(pythonCmd, [scriptPath, docxPath, pdfPath], signal);
        } catch (error) {
            checkCancellation();
            const failure = error as { stderr?: string; stdout?: string; message?: string; };
            throw new Error(`DOCX to PDF conversion failed: ${failure.stderr || failure.stdout || failure.message || String(error)}`);
        }
        checkCancellation();
        let result: { success?: boolean; error?: string; };
        try {
            result = JSON.parse(stdout);
        } catch {
            throw new Error("DOCX to PDF conversion returned an invalid response.");
        }
        if (!result?.success) throw new Error(result?.error || "DOCX to PDF conversion failed.");
        const data = await fs.readFile(pdfPath);
        checkCancellation();
        return data;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}
