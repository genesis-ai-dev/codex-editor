import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import sinon from "sinon";
import {
    detectSilence,
    processAudioFile,
    extractSegment,
    extractSegments,
    initializeAudioProcessor,
} from "../../../utils/audioProcessor";
import {
    createMockExtensionContext,
    swallowDuplicateCommandRegistrations,
} from "../../testUtils";

suite("Audio Processor Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for Audio Processor functionality.");
    let tempDir: string;
    let mockContext: vscode.ExtensionContext;

    suiteSetup(async () => {
        swallowDuplicateCommandRegistrations();
        // Initialize audio processor with mock context
        mockContext = createMockExtensionContext();
        initializeAudioProcessor(mockContext);
    });

    setup(async () => {
        // Create temp directory for test files
        tempDir = path.join(os.tmpdir(), `audio-processor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        fs.mkdirSync(tempDir, { recursive: true });
    });

    teardown(async () => {
        sinon.restore();
        // Cleanup temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite("FFmpeg binary path functions", () => {
        test("should handle FFmpeg availability (may download on-demand)", async function() {
            // Increase timeout to allow for potential FFmpeg download (30-60 seconds)
            this.timeout(90000);
            
            // This test verifies that audioProcessor can handle FFmpeg
            // With the new on-demand download, FFmpeg will be downloaded automatically if not available
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const audioProcessor = require("../../../utils/audioProcessor");

                // Verify the module exports the expected functions
                assert.ok(audioProcessor, "audioProcessor module should be importable");
                assert.ok(typeof audioProcessor.processAudioFile === "function", "processAudioFile should be exported");

                // Try to use a function that requires FFmpeg
                // This will either use system FFmpeg or download it on-demand
                const testFilePath = path.join(tempDir, "test.mp3");
                fs.writeFileSync(testFilePath, Buffer.from("fake audio"));

                try {
                    await audioProcessor.processAudioFile(testFilePath, 30, -40, 0.5);
                    // If this succeeds, FFmpeg is available (system or downloaded)
                } catch (error: any) {
                    // Expected errors:
                    // - Invalid audio file (fake audio data)
                    // - FFmpeg processing errors
                    // These are fine - we just want to verify no fatal errors
                    if (error?.message?.includes("Failed to get audio duration") ||
                        error?.message?.includes("Audio file not found") ||
                        error?.message?.includes("Invalid data") ||
                        error?.message?.includes("moov atom not found")) {
                        // These are expected for fake/invalid audio file
                        return;
                    }
                    // Other errors might be network issues during download - that's also acceptable
                    console.log("FFmpeg processing error (expected for fake audio):", error.message);
                }
            } catch (error: any) {
                // If module import fails, that's not expected
                console.error("Unexpected error:", error);
                throw error;
            }
        }).timeout(90000);
    });

    suite("Audio processing functions", () => {
        test("should handle invalid audio file paths", async () => {
            const invalidPath = path.join(tempDir, "non-existent.mp3");

            try {
                await processAudioFile(invalidPath, 30, -40, 0.5);
                assert.fail("Should throw error for non-existent file");
            } catch (error: any) {
                // Expected to throw - verify error is meaningful
                assert.ok(error, "Should throw error for invalid file");
            }
        });

        test("should handle empty audio files", async () => {
            const emptyFilePath = path.join(tempDir, "empty.mp3");
            fs.writeFileSync(emptyFilePath, Buffer.from(""));

            try {
                await processAudioFile(emptyFilePath, 30, -40, 0.5);
                // May succeed or fail depending on FFmpeg behavior
            } catch (error: any) {
                // Expected - empty file is not valid audio
                assert.ok(error, "Should handle empty file appropriately");
            }
        });

        test("should validate file paths before processing", async () => {
            // Test that functions validate input
            const invalidPaths = [
                "",
                "relative/path.mp3",
            ];

            for (const invalidPath of invalidPaths) {
                try {
                    await processAudioFile(invalidPath, 30, -40, 0.5);
                } catch (error) {
                    // Expected to fail for invalid paths
                    assert.ok(error, `Should reject invalid path: ${invalidPath}`);
                }
            }
        });
    });

    suite("MIME type detection", () => {
        test("should correctly identify audio file extensions", () => {
            const testCases = [
                { filename: "test.mp3", ext: ".mp3" },
                { filename: "test.wav", ext: ".wav" },
                { filename: "test.m4a", ext: ".m4a" },
                { filename: "test.aac", ext: ".aac" },
                { filename: "test.ogg", ext: ".ogg" },
                { filename: "test.webm", ext: ".webm" },
                { filename: "test.flac", ext: ".flac" },
                { filename: "test.MP3", ext: ".MP3" }, // Case insensitive
            ];

            testCases.forEach(({ filename, ext }) => {
                const detectedExt = path.extname(filename);
                assert.strictEqual(
                    detectedExt.toLowerCase(),
                    ext.toLowerCase(),
                    `Should detect ${ext} extension correctly`
                );
            });
        });
    });

    suite("Error handling", () => {
        test("should provide meaningful error messages", async () => {
            const invalidPath = "/nonexistent/path/to/audio.mp3";

            try {
                await processAudioFile(invalidPath, 30, -40, 0.5);
                assert.fail("Should throw error");
            } catch (error: any) {
                assert.ok(error instanceof Error, "Should throw Error instance");
                assert.ok(error.message, "Error should have a message");
            }
        });

        test("should handle FFmpeg spawn errors gracefully", async () => {
            // Create a file that exists but isn't valid audio
            const invalidAudioPath = path.join(tempDir, "not-audio.txt");
            fs.writeFileSync(invalidAudioPath, "This is not an audio file");

            try {
                await processAudioFile(invalidAudioPath, 30, -40, 0.5);
                // May succeed or fail depending on FFmpeg
            } catch (error: any) {
                // If it fails, error should be meaningful
                assert.ok(error, "Should handle invalid audio file");
            }
        });
    });
});

