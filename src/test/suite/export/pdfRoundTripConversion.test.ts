import * as assert from "assert";
import * as fs from "fs/promises";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { convertDocxToPdfViaExtension, pdfConversionProcess } from "../../../exportHandler/pdfRoundTripConversion";
import { ExportCancelledError } from "../../../exportHandler/exportDownloadUtils";

suite("PDF round-trip temporary files", () => {
    const sandbox = sinon.createSandbox();
    let temporaryDirectory: string | undefined;
    const document = new TextEncoder().encode("synthetic DOCX bytes");

    setup(() => {
        temporaryDirectory = undefined;
        sandbox.stub(vscode.extensions, "getExtension").returns({
            extensionPath: path.resolve("/extension path with spaces"),
        } as vscode.Extension<unknown>);
    });

    teardown(async () => {
        sandbox.restore();
        if (temporaryDirectory) {
            await assert.rejects(fs.stat(temporaryDirectory), { code: "ENOENT" }, "intermediates must always be removed");
        }
    });

    test("uses temporary storage and removes both intermediates after success", async () => {
        sandbox.stub(pdfConversionProcess, "run").callsFake(async (_command, args) => {
            const [scriptPath, docxPath, pdfPath] = args;
            temporaryDirectory = path.dirname(docxPath);
            assert.ok(scriptPath.includes("extension path with spaces"));
            assert.strictEqual(path.dirname(pdfPath), temporaryDirectory);
            assert.ok(!docxPath.includes(".project"));
            assert.deepStrictEqual(await fs.readFile(docxPath), Buffer.from(document));
            await fs.writeFile(pdfPath, "%PDF-synthetic result");
            return JSON.stringify({ success: true });
        });
        const result = await convertDocxToPdfViaExtension(document.buffer);
        assert.strictEqual(Buffer.from(result).toString(), "%PDF-synthetic result");
    });

    test("removes intermediates after conversion failure", async () => {
        sandbox.stub(pdfConversionProcess, "run").callsFake(async (_command, args) => {
            temporaryDirectory = path.dirname(args[1]);
            await fs.writeFile(args[2], "partial PDF");
            throw new Error("conversion failed");
        });
        await assert.rejects(convertDocxToPdfViaExtension(document.buffer), /conversion failed/);
    });

    test("passes cancellation to the process and discards a late result", async () => {
        const controller = new AbortController();
        sandbox.stub(pdfConversionProcess, "run").callsFake(async (_command, args, signal) => {
            temporaryDirectory = path.dirname(args[1]);
            assert.strictEqual(signal, controller.signal);
            controller.abort();
            await fs.writeFile(args[2], "late PDF");
            return JSON.stringify({ success: true });
        });
        await assert.rejects(convertDocxToPdfViaExtension(document.buffer, controller.signal), ExportCancelledError);
    });
});
