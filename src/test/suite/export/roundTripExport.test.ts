import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import * as sinon from "sinon";
import JSZip from "jszip";
import { createHash } from "crypto";
import * as fs from "fs/promises";
import { originalFileDownloads } from "../../../exportHandler/roundTripExportContext";
import { pdfConversionProcess } from "../../../exportHandler/pdfRoundTripConversion";
import { CodexExportFormat, exportCodexContent } from "../../../exportHandler/exportHandler";
import { createNoopReporter, type ExportProgressEvent, type ExportSummary } from "../../../exportHandler/exportProgress";
import type { MediaFilesStrategy } from "../../../../types";

const root = path.resolve("/roundtrip-export-regression");
const workspace: vscode.WorkspaceFolder = { uri: vscode.Uri.file(root), name: "Roundtrip", index: 0 };
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const pointerFor = (data: Uint8Array) => Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid sha256:${hash(data)}\nsize ${data.byteLength}\n`
);
const originalPath = (name: string, mirror = false) => path.join(root, ".project", "attachments", mirror ? "pointers" : "files", "originals", name);
const textCell = (metadata: Record<string, unknown> = {}) => ({
    kind: 2, languageId: "html", value: "<p>Translated</p>",
    metadata: { id: "1", type: "text", ...metadata },
});

suite("Round-trip export storage, contents and results", () => {
    const sandbox = sinon.createSandbox();
    let disk: Map<string, Uint8Array>;
    let remote: Map<string, Uint8Array>;
    let downloads: string[];
    let events: ExportProgressEvent[];
    let result: ExportSummary | undefined;
    let cancelled: ExportSummary | undefined;
    let cts: vscode.CancellationTokenSource;
    let onDownload: ((signal?: AbortSignal) => void) | undefined;

    const reporter = () => ({
        ...createNoopReporter(),
        report: (event: ExportProgressEvent) => events.push(event),
        complete: (summary: ExportSummary) => { result = summary; },
        cancelled: (summary?: ExportSummary) => { cancelled = summary; },
    });
    const notebook = (name: string, metadata: Record<string, unknown>, cells = [textCell()]) => {
        const filePath = path.join(root, "files", "target", name + ".codex");
        disk.set(filePath, Buffer.from(JSON.stringify({ metadata, cells })));
        return filePath;
    };
    const run = (files: string[]) => exportCodexContent(
        CodexExportFormat.REBUILD_EXPORT, path.join(root, "exports"), files, {}, reporter(), cts.token
    );
    const outputs = () => [...disk.entries()].filter(([name]) => name.startsWith(path.join(root, "exports") + path.sep));

    setup(() => {
        disk = new Map(); remote = new Map(); downloads = []; events = [];
        result = undefined; cancelled = undefined; onDownload = undefined;
        cts = new vscode.CancellationTokenSource();
        sandbox.stub(vscode.workspace, "workspaceFolders").value([workspace]);
        sandbox.stub(vscode.workspace, "getWorkspaceFolder").returns(workspace);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: (key: string, fallback: unknown) => key === "projectName" ? "Roundtrip" : fallback,
        } as vscode.WorkspaceConfiguration);
        // VS Code freezes the fs method table. Replace the workspace accessor
        // with an isolated in-memory filesystem instead of mutating that table.
        sandbox.stub(vscode.workspace, "fs").value({
            ...vscode.workspace.fs,
            readFile: async (uri: vscode.Uri) => {
                const data = disk.get(uri.fsPath);
                if (data === undefined) throw vscode.FileSystemError.FileNotFound(uri);
                return data;
            },
            writeFile: async (uri: vscode.Uri, data: Uint8Array) => { disk.set(uri.fsPath, data); },
            createDirectory: async () => undefined,
            delete: async (uri: vscode.Uri) => {
                for (const name of disk.keys()) {
                    if (name === uri.fsPath || name.startsWith(uri.fsPath + path.sep)) disk.delete(name);
                }
            },
        });
        sandbox.stub(originalFileDownloads, "download").callsFake(async (_project, pointer, signal) => {
            downloads.push(pointer.oid);
            onDownload?.(signal);
            const data = remote.get(pointer.oid);
            if (!data) throw new Error("404 original missing on server");
            return Buffer.from(data);
        });
    });

    teardown(() => { cts.dispose(); sandbox.restore(); });

    for (const mode of ["auto-download", "stream-and-save", "stream-only"] as MediaFilesStrategy[]) {
        for (const remoteOnly of [false, true]) {
            test(`exports DOCX in ${mode} with ${remoteOnly ? "remote" : "local"} originals and preserves project storage`, async () => {
                const zip = new JSZip();
                zip.file("word/document.xml", '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Original</w:t></w:r></w:p></w:body></w:document>');
                zip.file("word/styles.xml", "<styles>keep these styles</styles>");
                const original = await zip.generateAsync({ type: "uint8array" });
                const sourcePath = originalPath("sample.docx");
                disk.set(sourcePath, remoteOnly ? pointerFor(original) : original);
                remote.set(hash(original), original);
                const settingsPath = path.join(root, ".project", "localProjectSettings.json");
                disk.set(settingsPath, Buffer.from(JSON.stringify({ currentMediaFilesStrategy: mode })));
                const file = notebook("docx", { corpusMarker: "docx", originalFileName: "sample.docx" }, [textCell({ paragraphIndex: 0 })]);
                const before = [...disk.entries()];
                await run([file]);
                assert.strictEqual(result?.filesExported, 1);
                assert.deepStrictEqual(result?.missingFiles, []);
                assert.strictEqual(downloads.length, remoteOnly ? 1 : 0);
                const output = await JSZip.loadAsync(outputs()[0][1]);
                assert.ok((await output.file("word/document.xml")!.async("string")).includes("Translated"));
                assert.strictEqual(await output.file("word/styles.xml")!.async("string"), "<styles>keep these styles</styles>");
                for (const [name, data] of before) assert.deepStrictEqual(disk.get(name), data, name);
                assert.strictEqual(disk.size, before.length + 1, "only the export output should be added");
                assert.strictEqual(events.some(event => event.stage === "downloading"), remoteOnly);
            });
        }
    }

    for (const corpusMarker of ["indesign", "biblica"]) {
        test(`exports ${corpusMarker} from an LFS original`, async () => {
            const zip = new JSZip();
            zip.file("Stories/Story_u1.xml", '<Story Self="u1"><ParagraphStyleRange><CharacterStyleRange><Content>Original</Content></CharacterStyleRange></ParagraphStyleRange></Story>');
            zip.file("Resources/Styles.xml", "<styles/>");
            const original = await zip.generateAsync({ type: "uint8array" });
            disk.set(originalPath("sample.idml", true), pointerFor(original));
            remote.set(hash(original), original);
            const file = notebook(corpusMarker, { corpusMarker, originalFileName: "sample.idml" }, [textCell({ storyId: "u1" })]);
            await run([file]);
            assert.strictEqual(result?.filesExported, 1, JSON.stringify(result));
            const output = await JSZip.loadAsync(outputs()[0][1]);
            assert.ok((await output.file("Stories/Story_u1.xml")!.async("string")).includes("Translated"));
            assert.strictEqual(await output.file("Resources/Styles.xml")!.async("string"), "<styles/>");
        });
    }

    test("uses a local original from the pointer mirror instead of downloading", async () => {
        const original = Buffer.from("Original\n");
        disk.set(originalPath("sample.md"), pointerFor(original));
        disk.set(originalPath("sample.md", true), original);
        const file = notebook("markdown", { corpusMarker: "markdown", originalFileName: "sample.md" },
            [textCell({ sourceSpan: { start: 0, end: 8 } })]);
        await run([file]);
        assert.strictEqual(Buffer.from(outputs()[0][1]).toString(), "Translated\n");
        assert.deepStrictEqual(downloads, []);
    });

    test("PDF export resolves the converted DOCX and keeps intermediates out of the project", async () => {
        const zip = new JSZip();
        zip.file("word/document.xml", '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Original</w:t></w:r></w:p></w:body></w:document>');
        const original = await zip.generateAsync({ type: "uint8array" });
        disk.set(originalPath("converted.docx", true), pointerFor(original));
        remote.set(hash(original), original);
        sandbox.stub(vscode.extensions, "getExtension").returns({ extensionPath: root } as vscode.Extension<unknown>);
        let tempPath = "";
        sandbox.stub(pdfConversionProcess, "run").callsFake(async (_command, args) => {
            tempPath = path.dirname(args[1]);
            assert.ok(!tempPath.startsWith(root));
            const translated = await JSZip.loadAsync(await fs.readFile(args[1]));
            assert.ok((await translated.file("word/document.xml")!.async("string")).includes("Translated"));
            await fs.writeFile(args[2], "%PDF-translated");
            return JSON.stringify({ success: true });
        });
        const file = notebook("pdf", {
            corpusMarker: "pdf", originalFileName: "sample.pdf", originalFileHash: "a".repeat(64),
            pdfDocumentMetadata: { convertedDocxFileName: "converted.docx" },
        }, [textCell({ paragraphIndex: 0 })]);
        await run([file]);
        assert.strictEqual(result?.filesExported, 1, JSON.stringify(result));
        assert.strictEqual(Buffer.from(outputs()[0][1]).toString(), "%PDF-translated");
        assert.strictEqual(downloads.length, 1);
        await assert.rejects(fs.stat(tempPath), { code: "ENOENT" });
        assert.ok(![...disk.keys()].some(name => name.includes("/temporary/")));
    });

    for (const format of ["tmx", "xliff", "markdown", "obs", "csv", "tsv", "usfm"]) {
        test(`resolves LFS bytes before passing ${format} content to its exporter`, async () => {
            let original = "Original\n";
            let metadata: Record<string, unknown> = { corpusMarker: format };
            let cellMetadata: Record<string, unknown> = {};
            if (format === "tmx" || format === "xliff") {
                original = format === "tmx"
                    ? '<?xml version="1.0"?><tmx><body><tu tuid="1"><tuv xml:lang="en"><seg>Original</seg></tuv><tuv xml:lang="fr"><seg>Old</seg></tuv></tu></body></tmx>'
                    : '<?xml version="1.0"?><xliff><file><body><trans-unit id="1"><source>Original</source><target>Old</target></trans-unit></body></file></xliff>';
                metadata = { corpusMarker: "tms", fileType: format };
                cellMetadata = { unitId: "1", sourceLanguage: "en", targetLanguage: "fr" };
            } else if (format === "csv" || format === "tsv") {
                const delimiter = format === "tsv" ? "\t" : ",";
                original = `id${delimiter}text\n1${delimiter}Original\n`;
                metadata = { corpusMarker: "spreadsheet", importerType: `spreadsheet-${format}`, sourceColumnIndex: 1, delimiter };
                // Importer row indices exclude the header and start at zero.
                cellMetadata = { data: { rowIndex: 0 } };
            } else if (format === "usfm") {
                original = "\\id GEN\n\\c 1\n\\v 1 Original\n";
                metadata = { corpusMarker: "usfm" };
                cellMetadata = { id: "GEN 1:1", originalLine: "\\v 1 Original" };
            } else if (format === "obs") {
                metadata.obsStory = { storyNumber: 1, title: "Story", sourceReference: "", segments: [
                    { type: "story", text: "Original", html: "Original", images: [], sourceSpan: { start: 0, end: 8 } },
                ] };
                cellMetadata = { segmentIndex: 0 };
            } else {
                cellMetadata = { sourceSpan: { start: 0, end: 8 } };
            }
            const name = `sample.${format === "obs" || format === "markdown" ? "md" : format}`;
            const data = Buffer.from(original);
            disk.set(originalPath(name, true), pointerFor(data));
            remote.set(hash(data), data);
            const file = notebook(format, { ...metadata, originalFileName: name }, [textCell(cellMetadata)]);
            await run([file]);
            assert.strictEqual(result?.filesExported, 1, JSON.stringify(result));
            const output = Buffer.from(outputs()[0][1]).toString();
            assert.ok(output.includes("Translated"), output);
            assert.ok(!output.includes("git-lfs.github.com"), output);
            assert.strictEqual(downloads.length, 1);
        });
    }

    test("embedded USFM is used even when the attachment is an unavailable pointer", async () => {
        const original = "\\id GEN\n\\c 1\n\\v 1 Original\n";
        disk.set(originalPath("GEN.usfm"), pointerFor(Buffer.from(original)));
        const file = notebook("GEN", {
            corpusMarker: "usfm", originalFileName: "GEN.usfm", structureMetadata: { originalUsfmContent: original },
        }, [textCell({ id: "GEN 1:1", originalLine: "\\v 1 Original" })]);
        await run([file]);
        assert.strictEqual(result?.filesExported, 1);
        assert.deepStrictEqual(downloads, []);
        assert.ok(Buffer.from(outputs()[0][1]).toString().includes("Translated"));
    });

    test("failed originals do not prevent other exports or inflate the success count", async () => {
        const missing = notebook("missing", { corpusMarker: "markdown", originalFileName: "missing.md" });
        disk.set(originalPath("ok.md"), Buffer.from("Original\n"));
        const good = notebook("good", { corpusMarker: "markdown", originalFileName: "ok.md" }, [textCell({ sourceSpan: { start: 0, end: 8 } })]);
        await run([missing, good]);
        assert.strictEqual(result?.filesExported, 1);
        assert.strictEqual(result?.missingFiles?.length, 1);
        assert.strictEqual(outputs().length, 1);
    });

    test("an all-failed export reports zero instead of the selected file count", async () => {
        const file = notebook("missing", { corpusMarker: "docx", originalFileName: "missing.docx" });
        await run([file]);
        assert.strictEqual(result?.filesExported, 0);
        assert.strictEqual(result?.missingFiles?.length, 1);
        assert.strictEqual(outputs().length, 0);
        assert.ok(!result?.extraMessages?.some(message => message.includes("Successfully exported")));
    });

    test("spreadsheet download failures cannot silently fall back to reconstruction", async () => {
        const data = Buffer.from("id,text\n1,Original\n");
        disk.set(originalPath("sample.csv"), pointerFor(data));
        const file = notebook("csv", { corpusMarker: "spreadsheet", originalFileName: "sample.csv" });
        await run([file]);
        assert.strictEqual(result?.filesExported, 0);
        assert.strictEqual(result?.missingFiles?.length, 1);
        assert.strictEqual(outputs().length, 0);
    });

    test("cancellation during download stops later files and removes partial outputs", async () => {
        const original = Buffer.from("Original\n");
        disk.set(originalPath("local.md"), original);
        disk.set(originalPath("remote.md"), pointerFor(original));
        disk.set(originalPath("later.md"), pointerFor(original));
        remote.set(hash(original), original);
        const files = ["local", "remote", "later"].map(name => notebook(name, {
            corpusMarker: "markdown", originalFileName: name + ".md",
        }, [textCell({ sourceSpan: { start: 0, end: 8 } })]));
        onDownload = signal => { cts.cancel(); assert.strictEqual(signal?.aborted, true); };
        await run(files);
        assert.ok(cancelled?.exportPath);
        assert.strictEqual(result, undefined);
        assert.strictEqual(downloads.length, 1);
        assert.strictEqual(outputs().length, 0);
        assert.deepStrictEqual(disk.get(originalPath("remote.md")), pointerFor(original));
    });
});
