import * as assert from 'assert';
import * as vscode from 'vscode';

declare const suite: any;
declare const test: any;

suite('Extension Web Test Suite', () => {
    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('project-accelerate.codex-editor-extension'));
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('project-accelerate.codex-editor-extension');
        if (!ext) {
            assert.fail('Extension not found');
        }
        await ext.activate();
        assert.strictEqual(ext.isActive, true);
    });
}); 