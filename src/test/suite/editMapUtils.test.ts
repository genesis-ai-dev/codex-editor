import * as assert from "assert";
import { EditMapUtils, deduplicateFileMetadataEdits, addMetadataEdit } from "../../utils/editMapUtils";
import { EditType } from "../../../types/enums";
import { FileEditHistory } from "../../../types";

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
});

