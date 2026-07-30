import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

import { migrateAudioAttachments } from '../../utils/audioAttachmentsMigrationUtils';

suite('Audio Attachments Restoration', () => {
    function makeWorkspace() {
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tmpProjectRoot = vscode.Uri.file(path.join(os.tmpdir(), `codex-audio-restore-${unique}`));
        const attachmentsRoot = vscode.Uri.joinPath(tmpProjectRoot, '.project', 'attachments');
        const filesRoot = vscode.Uri.joinPath(attachmentsRoot, 'files');
        const pointersRoot = vscode.Uri.joinPath(attachmentsRoot, 'pointers');
        const wsFolder: vscode.WorkspaceFolder = { uri: tmpProjectRoot, name: 'tmp-project', index: 0 };
        return { tmpProjectRoot, filesRoot, pointersRoot, wsFolder };
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    async function waitForExists(uri: vscode.Uri, attempts = 10, delayMs = 25): Promise<void> {
        for (let i = 0; i < attempts; i++) {
            try {
                await vscode.workspace.fs.stat(uri);
                return;
            } catch {
                await sleep(delayMs);
            }
        }
        // Final attempt to throw
        await vscode.workspace.fs.stat(uri);
    }

    test('raw bytes in files/ → writes zero-byte recovery placeholder in pointers/', async () => {
        // When `files/<X>` holds raw media bytes (auto-download cache, or a
        // local-unsynced recording whose pointer got lost), we must NOT mirror
        // those bytes into `pointers/<X>` — that would commit binary content
        // into the LFS-tracked tree (LFS smudge/clean filters are disabled).
        //
        // Instead, write a zero-byte placeholder. The next sync push
        // (`addAllWithLFS`) detects empty pointers and recovers bytes from
        // `files/`, uploads to LFS, and rewrites with canonical pointer text.
        const { tmpProjectRoot, filesRoot, pointersRoot, wsFolder } = makeWorkspace();
        await vscode.workspace.fs.createDirectory(filesRoot);
        await vscode.workspace.fs.createDirectory(pointersRoot);
        const bookFolder = 'JUD';
        const audioId = 'audio-12345-abcdefg.webm';

        const srcDir = vscode.Uri.joinPath(filesRoot, bookFolder);
        const dstDir = vscode.Uri.joinPath(pointersRoot, bookFolder);
        const srcFile = vscode.Uri.joinPath(srcDir, audioId);
        const dstFile = vscode.Uri.joinPath(dstDir, audioId);

        // Arrange: place RAW BYTES (not pointer text) only in files/
        await vscode.workspace.fs.createDirectory(srcDir);
        await vscode.workspace.fs.writeFile(srcFile, new Uint8Array([1, 2, 3, 4, 5]));

        // Sanity: pointer should not exist yet
        let pointerExists = true;
        try { await vscode.workspace.fs.stat(dstFile); } catch { pointerExists = false; }
        assert.strictEqual(pointerExists, false, 'Pointer should not exist before migration');

        // Act: run migrator
        await migrateAudioAttachments(wsFolder);

        // Assert: pointer now exists, but as a ZERO-BYTE placeholder
        await waitForExists(dstFile);
        const stat = await vscode.workspace.fs.stat(dstFile);
        assert.strictEqual(stat.size, 0, 'Pointer must be a zero-byte recovery placeholder, never raw bytes');

        // Cleanup
        try { await vscode.workspace.fs.delete(tmpProjectRoot, { recursive: true }); } catch { /* ignore */ }
    });

    test('LFS pointer text in files/ → mirrored verbatim into pointers/', async () => {
        // In stream-only / stream-and-save projects, `files/<X>` legitimately
        // holds an LFS pointer stub (post-`populateFilesWithPointers` from
        // clone). If `pointers/<X>` is missing, we should mirror the pointer
        // text verbatim — that's the canonical state, safe to commit.
        const { tmpProjectRoot, filesRoot, pointersRoot, wsFolder } = makeWorkspace();
        await vscode.workspace.fs.createDirectory(filesRoot);
        await vscode.workspace.fs.createDirectory(pointersRoot);
        const bookFolder = 'JUD';
        const audioId = 'audio-pointer-only.webm';

        const srcDir = vscode.Uri.joinPath(filesRoot, bookFolder);
        const dstDir = vscode.Uri.joinPath(pointersRoot, bookFolder);
        const srcFile = vscode.Uri.joinPath(srcDir, audioId);
        const dstFile = vscode.Uri.joinPath(dstDir, audioId);

        const pointerText =
            'version https://git-lfs.github.com/spec/v1\n' +
            'oid sha256:0000000000000000000000000000000000000000000000000000000000000001\n' +
            'size 12345\n';
        const pointerBytes = new TextEncoder().encode(pointerText);

        await vscode.workspace.fs.createDirectory(srcDir);
        await vscode.workspace.fs.writeFile(srcFile, pointerBytes);

        // Act
        await migrateAudioAttachments(wsFolder);

        // Assert: pointer mirrored byte-for-byte
        await waitForExists(dstFile);
        const mirrored = await vscode.workspace.fs.readFile(dstFile);
        assert.strictEqual(mirrored.byteLength, pointerBytes.byteLength, 'Mirrored pointer should match source size');
        const mirroredText = new TextDecoder().decode(mirrored);
        assert.strictEqual(mirroredText, pointerText, 'Mirrored pointer should match source bytes exactly');

        // Cleanup
        try { await vscode.workspace.fs.delete(tmpProjectRoot, { recursive: true }); } catch { /* ignore */ }
    });

    test('updates isMissing flags in .codex after restoration', async () => {
        const { tmpProjectRoot, filesRoot, pointersRoot, wsFolder } = makeWorkspace();
        await vscode.workspace.fs.createDirectory(filesRoot);
        await vscode.workspace.fs.createDirectory(pointersRoot);
        const bookFolder = 'JUD';
        const audioId = 'audio-99999-xyz.webm';
        const filesDir = vscode.Uri.joinPath(filesRoot, bookFolder);
        const pointersDir = vscode.Uri.joinPath(pointersRoot, bookFolder);
        const srcFile = vscode.Uri.joinPath(filesDir, audioId);
        const dstFile = vscode.Uri.joinPath(pointersDir, audioId);

        // Create a minimal .codex document referencing the audio under files/
        const targetDir = vscode.Uri.joinPath(tmpProjectRoot, 'files', 'target');
        const codexDir = vscode.Uri.joinPath(targetDir, 'JUD');
        const codexFile = vscode.Uri.joinPath(codexDir, 'JUD 1.codex');
        await vscode.workspace.fs.createDirectory(codexDir);
        const codex = {
            cells: [
                {
                    metadata: {
                        attachments: {
                            [audioId.replace('.webm', '')]: {
                                type: 'audio',
                                url: path.posix.join('.project/attachments/files', bookFolder, audioId),
                                isMissing: true,
                            },
                        },
                        selectedAudioId: audioId.replace('.webm', ''),
                    },
                },
            ],
        } as any;
        await vscode.workspace.fs.writeFile(codexFile, new TextEncoder().encode(JSON.stringify(codex, null, 2)));

        // Place RAW BYTES only in files/ — restoration writes a zero-byte
        // recovery placeholder into pointers/ (see test above for rationale).
        await vscode.workspace.fs.createDirectory(filesDir);
        await vscode.workspace.fs.writeFile(srcFile, new Uint8Array([9, 9, 9]));

        // Run migrator (restores pointer and updates flags)
        await migrateAudioAttachments(wsFolder);

        // Pointer should now exist (as zero-byte placeholder); isMissing must
        // flip to false because the pointer path is present on disk.
        await waitForExists(dstFile);
        const dstStat = await vscode.workspace.fs.stat(dstFile);
        assert.strictEqual(dstStat.size, 0, 'Pointer should be a zero-byte recovery placeholder');

        // Codex should have isMissing=false after update and updatedAt bumped
        const updated = new TextDecoder().decode(await vscode.workspace.fs.readFile(codexFile));
        const parsed = JSON.parse(updated);
        const att = parsed.cells[0]?.metadata?.attachments?.[audioId.replace('.webm', '')];
        assert.strictEqual(att?.isMissing, false, 'Attachment should be marked not missing after pointer restoration');
        assert.ok(typeof att?.updatedAt === 'number' && att.updatedAt > 0, 'Attachment should have updatedAt set');

        // Cleanup
        try { await vscode.workspace.fs.delete(tmpProjectRoot, { recursive: true }); } catch { /* ignore */ }
    });

    test('keeps isMissing=true when no file exists to restore', async () => {
        const { tmpProjectRoot, filesRoot, pointersRoot, wsFolder } = makeWorkspace();
        await vscode.workspace.fs.createDirectory(filesRoot);
        await vscode.workspace.fs.createDirectory(pointersRoot);
        const bookFolder = 'JUD';
        const audioId = 'audio-00000-missing.webm';
        const targetDir = vscode.Uri.joinPath(tmpProjectRoot, 'files', 'target');
        const codexDir = vscode.Uri.joinPath(targetDir, 'JUD');
        const codexFile = vscode.Uri.joinPath(codexDir, 'JUD 2.codex');
        await vscode.workspace.fs.createDirectory(codexDir);

        // .codex references an attachment, but no bytes in files/ or pointers/
        const codexMissing = {
            cells: [
                {
                    metadata: {
                        attachments: {
                            [audioId.replace('.webm', '')]: {
                                type: 'audio',
                                url: path.posix.join('.project/attachments/files', bookFolder, audioId),
                                isMissing: true,
                            },
                        },
                        selectedAudioId: audioId.replace('.webm', ''),
                    },
                },
            ],
        } as any;
        await vscode.workspace.fs.writeFile(codexFile, new TextEncoder().encode(JSON.stringify(codexMissing, null, 2)));

        // Ensure there is no file to restore
        const filesDir = vscode.Uri.joinPath(filesRoot, bookFolder);
        const pointersDir = vscode.Uri.joinPath(pointersRoot, bookFolder);
        const srcFile = vscode.Uri.joinPath(filesDir, audioId);
        const dstFile = vscode.Uri.joinPath(pointersDir, audioId);
        try { await vscode.workspace.fs.delete(srcFile); } catch { /* ignore */ }
        try { await vscode.workspace.fs.delete(dstFile); } catch { /* ignore */ }

        // Run migrator
        await migrateAudioAttachments(wsFolder);

        // Pointer should still be missing
        let pointerExists = true;
        try { await vscode.workspace.fs.stat(dstFile); } catch { pointerExists = false; }
        assert.strictEqual(pointerExists, false, 'Pointer should remain missing when there is nothing to restore from files/');

        // Codex should still have isMissing=true
        const updated = new TextDecoder().decode(await vscode.workspace.fs.readFile(codexFile));
        const parsed = JSON.parse(updated);
        const att = parsed.cells[0]?.metadata?.attachments?.[audioId.replace('.webm', '')];
        assert.strictEqual(att?.isMissing, true, 'Attachment should remain missing if no file bytes exist');

        // Cleanup
        try { await vscode.workspace.fs.delete(tmpProjectRoot, { recursive: true }); } catch { /* ignore */ }
    });
});


