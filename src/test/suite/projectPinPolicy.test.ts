import { defaultProfileCompatibility } from "../../utils/defaultProfileCompatibility";
import * as assert from 'assert';
import * as vscode from 'vscode';
import { EXTENSION_PIN_POLICY } from '../../../sharedUtils/extensionPinFeatureFlag';
import { prepareProjectPinPolicy, requireCompatibleFrontier, restoreDefaultProjectProfile } from '../../utils/projectPinPolicy';
import { clearConductorPinState } from '../../utils/extensionPins';
import { MetadataManager } from '../../utils/metadataManager';

suite('Destination pin policy before opening', function () {
    this.timeout(5000);
    let verifyDefault: typeof defaultProfileCompatibility.verify;
    let commands: typeof vscode.commands.getCommands;
    let execute: typeof vscode.commands.executeCommand;
    let getExtension: typeof vscode.extensions.getExtension;
    let clear: typeof MetadataManager.clearExtensionPins;
    function context(values = new Map<string, unknown>()) {
        return {
            // The real app supplies this same path even in pinned profiles.
            globalStorageUri: vscode.Uri.file('/User/globalStorage/editor'),
            workspaceState: {
                get: <T>(key: string) => values.get(key) as T | undefined,
                update: async (key: string, value: unknown) => { values.set(key, value); },
                keys: () => [...values.keys()],
            },
        };
    }
    const settle = () => new Promise(resolve => setTimeout(resolve, 10));
    const finishTransition = () => new Promise(resolve => setTimeout(resolve, 1100));
    const folder = vscode.Uri.file('/project-to-open');
    setup(() => {
        verifyDefault = defaultProfileCompatibility.verify;
        defaultProfileCompatibility.verify = async () => {};
        getExtension = vscode.extensions.getExtension;
        vscode.extensions.getExtension = ((id: string) => id === 'frontier-rnd.frontier-authentication'
            ? { packageJSON: { version: '0.10.0', codexProjectPinPolicyVersion: 1 } } : getExtension(id)) as unknown as typeof getExtension;
        commands = vscode.commands.getCommands;
        execute = vscode.commands.executeCommand;
        clear = MetadataManager.clearExtensionPins;
        EXTENSION_PIN_POLICY.ignoreProjectPins = true;
    });
    teardown(() => {
        defaultProfileCompatibility.verify = verifyDefault;
        vscode.extensions.getExtension = getExtension;
        vscode.commands.getCommands = commands;
        vscode.commands.executeCommand = execute;
        MetadataManager.clearExtensionPins = clear;
        EXTENSION_PIN_POLICY.ignoreProjectPins = true;
    });
    test('same-version older Frontier builds are rejected before project opening', async () => {
        vscode.extensions.getExtension = (() => ({ packageJSON: { version: '0.10.0' } })) as unknown as typeof getExtension;
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions'];
        vscode.commands.executeCommand = async () => { assert.fail('must not open'); };
        MetadataManager.clearExtensionPins = async () => false;
        await assert.rejects(MetadataManager.safeOpenFolder(folder), /Frontier Authentication/);
        EXTENSION_PIN_POLICY.ignoreProjectPins = false;
        assert.doesNotThrow(requireCompatibleFrontier);
    });
    test('incompatible Default defers migration without blocking the running profile', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions', 'workbench.profiles.actions.profileEntry.__default__profile__'];
        vscode.commands.executeCommand = async () => { assert.fail('must not leave compatible profile'); };
        defaultProfileCompatibility.verify = async () => { throw new Error('Default has old packages'); };
        const values = new Map<string, unknown>();
        assert.strictEqual(await restoreDefaultProjectProfile(context(values)), false);
        assert.strictEqual(values.size, 0);
        await settle();
    });
    test('deferred migration retries when Default becomes compatible', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions', 'workbench.profiles.actions.profileEntry.__default__profile__'];
        const calls: string[] = [];
        vscode.commands.executeCommand = async <T>(id: string): Promise<T> => { calls.push(id); return undefined as T; };
        const current = context();
        defaultProfileCompatibility.verify = async () => { throw new Error('Default has old packages'); };
        assert.strictEqual(await restoreDefaultProjectProfile(current), false);
        defaultProfileCompatibility.verify = async () => {};
        assert.strictEqual(await restoreDefaultProjectProfile(current), true);
        await finishTransition();
        assert.strictEqual(calls.length, 2);
    });
    test('a pending migration cannot reload into an incompatible Default', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions', 'workbench.profiles.actions.profileEntry.__default__profile__'];
        const calls: string[] = [];
        vscode.commands.executeCommand = async <T>(id: string): Promise<T> => { calls.push(id); return undefined as T; };
        const current = context();
        await restoreDefaultProjectProfile(current);
        await settle();
        defaultProfileCompatibility.verify = async () => { throw new Error('Default became incompatible'); };
        assert.strictEqual(await restoreDefaultProjectProfile(current), false);
        await finishTransition();
        assert.deepStrictEqual(calls, ['workbench.profiles.actions.profileEntry.__default__profile__']);
    });
    test('saves metadata before opening with the existing Default profile override', async () => {
        const calls: string[] = [];
        MetadataManager.clearExtensionPins = async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            calls.push('saved'); return true;
        };
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions'];
        vscode.commands.executeCommand = async <T>(command: string, ...args: unknown[]): Promise<T> => {
            calls.push(command);
            assert.deepStrictEqual(args, [folder, { forceNewWindow: true, forceProfile: 'Default' }]);
            return undefined as T;
        };
        await MetadataManager.safeOpenFolder(folder, undefined, true);
        assert.deepStrictEqual(calls, ['saved', 'vscode.openFolder']);
    });
    test('save failure prevents opening', async () => {
        MetadataManager.clearExtensionPins = async () => { throw new Error('save failed'); };
        vscode.commands.executeCommand = async () => { assert.fail('must not open'); };
        await assert.rejects(MetadataManager.safeOpenFolder(folder), /save failed/);
    });
    test('existing binary needs no new command', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions'];
        assert.deepStrictEqual(await prepareProjectPinPolicy(folder), { forceProfile: 'Default' });
    });
    test('stock VS Code keeps its current profile', async () => {
        vscode.commands.getCommands = async () => [];
        assert.deepStrictEqual(await prepareProjectPinPolicy(folder), {});
        await restoreDefaultProjectProfile(context());
    });
    test('profile switching waits for activation to return, then reloads only once in Default', async () => {
        const command = 'workbench.profiles.actions.profileEntry.__default__profile__';
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions', command];
        const calls: string[] = [];
        const values = new Map<string, unknown>();
        vscode.commands.executeCommand = async <T>(id: string): Promise<T> => { calls.push(id); return undefined as T; };
        assert.strictEqual(await restoreDefaultProjectProfile(context(values)), true);
        assert.deepStrictEqual(calls, [], 'activation must return before stopping its host');
        await settle();
        assert.deepStrictEqual(calls, [command]);
        assert.strictEqual(await restoreDefaultProjectProfile(context(values)), true);
        await settle();
        assert.deepStrictEqual(calls, [command, 'workbench.action.reloadWindow']);
        assert.strictEqual(await restoreDefaultProjectProfile(context(values)), false);
        await settle();
        await finishTransition();
        assert.strictEqual(calls.length, 2, 'old host fallback must not reload twice');
    });
    test('no-op profile action still reloads once, then ordinary restarts do nothing', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions', 'workbench.profiles.actions.profileEntry.__default__profile__'];
        const calls: string[] = [];
        vscode.commands.executeCommand = async <T>(id: string): Promise<T> => { calls.push(id); return undefined as T; };
        const current = context();
        assert.strictEqual(await restoreDefaultProjectProfile(current), true);
        await finishTransition();
        assert.deepStrictEqual(calls, ['workbench.profiles.actions.profileEntry.__default__profile__', 'workbench.action.reloadWindow']);
        assert.strictEqual(await restoreDefaultProjectProfile(current), false);
    });
    test('update-button and automatic-update restarts recover when either version changes', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions', 'workbench.profiles.actions.profileEntry.__default__profile__'];
        let version = '1.0.0';
        vscode.extensions.getExtension = (() => ({ packageJSON: { version } })) as unknown as typeof getExtension;
        vscode.commands.executeCommand = async <T>(): Promise<T> => undefined as T;
        const current = context();
        await restoreDefaultProjectProfile(current);
        await finishTransition();
        assert.strictEqual(await restoreDefaultProjectProfile(current), false);
        version = '1.1.0';
        assert.strictEqual(await restoreDefaultProjectProfile(current), true);
        await finishTransition();
        assert.strictEqual(await restoreDefaultProjectProfile(current), false);
    });
    test('newly removed pins trigger recovery even after a completed migration', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions', 'workbench.profiles.actions.profileEntry.__default__profile__'];
        vscode.commands.executeCommand = async <T>(): Promise<T> => undefined as T;
        const current = context();
        await restoreDefaultProjectProfile(current);
        await finishTransition();
        assert.strictEqual(await restoreDefaultProjectProfile(current, true), true);
        await finishTransition();
        assert.strictEqual(await restoreDefaultProjectProfile(current), false);
    });
    test('unavailable profile action leaves the current profile running', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions'];
        const values = new Map<string, unknown>();
        assert.strictEqual(await restoreDefaultProjectProfile(context(values)), false);
        assert.strictEqual(values.size, 0);
    });
    test('command failure clears pending recovery and reports a useful error', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.getEffectivePinnedExtensions', 'workbench.profiles.actions.profileEntry.__default__profile__'];
        vscode.commands.executeCommand = async () => { throw new Error('switch cancelled'); };
        const values = new Map<string, unknown>();
        const originalShowError = vscode.window.showErrorMessage;
        const errors: string[] = [];
        vscode.window.showErrorMessage = (async (message: string) => { errors.push(message); return undefined; }) as typeof originalShowError;
        try {
            assert.strictEqual(await restoreDefaultProjectProfile(context(values)), true);
            await settle();
            assert.ok([...values.values()].every(value => value === undefined));
            assert.strictEqual(errors.length, 1);
            assert.ok(errors[0].includes('switch cancelled'));
        } finally {
            vscode.window.showErrorMessage = originalShowError;
        }
    });
    test('cleanup clears caches without faking a sync completion', async () => {
        vscode.commands.getCommands = async () => ['codex.conductor.setRemotePins', 'codex.conductor.clearAdminPinIntent', 'codex.conductor.setSyncCompletedAt'];
        const calls: string[] = [];
        vscode.commands.executeCommand = async <T>(id: string): Promise<T> => { calls.push(id); return undefined as T; };
        await clearConductorPinState();
        assert.deepStrictEqual(calls, ['codex.conductor.setRemotePins', 'codex.conductor.clearAdminPinIntent']);
    });
    test('disabled flag performs no command lookup or profile change', async () => {
        EXTENSION_PIN_POLICY.ignoreProjectPins = false;
        vscode.commands.getCommands = async () => { assert.fail('flag disabled'); };
        assert.deepStrictEqual(await prepareProjectPinPolicy(folder), {});
        await restoreDefaultProjectProfile(context());
    });
});
