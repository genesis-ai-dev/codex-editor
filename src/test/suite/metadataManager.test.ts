import { EXTENSION_PIN_POLICY } from "../../../sharedUtils/extensionPinFeatureFlag";
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MetadataManager } from '../../utils/metadataManager';

suite('MetadataManager Tests', () => {
    let testWorkspaceUri: vscode.Uri;
    let metadataPath: vscode.Uri;

    setup(async () => {
        // Create temporary test workspace
        const tempDir = path.join(__dirname, '..', '..', '..', 'test-temp', `metadata-test-${Date.now()}`);
        await fs.promises.mkdir(tempDir, { recursive: true });
        testWorkspaceUri = vscode.Uri.file(tempDir);
        metadataPath = vscode.Uri.joinPath(testWorkspaceUri, 'metadata.json');
    });

    teardown(async () => {
        // Cleanup test files
        try {
            await vscode.workspace.fs.delete(testWorkspaceUri, { recursive: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    suite('Basic Operations', () => {
        test('should create metadata.json if it does not exist', async () => {
            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                codexEditor: '1.0.0',
                frontierAuthentication: '2.0.0'
            });

            assert.strictEqual(result.success, true);

            const versionsResult = await MetadataManager.getExtensionVersions(testWorkspaceUri);
            assert.strictEqual(versionsResult.success, true);
            assert.strictEqual(versionsResult.versions?.codexEditor, '1.0.0');
            assert.strictEqual(versionsResult.versions?.frontierAuthentication, '2.0.0');
        });

        test('should update existing metadata.json', async () => {
            // Create initial metadata
            const initialMetadata = {
                meta: {
                    requiredExtensions: {
                        codexEditor: '1.0.0'
                    }
                },
                otherField: 'should be preserved'
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initialMetadata, null, 4)));

            // Update versions
            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                frontierAuthentication: '2.0.0'
            });

            assert.strictEqual(result.success, true);

            // Verify both versions exist and other fields are preserved
            const content = await vscode.workspace.fs.readFile(metadataPath);
            const metadata = JSON.parse(new TextDecoder().decode(content));

            assert.strictEqual(metadata.meta.requiredExtensions.codexEditor, '1.0.0');
            assert.strictEqual(metadata.meta.requiredExtensions.frontierAuthentication, '2.0.0');
            assert.strictEqual(metadata.otherField, 'should be preserved');
        });

        test('should handle corrupted JSON gracefully', async () => {
            // Write invalid JSON
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode('{ invalid json }'));

            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                codexEditor: '1.0.0'
            });

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('Invalid JSON'));
        });
    });

    suite('Concurrent Access', () => {
        test('should handle concurrent updates', async () => {
            const promises: Array<Promise<{ success: boolean; error?: string; }>> = [];
            const updateCount = 10;

            // Simulate multiple extensions updating simultaneously
            for (let i = 0; i < updateCount; i++) {
                promises.push(
                    MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                        codexEditor: `1.0.${i}`,
                        frontierAuthentication: `2.0.${i}`
                    })
                );
            }

            const results = await Promise.all(promises);

            // At least some updates should succeed (without locks, some may have race conditions)
            const successCount = results.filter((result: { success: boolean; error?: string; }) => result.success).length;
            assert.ok(successCount > 0, `At least one update should succeed`);

            // Final state should be valid JSON
            const versionsResult = await MetadataManager.getExtensionVersions(testWorkspaceUri);
            assert.strictEqual(versionsResult.success, true);
            assert.ok(versionsResult.versions?.codexEditor);
            assert.ok(versionsResult.versions?.frontierAuthentication);
        });

        test('should handle sequential updates correctly', async () => {
            // First update
            const result1 = await MetadataManager.safeUpdateMetadata(
                testWorkspaceUri,
                async (metadata: any) => {
                    metadata.update1 = 'completed';
                    return metadata;
                }
            );

            // Second update
            const result2 = await MetadataManager.safeUpdateMetadata(
                testWorkspaceUri,
                async (metadata: any) => {
                    metadata.update2 = 'completed';
                    return metadata;
                }
            );

            assert.strictEqual(result1.success, true);
            assert.strictEqual(result2.success, true);

            // Both updates should be present
            const content = await vscode.workspace.fs.readFile(metadataPath);
            const metadata = JSON.parse(new TextDecoder().decode(content));
            assert.strictEqual(metadata.update1, 'completed');
            assert.strictEqual(metadata.update2, 'completed');
        });
    });

    suite('Error Handling', () => {
        test('should handle update function errors', async () => {
            const result = await MetadataManager.safeUpdateMetadata(
                testWorkspaceUri,
                (metadata: any) => {
                    throw new Error('Update function error');
                }
            );

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('Update function error'));
        });
    });

    suite('Data Integrity', () => {
        test('should preserve existing metadata structure', async () => {
            const complexMetadata = {
                meta: {
                    requiredExtensions: {
                        codexEditor: '1.0.0'
                    },
                    customField: 'should be preserved'
                },
                projectInfo: {
                    name: 'test-project',
                    version: '1.0.0'
                },
                arrayField: [1, 2, 3],
                nestedObject: {
                    deep: {
                        value: 'preserved'
                    }
                }
            };

            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(complexMetadata, null, 4)));

            // Update only extension versions
            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                frontierAuthentication: '2.0.0'
            });

            assert.strictEqual(result.success, true);

            // Verify all original structure is preserved
            const content = await vscode.workspace.fs.readFile(metadataPath);
            const updatedMetadata = JSON.parse(new TextDecoder().decode(content));

            assert.strictEqual(updatedMetadata.meta.requiredExtensions.codexEditor, '1.0.0');
            assert.strictEqual(updatedMetadata.meta.requiredExtensions.frontierAuthentication, '2.0.0');
            assert.strictEqual(updatedMetadata.meta.customField, 'should be preserved');
            assert.strictEqual(updatedMetadata.projectInfo.name, 'test-project');
            assert.deepStrictEqual(updatedMetadata.arrayField, [1, 2, 3]);
            assert.strictEqual(updatedMetadata.nestedObject.deep.value, 'preserved');
        });

        test('should maintain JSON formatting', async () => {
            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                codexEditor: '1.0.0',
                frontierAuthentication: '2.0.0'
            });

            assert.strictEqual(result.success, true);

            // Check that JSON is properly formatted (4-space indentation)
            const content = await vscode.workspace.fs.readFile(metadataPath);
            const text = new TextDecoder().decode(content);

            assert.ok(text.includes('    '), 'Should have 4-space indentation');
            assert.ok(text.includes('{\n'), 'Should have proper line breaks');
        });
    });

    suite('Temporarily disabled extension pins', () => {
        test('disabled cleanup bypasses file reads and Conductor commands', async () => {
            EXTENSION_PIN_POLICY.ignoreProjectPins = false;
            const originalExecute = vscode.commands.executeCommand;
            try {
                // Invalid JSON would throw if disabled cleanup attempted to parse it.
                await vscode.workspace.fs.writeFile(metadataPath, Buffer.from('{broken'));
                vscode.commands.executeCommand = async () => { throw new Error('Unexpected command'); };
                assert.strictEqual(await MetadataManager.clearExtensionPins(testWorkspaceUri), false);
                const { clearCurrentProjectPins, clearConductorPinState } = await import('../../utils/extensionPins');
                await clearCurrentProjectPins();
                await clearConductorPinState();
            } finally {
                vscode.commands.executeCommand = originalExecute;
                EXTENSION_PIN_POLICY.ignoreProjectPins = true;
            }
        });

        test('clears pins while preserving unrelated metadata and minimum requirements', async () => {
            const metadata = {
                projectName: 'Preserve this',
                users: [{ userName: 'alice' }],
                meta: {
                    requiredExtensions: { codexEditor: '0.22.90', frontierAuthentication: '0.4.0' },
                    pinnedExtensions: {
                        'project-accelerate.codex-editor-extension': { version: '0.22.90', url: 'https://example.invalid/editor.vsix' },
                        'frontier-rnd.frontier-authentication': { version: '0.4.0', url: '' }
                    }
                }
            };
            await vscode.workspace.fs.writeFile(metadataPath, Buffer.from(JSON.stringify(metadata)));
            assert.strictEqual(await MetadataManager.clearExtensionPins(testWorkspaceUri), true);
            const actual = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(metadataPath)).toString());
            assert.deepStrictEqual(actual, { ...metadata, meta: { ...metadata.meta, pinnedExtensions: {} } });
            assert.strictEqual(await MetadataManager.clearExtensionPins(testWorkspaceUri), false);
        });

        test('version requirements advance even when disk or Conductor has pins', async () => {
            const original = vscode.commands.executeCommand;
            (vscode.commands as any).executeCommand = async () => ({
                'project-accelerate.codex-editor-extension': { version: '0.22.90', url: '' }
            });
            try {
                await vscode.workspace.fs.writeFile(metadataPath, Buffer.from(JSON.stringify({ meta: {
                    requiredExtensions: { codexEditor: '0.22.90', frontierAuthentication: '0.4.0' },
                    pinnedExtensions: { 'frontier-rnd.frontier-authentication': { version: '0.4.0', url: '' } }
                } })));
                const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                    codexEditor: '0.22.91', frontierAuthentication: '0.4.25'
                });
                assert.strictEqual(result.success, true);
                const actual = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(metadataPath)).toString());
                assert.deepStrictEqual(actual.meta.requiredExtensions, { codexEditor: '0.22.91', frontierAuthentication: '0.4.25' });
                assert.deepStrictEqual(actual.meta.pinnedExtensions, {});
            } finally {
                (vscode.commands as any).executeCommand = original;
            }
        });

        test('opens only after pin removal has been saved', async () => {
            await vscode.workspace.fs.writeFile(metadataPath, Buffer.from(JSON.stringify({ meta: {
                pinnedExtensions: { extension: { version: '1', url: 'url' } }
            } })));
            const original = vscode.commands.executeCommand;
            let opened = false;
            (vscode.commands as any).executeCommand = async (command: string) => {
                assert.strictEqual(command, 'vscode.openFolder');
                const actual = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(metadataPath)).toString());
                assert.deepStrictEqual(actual.meta.pinnedExtensions, {});
                opened = true;
            };
            try {
                await MetadataManager.safeOpenFolder(testWorkspaceUri);
                assert.strictEqual(opened, true);
            } finally {
                (vscode.commands as any).executeCommand = original;
            }
        });

        test('invalid metadata or failed save prevents opening and preserves the original', async () => {
            const originalCommand = vscode.commands.executeCommand;
            const originalWrite = vscode.workspace.fs.writeFile;
            const events = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
            const pinned = JSON.stringify({ meta: { pinnedExtensions: { ext: { version: '1', url: '' } } } });
            const provider = vscode.workspace.registerFileSystemProvider('pin-save-failure', {
                onDidChangeFile: events.event,
                watch: () => new vscode.Disposable(() => {}),
                stat: uri => ({ type: uri.path.endsWith('/metadata.json') ? vscode.FileType.File : vscode.FileType.Directory, ctime: 0, mtime: 0, size: pinned.length }),
                readDirectory: () => [],
                createDirectory: () => {},
                readFile: () => Buffer.from(pinned),
                writeFile: () => { throw vscode.FileSystemError.NoPermissions('write denied'); },
                delete: () => {},
                rename: () => {},
            });
            let opened = false;
            (vscode.commands as any).executeCommand = async () => { opened = true; };
            try {
                await originalWrite(metadataPath, Buffer.from('{broken'));
                await assert.rejects(MetadataManager.safeOpenFolder(testWorkspaceUri));
                assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(metadataPath)).toString(), '{broken');
                const deniedFolder = vscode.Uri.parse('pin-save-failure:/project');
                await assert.rejects(MetadataManager.safeOpenFolder(deniedFolder), /write denied/);
                assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(deniedFolder, 'metadata.json'))).toString(), pinned);
                assert.strictEqual(opened, false);
            } finally {
                (vscode.commands as any).executeCommand = originalCommand;
                provider.dispose();
                events.dispose();
            }
        });

        test('ordinary metadata writes cannot reintroduce pins', async () => {
            const result = await MetadataManager.safeUpdateMetadata(testWorkspaceUri, () => ({
                meta: { pinnedExtensions: { ext: { version: '1', url: '' } } }
            }));
            assert.strictEqual(result.success, true);
            assert.deepStrictEqual(result.metadata?.meta.pinnedExtensions, {});
        });

        test('pin cleanup preserves file formatting and unrelated numeric values', async () => {
            const input = '{\n "number": 1.2300e+9, "meta" : { "pinnedExtensions": {"ext":{}}, "keep":true }\n}\n';
            await vscode.workspace.fs.writeFile(metadataPath, Buffer.from(input));
            assert.strictEqual(await MetadataManager.clearExtensionPins(testWorkspaceUri), true);
            assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(metadataPath)).toString(), input.replace('{"ext":{}}', '{}'));
        });

        test('a no-op metadata update applies only the pin-value edit', async () => {
            const input = '{ "meta": { "pinnedExtensions": {"ext":{}}, "number": 1.230e+9 } }\n';
            await vscode.workspace.fs.writeFile(metadataPath, Buffer.from(input));
            assert.strictEqual((await MetadataManager.safeUpdateMetadata(testWorkspaceUri, value => value)).success, true);
            assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(metadataPath)).toString(), input.replace('{"ext":{}}', '{}'));
        });

        test('pin cleanup waits for the metadata writer and preserves its updates', async () => {
            await vscode.workspace.fs.writeFile(metadataPath, Buffer.from('{"projectName":"old","meta":{"pinnedExtensions":{"ext":{}}}}'));
            let release!: () => void;
            let started!: () => void;
            const startedPromise = new Promise<void>(resolve => { started = resolve; });
            const gate = new Promise<void>(resolve => { release = resolve; });
            const update = MetadataManager.safeUpdateMetadata(testWorkspaceUri, async metadata => {
                started();
                await gate;
                return { ...metadata, projectName: 'new user edit' };
            });
            await startedPromise;
            const cleanup = MetadataManager.clearExtensionPins(testWorkspaceUri);
            release();
            assert.strictEqual((await update).success, true);
            await cleanup;
            const actual = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(metadataPath)).toString());
            assert.strictEqual(actual.projectName, 'new user edit');
            assert.deepStrictEqual(actual.meta.pinnedExtensions, {});
        });

        test('missing metadata is not created just to clear pins', async () => {
            assert.strictEqual(await MetadataManager.clearExtensionPins(testWorkspaceUri), false);
            await assert.rejects(async () => { await vscode.workspace.fs.stat(metadataPath); });
        });
    });

    suite('Pin-aware ratchet with temporary policy disabled', () => {
        setup(() => { EXTENSION_PIN_POLICY.ignoreProjectPins = false; });
        teardown(() => { EXTENSION_PIN_POLICY.ignoreProjectPins = true; });
        test('ratchet works normally when no pin is active', async () => {
            const initial = {
                meta: { requiredExtensions: { codexEditor: '0.22.0' } }
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initial, null, 4)));

            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                codexEditor: '0.22.91'
            });

            assert.strictEqual(result.success, true);
            const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
            assert.strictEqual(versions.versions?.codexEditor, '0.22.91');
        });

        test('ratchet is suppressed for codexEditor when pin is active', async () => {
            const initial = {
                meta: {
                    requiredExtensions: { codexEditor: '0.22.90' },
                    pinnedExtensions: { 'project-accelerate.codex-editor-extension': { version: '0.22.90' } }
                }
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initial, null, 4)));

            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                codexEditor: '0.22.91'
            });

            assert.strictEqual(result.success, true);
            const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
            // Should NOT have been bumped to .91
            assert.strictEqual(versions.versions?.codexEditor, '0.22.90');
        });

        test('ratchet is suppressed for frontierAuthentication when frontier pin is active', async () => {
            const initial = {
                meta: {
                    requiredExtensions: { frontierAuthentication: '0.4.0' },
                    pinnedExtensions: { 'frontier-rnd.frontier-authentication': { version: '0.4.0' } }
                }
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initial, null, 4)));

            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                frontierAuthentication: '0.4.25'
            });

            assert.strictEqual(result.success, true);
            const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
            assert.strictEqual(versions.versions?.frontierAuthentication, '0.4.0');
        });

        test('frontierAuthentication ratchet is unaffected by a codex-editor pin', async () => {
            const initial = {
                meta: {
                    requiredExtensions: { codexEditor: '0.22.90', frontierAuthentication: '0.4.0' },
                    pinnedExtensions: { 'project-accelerate.codex-editor-extension': { version: '0.22.90' } }
                }
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initial, null, 4)));

            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                codexEditor: '0.22.91',
                frontierAuthentication: '0.4.25'
            });

            assert.strictEqual(result.success, true);
            const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
            assert.strictEqual(versions.versions?.codexEditor, '0.22.90');       // suppressed
            assert.strictEqual(versions.versions?.frontierAuthentication, '0.4.25'); // ratcheted
        });

        suite('Conductor-effective pins (mid-sync window)', () => {
            const CONDUCTOR_CMD = 'codex.conductor.getEffectivePinnedExtensions';
            type PinMap = Record<string, { version: string; url?: string; }> | undefined;
            let originalExecuteCommand: typeof vscode.commands.executeCommand;
            let conductorResponse: PinMap | (() => Promise<PinMap>) | 'throw';

            setup(() => {
                originalExecuteCommand = vscode.commands.executeCommand;
                conductorResponse = undefined;
                (vscode.commands as any).executeCommand = async (cmd: string, ...args: any[]) => {
                    if (cmd === CONDUCTOR_CMD) {
                        if (conductorResponse === 'throw') {
                            throw new Error('Conductor unavailable (test stub)');
                        }
                        return typeof conductorResponse === 'function'
                            ? await conductorResponse()
                            : conductorResponse;
                    }
                    return originalExecuteCommand.call(vscode.commands, cmd, ...args);
                };
            });

            teardown(() => {
                (vscode.commands as any).executeCommand = originalExecuteCommand;
            });

            test('Conductor pin suppresses ratchet when disk has no pinnedExtensions (bug repro)', async () => {
                // Simulates the post-reload, pre-merge window: metadata.json on disk has
                // no pinnedExtensions, but Conductor storage has the remote pin.
                const initial = {
                    meta: { requiredExtensions: { codexEditor: '0.24.0' } }
                };
                await vscode.workspace.fs.writeFile(metadataPath,
                    new TextEncoder().encode(JSON.stringify(initial, null, 4)));

                conductorResponse = {
                    'project-accelerate.codex-editor-extension': {
                        version: '0.28.5',
                        url: 'https://example.invalid/ext.vsix'
                    }
                };

                const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                    codexEditor: '0.28.5'
                });

                assert.strictEqual(result.success, true);
                const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
                // Must NOT have ratcheted — Conductor says this ext is pinned.
                assert.strictEqual(versions.versions?.codexEditor, '0.24.0');
            });

            test('Conductor throws → falls back to on-disk pins', async () => {
                const initial = {
                    meta: {
                        requiredExtensions: { codexEditor: '0.22.90' },
                        pinnedExtensions: {
                            'project-accelerate.codex-editor-extension': { version: '0.22.90', url: '' }
                        }
                    }
                };
                await vscode.workspace.fs.writeFile(metadataPath,
                    new TextEncoder().encode(JSON.stringify(initial, null, 4)));

                conductorResponse = 'throw';

                const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                    codexEditor: '0.22.91'
                });

                assert.strictEqual(result.success, true);
                const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
                // Suppressed via on-disk fallback pin.
                assert.strictEqual(versions.versions?.codexEditor, '0.22.90');
            });

            test('Conductor returns empty object and disk has no pins → ratchet proceeds', async () => {
                const initial = {
                    meta: { requiredExtensions: { codexEditor: '0.22.0' } }
                };
                await vscode.workspace.fs.writeFile(metadataPath,
                    new TextEncoder().encode(JSON.stringify(initial, null, 4)));

                conductorResponse = {};

                const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                    codexEditor: '0.22.91'
                });

                assert.strictEqual(result.success, true);
                const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
                assert.strictEqual(versions.versions?.codexEditor, '0.22.91');
            });

            test('Conductor state flipped while queued → uses fresh pins (race guard)', async () => {
                // Reproduces the race where updateExtensionVersions snapshots the
                // Conductor *before* acquiring the per-workspace write queue slot.
                // If another write is ahead of us in the queue, the Conductor state
                // can change between our snapshot and our callback running. The
                // callback must read pins fresh inside the queue.
                const initial = {
                    meta: { requiredExtensions: { codexEditor: '0.24.0' } }
                };
                await vscode.workspace.fs.writeFile(metadataPath,
                    new TextEncoder().encode(JSON.stringify(initial, null, 4)));

                // Conductor starts unpinned.
                conductorResponse = {};

                // Hold the queue with a slow write we control.
                let releaseSlowWrite: () => void = () => { };
                const slowWritePromise = MetadataManager.safeUpdateMetadata(
                    testWorkspaceUri,
                    async (m: any) => {
                        await new Promise<void>(resolve => { releaseSlowWrite = resolve; });
                        return m;
                    }
                );

                // Kick off the ratchet call. It queues behind the slow write.
                const updatePromise = MetadataManager.updateExtensionVersions(
                    testWorkspaceUri,
                    { codexEditor: '0.28.5' }
                );

                // Simulate Frontier flipping Conductor storage to "pinned" while
                // the ratchet call is parked in the queue.
                await new Promise(resolve => setTimeout(resolve, 20));
                conductorResponse = {
                    'project-accelerate.codex-editor-extension': { version: '0.28.5', url: '' }
                };

                // Release the queue; the ratchet callback now runs and MUST see
                // the current Conductor state, not the stale pre-queue snapshot.
                releaseSlowWrite();
                await slowWritePromise;
                await updatePromise;

                const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
                assert.strictEqual(versions.versions?.codexEditor, '0.24.0');
            });

            test('Conductor pins only frontier → codexEditor still ratchets', async () => {
                const initial = {
                    meta: {
                        requiredExtensions: { codexEditor: '0.24.0', frontierAuthentication: '0.4.0' }
                    }
                };
                await vscode.workspace.fs.writeFile(metadataPath,
                    new TextEncoder().encode(JSON.stringify(initial, null, 4)));

                conductorResponse = {
                    'frontier-rnd.frontier-authentication': { version: '0.4.0', url: '' }
                };

                const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                    codexEditor: '0.28.5',
                    frontierAuthentication: '0.4.25'
                });

                assert.strictEqual(result.success, true);
                const versions = await MetadataManager.getExtensionVersions(testWorkspaceUri);
                assert.strictEqual(versions.versions?.codexEditor, '0.28.5');          // ratcheted
                assert.strictEqual(versions.versions?.frontierAuthentication, '0.4.0'); // suppressed
            });
        });
    });

    suite('User version tracking (users array)', () => {
        test('should insert a new user entry into an empty users array', async () => {
            const initialMetadata = {
                format: 'codex',
                meta: { version: '0.0.1', category: 'source', generator: { softwareName: 'codex-editor', softwareVersion: '0.22.0', userName: 'test' }, defaultLocale: 'en', dateCreated: '2025-01-01', normalization: 'NFC' },
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initialMetadata, null, 4)));

            await MetadataManager.safeUpdateMetadata(testWorkspaceUri, (metadata: any) => {
                const users = metadata.users ?? [];
                users.push({ userName: 'alice', codexVersion: '0.22.0', updatedAt: 1000 });
                metadata.users = users;
                return metadata;
            });

            const content = await vscode.workspace.fs.readFile(metadataPath);
            const result = JSON.parse(new TextDecoder().decode(content));
            assert.ok(Array.isArray(result.users));
            assert.strictEqual(result.users.length, 1);
            assert.strictEqual(result.users[0].userName, 'alice');
            assert.strictEqual(result.users[0].codexVersion, '0.22.0');
        });

        test('should update an existing user entry when version changes', async () => {
            const initialMetadata = {
                format: 'codex',
                users: [{ userName: 'alice', codexVersion: '0.21.0', updatedAt: 500 }],
                meta: { version: '0.0.1', category: 'source', generator: { softwareName: 'codex-editor', softwareVersion: '0.22.0', userName: 'test' }, defaultLocale: 'en', dateCreated: '2025-01-01', normalization: 'NFC' },
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initialMetadata, null, 4)));

            await MetadataManager.safeUpdateMetadata(testWorkspaceUri, (metadata: any) => {
                const users = metadata.users ?? [];
                const existing = users.find((u: any) => u.userName === 'alice');
                if (existing) {
                    existing.codexVersion = '0.22.0';
                    existing.updatedAt = 1000;
                }
                metadata.users = users;
                return metadata;
            });

            const content = await vscode.workspace.fs.readFile(metadataPath);
            const result = JSON.parse(new TextDecoder().decode(content));
            assert.strictEqual(result.users.length, 1);
            assert.strictEqual(result.users[0].codexVersion, '0.22.0');
            assert.strictEqual(result.users[0].updatedAt, 1000);
        });

        test('should not add duplicate users when upserting by userName', async () => {
            const initialMetadata = {
                format: 'codex',
                users: [
                    { userName: 'alice', codexVersion: '0.22.0', updatedAt: 500 },
                    { userName: 'bob', codexVersion: '0.21.0', updatedAt: 400 },
                ],
                meta: { version: '0.0.1', category: 'source', generator: { softwareName: 'codex-editor', softwareVersion: '0.22.0', userName: 'test' }, defaultLocale: 'en', dateCreated: '2025-01-01', normalization: 'NFC' },
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initialMetadata, null, 4)));

            // Upsert alice with a new version
            await MetadataManager.safeUpdateMetadata(testWorkspaceUri, (metadata: any) => {
                const users = metadata.users ?? [];
                const existing = users.find((u: any) => u.userName === 'alice');
                if (existing) {
                    existing.codexVersion = '0.23.0';
                    existing.updatedAt = 2000;
                } else {
                    users.push({ userName: 'alice', codexVersion: '0.23.0', updatedAt: 2000 });
                }
                metadata.users = users;
                return metadata;
            });

            const content = await vscode.workspace.fs.readFile(metadataPath);
            const result = JSON.parse(new TextDecoder().decode(content));
            assert.strictEqual(result.users.length, 2);
            const alice = result.users.find((u: any) => u.userName === 'alice');
            assert.strictEqual(alice.codexVersion, '0.23.0');
        });

        test('should preserve other metadata fields when updating users', async () => {
            const initialMetadata = {
                format: 'codex',
                projectName: 'My Project',
                users: [{ userName: 'alice', codexVersion: '0.22.0', updatedAt: 500 }],
                meta: { version: '0.0.1', category: 'source', generator: { softwareName: 'codex-editor', softwareVersion: '0.22.0', userName: 'test' }, defaultLocale: 'en', dateCreated: '2025-01-01', normalization: 'NFC' },
            };
            await vscode.workspace.fs.writeFile(metadataPath,
                new TextEncoder().encode(JSON.stringify(initialMetadata, null, 4)));

            await MetadataManager.safeUpdateMetadata(testWorkspaceUri, (metadata: any) => {
                const users = metadata.users ?? [];
                users.push({ userName: 'bob', codexVersion: '0.23.0', updatedAt: 1000 });
                metadata.users = users;
                return metadata;
            });

            const content = await vscode.workspace.fs.readFile(metadataPath);
            const result = JSON.parse(new TextDecoder().decode(content));
            assert.strictEqual(result.projectName, 'My Project');
            assert.strictEqual(result.format, 'codex');
            assert.strictEqual(result.users.length, 2);
        });
    });

    suite('Performance', () => {
        test('should complete updates within reasonable time', async () => {
            const startTime = Date.now();

            const result = await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                codexEditor: '1.0.0',
                frontierAuthentication: '2.0.0'
            });

            const duration = Date.now() - startTime;

            assert.strictEqual(result.success, true);
            assert.ok(duration < 1000, `Update took too long: ${duration}ms`);
        });

        test('should handle multiple sequential updates efficiently', async () => {
            const startTime = Date.now();
            const updateCount = 20;

            for (let i = 0; i < updateCount; i++) {
                await MetadataManager.updateExtensionVersions(testWorkspaceUri, {
                    codexEditor: `1.0.${i}`
                });
            }

            const duration = Date.now() - startTime;

            // Final state should be correct
            const versionsResult = await MetadataManager.getExtensionVersions(testWorkspaceUri);
            assert.strictEqual(versionsResult.success, true);
            assert.strictEqual(versionsResult.versions?.codexEditor, `1.0.${updateCount - 1}`);

            // Should complete in reasonable time
            assert.ok(duration < 5000, `${updateCount} updates took too long: ${duration}ms`);
        });
    });
});
