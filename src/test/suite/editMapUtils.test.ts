import * as assert from "assert";
import { EditMapUtils, deduplicateFileMetadataEdits, addMetadataEdit, addProjectMetadataEdit } from "../../utils/editMapUtils";
import { EditType } from "../../../types/enums";
import { FileEditHistory, ProjectEditHistory } from "../../../types";

suite("editMapUtils Test Suite", () => {
    suite("deduplicateFileMetadataEdits", () => {
        test("should return empty array for empty input", () => {
            const result = deduplicateFileMetadataEdits([]);
            assert.strictEqual(result.length, 0, "Should return empty array");
        });

        test("should return empty array for null/undefined input", () => {
            const result1 = deduplicateFileMetadataEdits(null as any);
            const result2 = deduplicateFileMetadataEdits(undefined as any);
            assert.strictEqual(result1.length, 0, "Should return empty array for null");
            assert.strictEqual(result2.length, 0, "Should return empty array for undefined");
        });

        test("should deduplicate edits with same timestamp, editMap, and value", () => {
            const timestamp = 1234567890;
            const edits: FileEditHistory[] = [
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
            ];

            const result = deduplicateFileMetadataEdits(edits);
            assert.strictEqual(result.length, 1, "Should deduplicate identical edits");
            assert.strictEqual(result[0].value, "https://example.com/video.mp4", "Remaining edit should have correct value");
        });

        test("should preserve edits with different timestamps", () => {
            const edits: FileEditHistory[] = [
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: 1000,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: 2000,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
            ];

            const result = deduplicateFileMetadataEdits(edits);
            assert.strictEqual(result.length, 2, "Should preserve edits with different timestamps");
        });

        test("should preserve edits with different values", () => {
            const timestamp = 1234567890;
            const edits: FileEditHistory[] = [
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video1.mp4",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video2.mp4",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
            ];

            const result = deduplicateFileMetadataEdits(edits);
            assert.strictEqual(result.length, 2, "Should preserve edits with different values");
            assert.ok(result.some((e) => e.value === "https://example.com/video1.mp4"), "Should have first value");
            assert.ok(result.some((e) => e.value === "https://example.com/video2.mp4"), "Should have second value");
        });

        test("should preserve edits with different editMaps", () => {
            const timestamp = 1234567890;
            const edits: FileEditHistory[] = [
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataTextDirection(),
                    value: "rtl",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
            ];

            const result = deduplicateFileMetadataEdits(edits);
            assert.strictEqual(result.length, 2, "Should preserve edits with different editMaps");
        });

        test("should sort results by timestamp", () => {
            const edits: FileEditHistory[] = [
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: 3000,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataTextDirection(),
                    value: "rtl",
                    timestamp: 1000,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataFontSize(),
                    value: 16,
                    timestamp: 2000,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
            ];

            const result = deduplicateFileMetadataEdits(edits);
            assert.strictEqual(result.length, 3, "Should preserve all edits");
            assert.strictEqual(result[0].timestamp, 1000, "First edit should be earliest");
            assert.strictEqual(result[1].timestamp, 2000, "Second edit should be middle");
            assert.strictEqual(result[2].timestamp, 3000, "Third edit should be latest");
        });

        test("should handle multiple duplicates", () => {
            const timestamp = 1234567890;
            const edits: FileEditHistory[] = [
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: timestamp,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
            ];

            const result = deduplicateFileMetadataEdits(edits);
            assert.strictEqual(result.length, 1, "Should deduplicate multiple duplicates");
        });

        test("should handle edits without editMap", () => {
            const edits: any[] = [
                {
                    value: "some value",
                    timestamp: 1234567890,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
                {
                    editMap: EditMapUtils.metadataVideoUrl(),
                    value: "https://example.com/video.mp4",
                    timestamp: 1234567890,
                    type: EditType.USER_EDIT,
                    author: "test-author",
                },
            ];

            const result = deduplicateFileMetadataEdits(edits);
            // Should only include the edit with valid editMap
            assert.strictEqual(result.length, 1, "Should filter out edits without editMap");
            assert.ok(result[0].editMap, "Remaining edit should have editMap");
        });
    });

    suite("addMetadataEdit", () => {
        test("should add edit and deduplicate", () => {
            const metadata: { edits?: any[]; } = {};
            const timestamp = Date.now();

            // Add first edit
            addMetadataEdit(metadata, "videoUrl", "https://example.com/video.mp4", "test-author");
            const firstEdit = metadata.edits![0];
            const firstTimestamp = firstEdit.timestamp;

            // Manually add a duplicate with same timestamp
            metadata.edits!.push({
                ...firstEdit,
                timestamp: firstTimestamp,
            });

            assert.strictEqual(metadata.edits!.length, 2, "Should have two edits before deduplication");

            // Add another edit which will trigger deduplication
            addMetadataEdit(metadata, "textDirection", "rtl", "test-author");

            // Should have deduplicated the duplicate videoUrl edit
            const videoUrlEdits = metadata.edits!.filter((e: any) =>
                EditMapUtils.equals(e.editMap, EditMapUtils.metadataVideoUrl())
            );
            assert.strictEqual(videoUrlEdits.length, 1, "Should deduplicate identical edits");
            assert.strictEqual(videoUrlEdits[0].value, "https://example.com/video.mp4", "Remaining edit should have correct value");
        });

        test("should create edits array if it doesn't exist", () => {
            const metadata: { edits?: any[]; } = {};
            addMetadataEdit(metadata, "videoUrl", "https://example.com/video.mp4", "test-author");
            assert.ok(metadata.edits, "Should create edits array");
            assert.strictEqual(metadata.edits!.length, 1, "Should have one edit");
        });

        test("should use correct editMap for different fields", () => {
            const metadata: { edits?: any[]; } = {};

            addMetadataEdit(metadata, "videoUrl", "https://example.com/video.mp4", "test-author");
            addMetadataEdit(metadata, "textDirection", "rtl", "test-author");
            addMetadataEdit(metadata, "lineNumbersEnabled", false, "test-author");
            addMetadataEdit(metadata, "fontSize", 16, "test-author");
            addMetadataEdit(metadata, "corpusMarker", "NT", "test-author");

            const edits = metadata.edits!;
            assert.ok(edits.some((e: any) => EditMapUtils.equals(e.editMap, EditMapUtils.metadataVideoUrl())), "Should have videoUrl editMap");
            assert.ok(edits.some((e: any) => EditMapUtils.equals(e.editMap, EditMapUtils.metadataTextDirection())), "Should have textDirection editMap");
            assert.ok(edits.some((e: any) => EditMapUtils.equals(e.editMap, EditMapUtils.metadataLineNumbersEnabled())), "Should have lineNumbersEnabled editMap");
            assert.ok(edits.some((e: any) => EditMapUtils.equals(e.editMap, EditMapUtils.metadataFontSize())), "Should have fontSize editMap");
            assert.ok(edits.some((e: any) => EditMapUtils.equals(e.editMap, EditMapUtils.metadataCorpusMarker())), "Should have corpusMarker editMap");
        });
    });

    suite("addProjectMetadataEdit", () => {
        test("should create edits array if it doesn't exist", () => {
            const metadata: { edits?: ProjectEditHistory[]; } = {};
            addProjectMetadataEdit(metadata, EditMapUtils.projectName(), "Test Project", "test-author");
            assert.ok(metadata.edits, "Should create edits array");
            assert.strictEqual(metadata.edits!.length, 1, "Should have one edit");
        });

        test("should add edit with correct editMap, value, timestamp, type, and author", () => {
            const metadata: { edits?: ProjectEditHistory<["projectName"]>[]; } = {};
            const testProjectName = "My Test Project";
            const testAuthor = "test-author";

            addProjectMetadataEdit(metadata, EditMapUtils.projectName(), testProjectName, testAuthor);

            assert.ok(metadata.edits, "Should have edits array");
            assert.strictEqual(metadata.edits!.length, 1, "Should have one edit");

            const edit: ProjectEditHistory<["projectName"]> = metadata.edits![0];
            assert.ok(EditMapUtils.equals(edit.editMap, EditMapUtils.projectName()), "Should have correct editMap");
            assert.strictEqual(edit.value, testProjectName, "Should have correct value");
            assert.strictEqual(edit.type, EditType.USER_EDIT, "Should have USER_EDIT type");
            assert.ok(typeof edit.timestamp === "number", "Should have timestamp");
            assert.ok(edit.timestamp > 0, "Timestamp should be positive");
            assert.strictEqual(edit.author, testAuthor, "Should have correct author");
        });

        test("should use correct editMap for projectName", () => {
            const metadata: { edits?: ProjectEditHistory<["projectName"]>[]; } = {};
            addProjectMetadataEdit(metadata, EditMapUtils.projectName(), "Test Project", "test-author");

            const edits = metadata.edits!;
            assert.ok(edits.some((e) => EditMapUtils.equals(e.editMap, EditMapUtils.projectName())), "Should have projectName editMap");
            const projectNameEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.projectName()));
            assert.ok(projectNameEdit, "Should find projectName edit");
            assert.strictEqual(projectNameEdit!.value, "Test Project", "Should have correct projectName value");
        });

        test("should use correct editMap for meta.generator", () => {
            const metadata: { edits?: ProjectEditHistory<["meta", "generator"]>[]; } = {};
            const generatorValue = {
                userName: "Test User",
                userEmail: "test@example.com"
            };
            addProjectMetadataEdit(metadata, EditMapUtils.metaGenerator(), generatorValue, "test-author");

            const edits = metadata.edits!;
            assert.ok(edits.some((e) => EditMapUtils.equals(e.editMap, EditMapUtils.metaGenerator())), "Should have meta.generator editMap");
            const generatorEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.metaGenerator()));
            assert.ok(generatorEdit, "Should find meta.generator edit");
            assert.deepStrictEqual(generatorEdit!.value, generatorValue, "Should have correct generator value");
        });

        test("should use correct editMap for meta (partial object)", () => {
            const metadata: { edits?: ProjectEditHistory<["meta"]>[]; } = {};
            const metaPartial = {
                validationCount: 5,
                abbreviation: "NT"
            };
            addProjectMetadataEdit(metadata, EditMapUtils.meta(), metaPartial, "test-author");

            const edits = metadata.edits!;
            assert.ok(edits.some((e) => EditMapUtils.equals(e.editMap, EditMapUtils.meta())), "Should have meta editMap");
            const metaEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.meta()));
            assert.ok(metaEdit, "Should find meta edit");
            assert.deepStrictEqual(metaEdit!.value, metaPartial, "Should have correct meta partial value");
        });

        test("should use correct editMap for languages", () => {
            const metadata: { edits?: ProjectEditHistory<["languages"]>[]; } = {};
            const languagesValue = ["en", "fr"];
            addProjectMetadataEdit(metadata, EditMapUtils.languages(), languagesValue, "test-author");

            const edits = metadata.edits!;
            assert.ok(edits.some((e) => EditMapUtils.equals(e.editMap, EditMapUtils.languages())), "Should have languages editMap");
            const languagesEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.languages()));
            assert.ok(languagesEdit, "Should find languages edit");
            assert.deepStrictEqual(languagesEdit!.value, languagesValue, "Should have correct languages value");
        });

        test("should use correct editMap for spellcheckIsEnabled", () => {
            const metadata: { edits?: ProjectEditHistory<["spellcheckIsEnabled"]>[]; } = {};
            addProjectMetadataEdit(metadata, EditMapUtils.spellcheckIsEnabled(), true, "test-author");

            const edits = metadata.edits!;
            assert.ok(edits.some((e) => EditMapUtils.equals(e.editMap, EditMapUtils.spellcheckIsEnabled())), "Should have spellcheckIsEnabled editMap");
            const spellcheckEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.spellcheckIsEnabled()));
            assert.ok(spellcheckEdit, "Should find spellcheckIsEnabled edit");
            assert.strictEqual(spellcheckEdit!.value, true, "Should have correct spellcheckIsEnabled value");
        });

        test("should deduplicate identical edits", () => {
            const metadata: { edits?: ProjectEditHistory<["projectName"]>[]; } = {};
            const testProjectName = "Test Project";
            const testAuthor = "test-author";

            // Add first edit
            addProjectMetadataEdit(metadata, EditMapUtils.projectName(), testProjectName, testAuthor);
            const firstEdit = metadata.edits![0];
            const firstTimestamp = firstEdit.timestamp;

            // Manually add a duplicate with same timestamp
            metadata.edits!.push({
                editMap: EditMapUtils.projectName(),
                value: testProjectName,
                timestamp: firstTimestamp,
                type: EditType.USER_EDIT,
                author: testAuthor,
            });

            assert.strictEqual(metadata.edits!.length, 2, "Should have two edits before deduplication");

            // Add another edit which will trigger deduplication
            addProjectMetadataEdit(metadata, EditMapUtils.spellcheckIsEnabled(), true, testAuthor);

            // Should have deduplicated the duplicate projectName edit
            const projectNameEdits = metadata.edits!.filter((e) =>
                EditMapUtils.equals(e.editMap, EditMapUtils.projectName())
            );
            assert.strictEqual(projectNameEdits.length, 1, "Should deduplicate identical edits");
            assert.strictEqual(projectNameEdits[0].value, testProjectName, "Remaining edit should have correct value");
        });

        test("should preserve edits with different timestamps", () => {
            const metadata: { edits?: ProjectEditHistory<["projectName"]>[]; } = {};
            const testProjectName = "Test Project";
            const testAuthor = "test-author";

            // Add first edit
            addProjectMetadataEdit(metadata, EditMapUtils.projectName(), testProjectName, testAuthor);
            const firstTimestamp = metadata.edits![0].timestamp;

            // Wait a bit to ensure different timestamp
            const waitTime = 10;
            return new Promise<void>((resolve) => {
                setTimeout(() => {
                    // Manually add edit with different timestamp
                    metadata.edits!.push({
                        editMap: EditMapUtils.projectName(),
                        value: testProjectName,
                        timestamp: firstTimestamp + waitTime,
                        type: EditType.USER_EDIT,
                        author: testAuthor,
                    });

                    // Trigger deduplication
                    addProjectMetadataEdit(metadata, EditMapUtils.spellcheckIsEnabled(), true, testAuthor);

                    const projectNameEdits = metadata.edits!.filter((e) =>
                        EditMapUtils.equals(e.editMap, EditMapUtils.projectName())
                    );
                    assert.strictEqual(projectNameEdits.length, 2, "Should preserve edits with different timestamps");
                    resolve();
                }, waitTime);
            });
        });

        test("should preserve edits with different values", () => {
            const metadata: { edits?: ProjectEditHistory<["projectName"]>[]; } = {};
            const testAuthor = "test-author";
            const timestamp = Date.now();

            // Add first project name
            addProjectMetadataEdit(metadata, EditMapUtils.projectName(), "Project 1", testAuthor);
            const firstTimestamp = metadata.edits![0].timestamp;

            // Manually add edit with same timestamp but different value
            metadata.edits!.push({
                editMap: EditMapUtils.projectName(),
                value: "Project 2",
                timestamp: firstTimestamp,
                type: EditType.USER_EDIT,
                author: testAuthor,
            });

            // Trigger deduplication
            addProjectMetadataEdit(metadata, EditMapUtils.spellcheckIsEnabled(), true, testAuthor);

            const projectNameEdits = metadata.edits!.filter((e) =>
                EditMapUtils.equals(e.editMap, EditMapUtils.projectName())
            );
            assert.strictEqual(projectNameEdits.length, 2, "Should preserve edits with different values");
            assert.ok(projectNameEdits.some((e) => e.value === "Project 1"), "Should have first value");
            assert.ok(projectNameEdits.some((e) => e.value === "Project 2"), "Should have second value");
        });

        test("should preserve edits with different editMaps", () => {
            const metadata: { edits?: ProjectEditHistory[]; } = {};
            const testAuthor = "test-author";

            addProjectMetadataEdit(metadata, EditMapUtils.projectName(), "Test Project", testAuthor);
            addProjectMetadataEdit(metadata, EditMapUtils.languages(), ["en", "fr"], testAuthor);
            addProjectMetadataEdit(metadata, EditMapUtils.spellcheckIsEnabled(), true, testAuthor);

            const edits = metadata.edits!;
            assert.strictEqual(edits.length, 3, "Should preserve edits with different editMaps");
            assert.ok(edits.some((e) => EditMapUtils.equals(e.editMap, EditMapUtils.projectName())), "Should have projectName edit");
            assert.ok(edits.some((e) => EditMapUtils.equals(e.editMap, EditMapUtils.languages())), "Should have languages edit");
            assert.ok(edits.some((e) => EditMapUtils.equals(e.editMap, EditMapUtils.spellcheckIsEnabled())), "Should have spellcheckIsEnabled edit");
        });
    });
});

