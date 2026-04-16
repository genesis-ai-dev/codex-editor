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

    suite('Pin-aware ratchet', () => {
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
