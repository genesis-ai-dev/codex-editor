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

    test('restores missing pointers for files present under files/', async () => {
        const { tmpProjectRoot, filesRoot, pointersRoot, wsFolder } = makeWorkspace();
        await vscode.workspace.fs.createDirectory(filesRoot);
        await vscode.workspace.fs.createDirectory(pointersRoot);
        const bookFolder = 'JUD';
        const audioId = 'audio-12345-abcdefg.webm';

        const srcDir = vscode.Uri.joinPath(filesRoot, bookFolder);
        const dstDir = vscode.Uri.joinPath(pointersRoot, bookFolder);
        const srcFile = vscode.Uri.joinPath(srcDir, audioId);
        const dstFile = vscode.Uri.joinPath(dstDir, audioId);

        // Arrange: place file only in files/ path
        await vscode.workspace.fs.createDirectory(srcDir);
        await vscode.workspace.fs.writeFile(srcFile, new Uint8Array([1, 2, 3, 4, 5]));

        // Sanity: pointer should not exist yet
        let pointerExists = true;
        try { await vscode.workspace.fs.stat(dstFile); } catch { pointerExists = false; }
        assert.strictEqual(pointerExists, false, 'Pointer should not exist before migration');

        // Act: run migrator
        await migrateAudioAttachments(wsFolder);

        // Assert: pointer now exists with same size
        await waitForExists(dstFile);
        const stat = await vscode.workspace.fs.stat(dstFile);
        assert.ok(stat.size >= 5, 'Restored pointer file should exist and have size');

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

        // Place file only in files/ so restoration will create pointer
        await vscode.workspace.fs.createDirectory(filesDir);
        await vscode.workspace.fs.writeFile(srcFile, new Uint8Array([9, 9, 9]));

        // Run migrator (restores pointer and updates flags)
        await migrateAudioAttachments(wsFolder);

        // Pointer should now exist
        await waitForExists(dstFile);
        const dstStat = await vscode.workspace.fs.stat(dstFile);
        assert.ok(dstStat.size >= 3);

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


