import * as assert from "assert";
import * as os from "os";
import * as nodePath from "path";
import * as fsp from "fs/promises";
import * as vscode from "vscode";
import {
    beginVideoOperation,
    endVideoOperation,
    abortVideoOperation,
    isVideoOperationInFlight,
    videoOperationKey,
    downloadVideoToProject,
} from "../../providers/codexCellEditorProvider/utils/videoDownloadUtils";

/**
 * Issue #1038 — "Deleted video doesn't stop loading".
 *
 * A chapter-video download (downloadVideoToProject / downloadVideoToSessionCache)
 * threads the AbortController.signal from beginVideoOperation into the LFS fetch
 * and guards its write with `signal.aborted`. When the video is deleted/replaced,
 * deleteVideoFile / the replace path call abortVideoOperation, which aborts that
 * signal so the in-flight fetch stops and its bytes are never written back.
 *
 * These tests cover that cancellation contract directly.
 */
suite("videoDownloadUtils — in-flight op cancellation (#1038)", () => {
    const ws = vscode.Uri.file("/tmp/repro-1038-workspace");
    const url = "attachments/files/test/MAT.mp4";

    teardown(() => {
        // Ensure no op leaks between tests.
        endVideoOperation(ws, url);
    });

    test("beginVideoOperation marks the op in flight with a live (non-aborted) signal", () => {
        assert.strictEqual(isVideoOperationInFlight(ws, url), false);
        const controller = beginVideoOperation(ws, url);
        assert.strictEqual(isVideoOperationInFlight(ws, url), true);
        assert.strictEqual(controller.signal.aborted, false);
        endVideoOperation(ws, url);
        assert.strictEqual(isVideoOperationInFlight(ws, url), false);
    });

    test("abortVideoOperation aborts the in-flight op's signal and reports it", () => {
        const controller = beginVideoOperation(ws, url);
        const aborted = abortVideoOperation(ws, url);
        assert.strictEqual(aborted, true, "should report that it aborted an op");
        assert.strictEqual(
            controller.signal.aborted,
            true,
            "the download's signal must be aborted so the fetch stops and the write is skipped"
        );
    });

    test("abortVideoOperation returns false when nothing is in flight", () => {
        assert.strictEqual(isVideoOperationInFlight(ws, url), false);
        assert.strictEqual(abortVideoOperation(ws, url), false);
    });

    test("abortVideoOperation no-ops on a missing/empty videoUrl", () => {
        assert.strictEqual(abortVideoOperation(ws, undefined), false);
        assert.strictEqual(abortVideoOperation(ws, null), false);
        assert.strictEqual(abortVideoOperation(ws, ""), false);
    });

    test("starting a new op for the same video aborts the previous one (no leak)", () => {
        const first = beginVideoOperation(ws, url);
        const second = beginVideoOperation(ws, url);
        assert.strictEqual(
            first.signal.aborted,
            true,
            "the superseded download should be aborted so it can't write stale bytes"
        );
        assert.strictEqual(second.signal.aborted, false);
        assert.notStrictEqual(first, second);
    });

    test("operations are scoped per workspace + video", () => {
        const otherWs = vscode.Uri.file("/tmp/other-workspace");
        beginVideoOperation(ws, url);
        // A different workspace is a different op and must be unaffected.
        assert.strictEqual(isVideoOperationInFlight(otherWs, url), false);
        assert.strictEqual(abortVideoOperation(otherWs, url), false);
        assert.strictEqual(isVideoOperationInFlight(ws, url), true);
        assert.notStrictEqual(videoOperationKey(ws, url), videoOperationKey(otherWs, url));
    });
});

/**
 * End-to-end coverage of the actual downloadVideoToProject against a temp
 * workspace + LFS pointer, with a mocked downloadLFSFile we can stall and
 * abort. Proves the real app function does NOT rewrite a video that was deleted
 * mid-download (the #1038 symptom) — even when the downloader ignores the
 * abort signal.
 */
suite("downloadVideoToProject — abort prevents file resurrection (#1038)", () => {
    const videoRel = ".project/attachments/files/test/MAT.mp4";
    let extensionModule: any;
    let originalGetAuthApi: any;
    let wsUri: vscode.Uri;
    let filesUri: vscode.Uri;

    const pointer = (size: number) =>
        `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize ${size}\n`;

    suiteSetup(async () => {
        extensionModule = await import("../../extension");
        originalGetAuthApi = extensionModule.getAuthApi;
    });

    suiteTeardown(() => {
        extensionModule.getAuthApi = originalGetAuthApi;
    });

    setup(async () => {
        const dir = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "codex-1038-"));
        wsUri = vscode.Uri.file(dir);
        filesUri = vscode.Uri.joinPath(wsUri, videoRel);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(filesUri, ".."));
    });

    teardown(async () => {
        extensionModule.getAuthApi = originalGetAuthApi;
        try {
            await vscode.workspace.fs.delete(wsUri, { recursive: true });
        } catch {
            // best-effort temp cleanup
        }
    });

    const writePointer = (size: number) =>
        vscode.workspace.fs.writeFile(filesUri, Buffer.from(pointer(size), "utf-8"));

    async function fileSize(): Promise<number | null> {
        try {
            return (await vscode.workspace.fs.stat(filesUri)).size;
        } catch {
            return null;
        }
    }

    test("control: a completed download writes the bytes to files/ (no abort)", async () => {
        const SIZE = 1024;
        await writePointer(SIZE);
        extensionModule.getAuthApi = () => ({
            downloadLFSFile: async (_p: string, _o: string, size: number) => Buffer.alloc(size, 0x61),
        });

        const result = await downloadVideoToProject(wsUri, videoRel);

        assert.strictEqual(result.ok, true, "the download should succeed");
        assert.strictEqual(await fileSize(), SIZE, "the downloaded bytes should land in files/");
    });

    test("delete + abort mid-download does NOT resurrect the file, even if the downloader ignores the signal", async () => {
        const SIZE = 1024;
        await writePointer(SIZE);

        let onStarted!: () => void;
        const started = new Promise<void>((r) => (onStarted = r));
        let release!: () => void;
        const released = new Promise<void>((r) => (release = r));

        // Worst case: the LFS downloader ignores the abort signal and returns the
        // full bytes. Our write-guard must still prevent the resurrection.
        extensionModule.getAuthApi = () => ({
            downloadLFSFile: async (_p: string, _o: string, size: number) => {
                onStarted();
                await released;
                return Buffer.alloc(size, 0x61);
            },
        });

        const controller = new AbortController();
        const pending = downloadVideoToProject(wsUri, videoRel, undefined, controller.signal);

        await started; // pointer resolved, download is in flight
        // Mirror deleteVideoFile: remove the local file AND abort the op.
        await vscode.workspace.fs.delete(filesUri);
        controller.abort();
        release(); // the signal-ignoring download now "completes" with full bytes

        const result = await pending;
        assert.strictEqual(result.ok, false, "an aborted download must report failure");
        assert.strictEqual(
            await fileSize(),
            null,
            "the deleted video must NOT be rewritten by the finishing download"
        );
    });

    test("abort with a signal-honoring downloader also leaves the file deleted", async () => {
        await writePointer(1024);

        let onStarted!: () => void;
        const started = new Promise<void>((r) => (onStarted = r));

        extensionModule.getAuthApi = () => ({
            downloadLFSFile: (_p: string, _o: string, _size: number, signal?: AbortSignal) =>
                new Promise<Buffer>((_resolve, reject) => {
                    onStarted();
                    if (signal?.aborted) {
                        return reject(new Error("aborted"));
                    }
                    signal?.addEventListener("abort", () => reject(new Error("aborted")));
                }),
        });

        const controller = new AbortController();
        const pending = downloadVideoToProject(wsUri, videoRel, undefined, controller.signal);

        await started;
        await vscode.workspace.fs.delete(filesUri);
        controller.abort();

        const result = await pending;
        assert.strictEqual(result.ok, false);
        assert.strictEqual(await fileSize(), null, "the deleted video must stay gone");
    });
});
