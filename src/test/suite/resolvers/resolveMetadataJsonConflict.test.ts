import * as assert from "assert";
import { resolveMetadataJsonConflict } from "../../../projectManager/utils/merge/resolvers";
import type { ConflictFile } from "../../../projectManager/utils/merge/types";

const makeConflict = (base: any, ours: any, theirs: any): ConflictFile => ({
    filepath: "metadata.json",
    base: JSON.stringify(base),
    ours: JSON.stringify(ours),
    theirs: JSON.stringify(theirs),
    isDeleted: false,
    isNew: false,
});

const pins = {
    "project-accelerate.codex-editor-extension": {
        version: "0.22.0",
        url: "https://example.com/codex-0.22.0.vsix",
    },
    "frontier-rnd.frontier-authentication": {
        version: "0.4.9",
        url: "https://example.com/auth-0.4.9.vsix",
    },
};

// A realistic metadata.json shell; deep-cloned so each test mutates freely
const baseMetadata = () => ({
    projectName: "Test Project",
    format: "scripture burrito",
    meta: {
        version: "1.0",
        generator: { softwareName: "Codex Editor", softwareVersion: "0.22.0" },
        pinnedExtensions: JSON.parse(JSON.stringify(pins)),
    },
});

suite("Resolver unit: resolveMetadataJsonConflict — remote deletions (#1105)", () => {
    test("theirs deletes all of pinnedExtensions, ours unchanged → key absent from result", async () => {
        const base = baseMetadata();
        const ours = baseMetadata();
        const theirs = baseMetadata();
        delete (theirs.meta as any).pinnedExtensions;

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.strictEqual("pinnedExtensions" in result.meta, false,
            "deleted object must not be rebuilt from ours");
    });

    test("theirs deletes one entry inside pinnedExtensions → only that entry gone", async () => {
        const base = baseMetadata();
        const ours = baseMetadata();
        const theirs = baseMetadata();
        delete (theirs.meta.pinnedExtensions as any)["frontier-rnd.frontier-authentication"];

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.strictEqual(
            "frontier-rnd.frontier-authentication" in result.meta.pinnedExtensions, false);
        assert.deepStrictEqual(
            result.meta.pinnedExtensions["project-accelerate.codex-editor-extension"],
            pins["project-accelerate.codex-editor-extension"],
            "untouched sibling entry must survive");
    });

    test("ours deletes pinnedExtensions, theirs unchanged → stays deleted (admin-side behavior)", async () => {
        const base = baseMetadata();
        const ours = baseMetadata();
        const theirs = baseMetadata();
        delete (ours.meta as any).pinnedExtensions;

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.strictEqual(result.meta.pinnedExtensions, undefined);
    });

    test("theirs changes a pin's version and url, ours unchanged → server values win", async () => {
        const base = baseMetadata();
        const ours = baseMetadata();
        const theirs = baseMetadata();
        theirs.meta.pinnedExtensions["project-accelerate.codex-editor-extension"] = {
            version: "0.23.1",
            url: "https://example.com/codex-0.23.1.vsix",
        };

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.deepStrictEqual(
            result.meta.pinnedExtensions["project-accelerate.codex-editor-extension"],
            { version: "0.23.1", url: "https://example.com/codex-0.23.1.vsix" });
    });

    test("both sides change the same field differently → local wins (existing rule)", async () => {
        const base = baseMetadata();
        const ours = baseMetadata();
        const theirs = baseMetadata();
        (ours as any).projectName = "Ours Name";
        (theirs as any).projectName = "Theirs Name";

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.strictEqual(result.projectName, "Ours Name");
    });

    test("ours changes a pin theirs deleted → local wins (conflict, not a clean deletion)", async () => {
        const base = baseMetadata();
        const ours = baseMetadata();
        const theirs = baseMetadata();
        ours.meta.pinnedExtensions["project-accelerate.codex-editor-extension"].version = "0.99.0";
        delete (theirs.meta as any).pinnedExtensions;

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.strictEqual(
            result.meta.pinnedExtensions["project-accelerate.codex-editor-extension"].version,
            "0.99.0");
    });

    test("theirs deletes an ordinary non-pin field → deletion sticks", async () => {
        const base = { ...baseMetadata(), sourceLanguage: { tag: "en", refName: "English" } };
        const ours = { ...baseMetadata(), sourceLanguage: { tag: "en", refName: "English" } };
        const theirs = baseMetadata();

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.strictEqual("sourceLanguage" in result, false);
    });

    test("field added locally (absent from base and theirs) is kept, not treated as deleted", async () => {
        const base = baseMetadata();
        const ours = { ...baseMetadata(), validationCount: 2 };
        const theirs = baseMetadata();

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.strictEqual(result.validationCount, 2);
    });

    test("specialized users merge still governs even when theirs dropped users", async () => {
        const users = [{ userName: "alice", codexVersion: "0.22.0", updatedAt: 1000 }];
        const base = { ...baseMetadata(), users };
        const ours = { ...baseMetadata(), users };
        const theirs = baseMetadata();

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.deepStrictEqual(result.users, users,
            "users is owned by mergeUserVersionEntries, not the generic deletion rule");
    });

    test("end to end: full unpin scenario leaves no pinnedExtensions in the pushed result", async () => {
        // Machine A (admin) unpinned and synced: server (theirs) has no pins.
        // Machine B (ours) still has the pin plus an unrelated local version bump,
        // which is what makes metadata.json conflict in the first place.
        const base = baseMetadata();
        const ours = baseMetadata();
        ours.meta.generator.softwareVersion = "0.22.1";
        const theirs = baseMetadata();
        delete (theirs.meta as any).pinnedExtensions;

        const result = JSON.parse(await resolveMetadataJsonConflict(makeConflict(base, ours, theirs)));

        assert.strictEqual("pinnedExtensions" in result.meta, false,
            "machine B must not resurrect the pin");
        assert.strictEqual(result.meta.generator.softwareVersion, "0.22.1",
            "machine B's own local change still merges normally");
    });
});
