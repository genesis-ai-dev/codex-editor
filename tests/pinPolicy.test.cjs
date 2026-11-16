const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function loader(stubs = {}) {
    const cache = new Map();
    function load(file) {
        file = path.resolve(file);
        if (cache.has(file)) return cache.get(file);
        const exports = {};
        cache.set(file, exports);
        const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        vm.runInNewContext(code, {
            exports,
            console,
            Buffer,
            TextEncoder,
            TextDecoder,
            setTimeout,
            require: (id) =>
                id in stubs ? stubs[id] : load(path.resolve(path.dirname(file), id + ".ts")),
        });
        return exports;
    }
    return load;
}
const base = path.join(__dirname, "..");
const pins = { editor: { version: "1", url: "https://example.invalid/editor.vsix" } };
test("project update removes stale local pins and preserves other metadata bytes", () => {
    const { applyRemoteUpdatePins } = loader()(path.join(base, "sharedUtils/projectUpdatePins.ts"));
    const local =
        '{"meta":{"pinnedExtensions":' + JSON.stringify(pins) + ',"keep":1e2},"name":"local"}';
    const updated = applyRemoteUpdatePins(local, '{"meta":{"pinnedExtensions":{}}}', false);
    assert.equal(updated, '{"meta":{"pinnedExtensions":{},"keep":1e2},"name":"local"}');
});
test("update replaces whole pin map, including partial remote deletion", () => {
    const { applyRemoteUpdatePins } = loader()(path.join(base, "sharedUtils/projectUpdatePins.ts"));
    const result = JSON.parse(
        applyRemoteUpdatePins(
            JSON.stringify({ meta: { pinnedExtensions: { ...pins, old: pins.editor } } }),
            JSON.stringify({ meta: { pinnedExtensions: pins } }),
            false,
        ),
    );
    assert.deepEqual(result.meta.pinnedExtensions, { editor: { timestamp: 0, ...pins.editor } });
});
test("unavailable or malformed remote input never becomes a successful unpin", () => {
    const { applyRemoteUpdatePins } = loader()(path.join(base, "sharedUtils/projectUpdatePins.ts"));
    for (const remote of [
        "null",
        "{broken",
        "[]",
        '{"meta":{"pinnedExtensions":null}}',
        '{"meta":{"pinnedExtensions":[]}}',
        '{"meta":{"pinnedExtensions":{"bad":{}}}}',
    ])
        assert.throws(() => applyRemoteUpdatePins("{}", remote, false));
});
test("ignore policy clears remote pins; enforce policy preserves remote pins", () => {
    const { applyRemoteUpdatePins } = loader()(path.join(base, "sharedUtils/projectUpdatePins.ts"));
    const remote = JSON.stringify({ meta: { pinnedExtensions: pins } });
    assert.deepEqual(
        JSON.parse(applyRemoteUpdatePins("{}", remote, true)).meta.pinnedExtensions,
        {},
    );
    assert.deepEqual(
        JSON.parse(applyRemoteUpdatePins("{}", remote, false)).meta.pinnedExtensions,
        { editor: { timestamp: 0, ...pins.editor } },
    );
});
test("targeted writer rejects duplicate keys and preserves BOM and empty-map formatting", () => {
    const { replaceMetadataPinsInText } = loader()(
        path.join(base, "sharedUtils/metadataPinTextEdit.ts"),
    );
    assert.throws(() => replaceMetadataPinsInText('{"meta":{},"meta":{}}', {}));
    const text = '\uFEFF{\r\n "meta": {"pinnedExtensions":{  }},"number":1.230e2\r\n}';
    assert.equal(replaceMetadataPinsInText(text, {}), text);
});
test("legacy host does not silently enable ignore policy", async () => {
    const load = loader({ vscode: { commands: { getCommands: async () => [] } } });
    const api = load(path.join(base, "src/utils/projectPinPolicy.ts"));
    assert.equal(await api.refreshPinPolicy(), undefined);
    assert.equal(
        load(path.join(base, "sharedUtils/extensionPinFeatureFlag.ts")).EXTENSION_PIN_POLICY
            .ignoreProjectPins,
        false,
    );
});
test("pending recovery never creates an extension-owned reload loop", async () => {
    const calls = [];
    const host = {
        commands: {
            getCommands: async () => ["codex.conductor.getPinPolicyStatus"],
            executeCommand: async (id) => {
                calls.push(id);
                return { protocolVersion: 1, mode: "ignore", phase: "switching" };
            },
        },
    };
    const api = loader({ vscode: host })(path.join(base, "src/utils/projectPinPolicy.ts"));
    assert.equal(await api.reconcilePinPolicy(), false);
    assert.equal(await api.reconcilePinPolicy(), false);
    assert.equal(
        calls.some((id) => /reload|profileEntry/.test(id)),
        false,
    );
});

const managerFile = path.join(base, "src/utils/metadataManager.ts");
const managerSource = ts.createSourceFile(
    managerFile,
    fs.readFileSync(managerFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
);
const managerClass = managerSource.statements.find((s) => ts.isClassDeclaration(s));
const queueMethods = ["withMetadataWrite", "registerPendingWrite", "assertMetadataSaved"]
    .map((name) =>
        managerClass.members
            .find((m) => m.name?.getText(managerSource) === name)
            .getText(managerSource),
    )
    .join("\n");
const queueContext = {
    vscode: {
        Uri: { joinPath: () => ({ toString: () => "/project/metadata.json" }) },
        workspace: { textDocuments: [] },
    },
};
vm.runInNewContext(
    ts.transpileModule(
        `class QueueHarness {static writeQueue=new Map();static pendingWrites=new Map();${queueMethods}};globalThis.QueueHarness=QueueHarness;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    queueContext,
);
test("metadata writes serialize and a failed write does not poison the queue", async () => {
    const queue = queueContext.QueueHarness;
    const folder = { fsPath: "/project" };
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const events = [];
    let started;
    const starting = new Promise((resolve) => {
        started = resolve;
    });
    const first = queue.withMetadataWrite(folder, async () => {
        events.push("first");
        started();
        await gate;
        throw Error("disk failure");
    });
    const rejected = assert.rejects(first, /disk failure/);
    const second = queue.withMetadataWrite(folder, async () => events.push("second"));
    await starting;
    assert.deepEqual(events, ["first"]);
    release();
    await rejected;
    await second;
    assert.deepEqual(events, ["first", "second"]);
});
test("dirty metadata is rejected before a targeted write", () => {
    queueContext.vscode.workspace.textDocuments = [
        { uri: { toString: () => "/project/metadata.json" }, isDirty: true },
    ];
    assert.throws(() => queueContext.QueueHarness.assertMetadataSaved({}), /Save metadata.json/);
    queueContext.vscode.workspace.textDocuments = [];
});

test("ignore policy removes unusable pin values rather than blocking project update", () => {
    const { applyRemoteUpdatePins } = loader()(path.join(base, "sharedUtils/projectUpdatePins.ts"));
    for (const value of [null, [], { editor: { version: "", url: "" } }]) {
        const remote = JSON.stringify({ meta: { pinnedExtensions: value } });
        assert.deepEqual(
            JSON.parse(applyRemoteUpdatePins('{"keep":1e2}', remote, true)).meta.pinnedExtensions,
            {},
        );
        assert.throws(() => applyRemoteUpdatePins("{}", remote, false));
    }
});
test("remote pin application delegates persistence instead of issuing a stale extension-host write", async () => {
    const commands = new Map();
    const calls = [];
    const host = {
        commands: {
            registerCommand: (id, handler) => {
                commands.set(id, handler);
                return { dispose() {} };
            },
            executeCommand: async (id, input) => {
                calls.push({ id, input });
            },
        },
        workspace: {
            workspaceFolders: [{ uri: { fsPath: "/project" } }],
            fs: {
                readFile() {
                    throw Error("Extension-host read must not race native acceptance");
                },
                writeFile() {
                    throw Error("Extension-host write must not race native acceptance");
                },
            },
        },
    };
    const load = loader({
        vscode: host,
        "./metadataManager": {
            MetadataManager: {
                withMetadataWrite: async (_folder, fn) => fn(),
                assertMetadataSaved() {},
            },
        },
        "./projectPinPolicy": {
            refreshPinPolicy: async () => ({ mode: "enforce", generation: 2 }),
        },
    });
    load(path.join(base, "src/utils/extensionPins.ts")).registerPinPolicyCommands({
        subscriptions: [],
    });
    await assert.rejects(
        commands.get("codex.applyRemoteProjectPins")({ generation: 1, pins }),
        /superseded/,
    );
    assert.equal(calls.length, 0);
    await commands.get("codex.applyRemoteProjectPins")({ generation: 2, pins });
    assert.equal(calls[0].id, "codex.conductor.writeProjectPins");
    assert.equal(calls[0].input.generation, 2);
});

for (const [indent, newline] of [["    ", "\n"], ["  ", "\r\n"], ["\t", "\n"]]) {
    test(`targeted pin writes preserve indentation ${JSON.stringify(indent)} and line endings ${JSON.stringify(newline)}`, () => {
        const { replaceMetadataPinsInText } = loader()(path.join(base, "sharedUtils/metadataPinTextEdit.ts"));
        const pins = { editor: { version: "1", url: "https://example.invalid/editor.vsix" } };
        const original = JSON.stringify({ meta: { keep: "unchanged", pinnedExtensions: {} }, other: 100 }, null, indent).replace(/\n/g, newline).replace('100', '1e2');
        const expected = JSON.stringify({ meta: { keep: "unchanged", pinnedExtensions: pins }, other: 100 }, null, indent).replace(/\n/g, newline).replace('100', '1e2');
        assert.equal(replaceMetadataPinsInText(original, pins), expected);
        assert.equal(replaceMetadataPinsInText(expected, {}), original);
        assert.equal(replaceMetadataPinsInText(expected, pins), expected);
        const missing = JSON.stringify({ meta: {} }, null, indent).replace(/\n/g, newline);
        assert.equal(replaceMetadataPinsInText(missing, pins), JSON.stringify({ meta: { pinnedExtensions: pins } }, null, indent).replace(/\n/g, newline));
    });
}

const decisions = loader()(path.join(base, "sharedUtils/pinDecisions.ts"));

test("timestamp decisions merge independently and removals survive stale pins", () => {
    const { mergePinDecisions, activePins } = decisions;
    const old = { version: "1", url: "https://example.invalid/1.vsix" };
    const next = { version: "2", url: "https://example.invalid/2.vsix" };
    const merged = mergePinDecisions({ editor: { timestamp: 20 }, frontier: { ...old, timestamp: 10 } }, { editor: { ...old, timestamp: 10 }, frontier: { ...next, timestamp: 30 } });
    assert.equal(merged.editor.timestamp, 20);
    assert.equal(merged.editor.version, undefined);
    assert.equal(merged.frontier.version, "2");
    assert.deepEqual(Object.keys(activePins(merged)), ["frontier"]);
    assert.equal(JSON.stringify(mergePinDecisions(merged, { editor: old })), JSON.stringify(merged));
    assert.equal(mergePinDecisions({ editor: old }, { editor: { timestamp: 0 } }).editor.timestamp, 0);
    assert.equal(mergePinDecisions({ editor: { timestamp: 0 } }, {}).editor.timestamp, 0);
    assert.equal(Object.keys(mergePinDecisions({ editor: old }, {})).length, 0);
});
test("explicit edits stamp only their extension and preserve clocks across merges", () => {
    const { editPinDecisions, mergePinDecisions } = decisions;
    const pin = { version: "1", url: "https://example.invalid/1.vsix" };
    const current = { editor: { ...pin, timestamp: 100 }, frontier: { ...pin, timestamp: 50 } };
    const removed = editPinDecisions(current, { editor: null }, 90);
    assert.equal(removed.editor.timestamp, 101);
    assert.deepEqual(Object.keys(removed.editor), ["timestamp"]);
    assert.equal(removed.frontier.timestamp, 50);
    const repinned = editPinDecisions(removed, { editor: pin }, 102);
    assert.equal(repinned.editor.timestamp, 102);
    assert.equal(repinned.editor.version, "1");
    assert.equal(mergePinDecisions(repinned, removed).editor.timestamp, 102);
});
test("invalid timestamps and incomplete pins fail closed", () => {
    for (const entry of [{ timestamp: -1 }, { timestamp: "1" }, { timestamp: NaN }, { timestamp: Infinity }, { timestamp: 1.5 }, { timestamp: Number.MAX_SAFE_INTEGER + 1 }, {}, { timestamp: 1, version: "1" }, { timestamp: 1, version: "", url: "" }]) {
        assert.throws(() => decisions.validatePinDecisions({ editor: entry }));
    }
});

test("project update retains independent newest decisions and formats removals", () => {
    const { applyRemoteUpdatePins } = loader()(path.join(base, "sharedUtils/projectUpdatePins.ts"));
    const localPins = { editor: { ...pins.editor, timestamp: 10 }, frontier: { ...pins.editor, timestamp: 30 } };
    const remotePins = { editor: { timestamp: 20 }, frontier: { timestamp: 20 } };
    const local = JSON.stringify({ meta: { pinnedExtensions: localPins }, keep: 100 }, null, 4).replace('100', '1e2');
    const remote = JSON.stringify({ meta: { pinnedExtensions: remotePins } });
    const updated = applyRemoteUpdatePins(local, remote, false);
    const merged = JSON.parse(updated).meta.pinnedExtensions;
    assert.deepEqual(merged.editor, { timestamp: 20 });
    assert.equal(merged.frontier.timestamp, 30);
    assert.equal(merged.frontier.version, "1");
    assert.ok(updated.includes('"keep": 1e2'));
    assert.ok(updated.includes('"editor": {\n                "timestamp": 20\n            }'));
    assert.equal(applyRemoteUpdatePins(updated, remote, false), updated);
});
