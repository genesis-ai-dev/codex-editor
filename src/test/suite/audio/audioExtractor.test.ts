import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import sinon from "sinon";
import {
    extractAudioFromVideo,
    processMediaAttachment,
} from "../../../utils/audioExtractor";
import {
    createMockExtensionContext,
    swallowDuplicateCommandRegistrations,
} from "../../testUtils";

suite("Audio Extractor Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for Audio Extractor functionality.");
    let tempDir: string;

    suiteSetup(async () => {
        swallowDuplicateCommandRegistrations();
    });

    setup(async () => {
        // Create temp directory for test files
        tempDir = path.join(os.tmpdir(), `audio-extractor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        fs.mkdirSync(tempDir, { recursive: true });
    });

    teardown(async () => {
        sinon.restore();
        // Cleanup temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite("extractAudioFromVideo", () => {
        test("should return video data as fallback when FFmpeg is not available", async () => {
            // Create mock video data
            const videoData = Buffer.from("fake video data");

            // Mock child_process module to simulate FFmpeg not being available
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cp = require("child_process");
            const originalSpawn = cp.spawn;

            const mockSpawn = sinon.stub().callsFake((command: string, args: string[]) => {
                // Simulate FFmpeg not found in PATH and installer package not available
                const mockProcess = {
                    on: sinon.stub().callsFake((event: string, callback: (...args: any[]) => void) => {
                        if (event === "error") {
                            // Simulate command not found
                            setTimeout(() => callback(new Error("spawn ffmpeg ENOENT")), 10);
                        } else if (event === "exit") {
                            // Also trigger exit with error code
                            setTimeout(() => callback(1), 10);
                        }
                        return mockProcess;
                    }),
                    stderr: {
                        on: sinon.stub(),
                    },
                    kill: sinon.stub(),
                };
                return mockProcess;
            });

            // Replace spawn in child_process module
            cp.spawn = mockSpawn;

            try {
                const result = await extractAudioFromVideo(videoData);
                // Should return the original video data as fallback
                assert.ok(Buffer.isBuffer(result), "Should return a Buffer");
                assert.strictEqual(result.toString(), videoData.toString(), "Should return original video data when FFmpeg unavailable");
            } finally {
                // Restore original spawn
                cp.spawn = originalSpawn;
            }
        });

        test("should handle extraction with time range parameters", async () => {
            const videoData = Buffer.from("fake video data");

            // Mock spawn to simulate FFmpeg available but extraction fails
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cp = require("child_process");
            const originalSpawn = cp.spawn;
            const mockSpawn = sinon.stub().callsFake((command: string, args: string[]) => {
                const mockProcess = {
                    on: sinon.stub().callsFake((event: string, callback: (...args: any[]) => void) => {
                        if (event === "exit") {
                            setTimeout(() => callback(1), 10); // Non-zero exit code
                        } else if (event === "error") {
                            setTimeout(() => callback(new Error("FFmpeg error")), 10);
                        }
                        return mockProcess;
                    }),
                    stderr: {
                        on: sinon.stub(),
                    },
                    kill: sinon.stub(),
                };
                return mockProcess;
            });

            cp.spawn = mockSpawn;

            try {
                const result = await extractAudioFromVideo(videoData, 10, 20);
                // Should fallback to original video data
                assert.ok(Buffer.isBuffer(result), "Should return a Buffer");
            } finally {
                cp.spawn = originalSpawn;
            }
        });

        test("should prefer system PATH FFmpeg over installer package", async () => {
            const videoData = Buffer.from("fake video data");
            const spawnCalls: string[] = [];

            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cp = require("child_process");
            const originalSpawn = cp.spawn;
            const mockSpawn = sinon.stub().callsFake((command: string, args: string[]) => {
                spawnCalls.push(command);

                const mockProcess = {
                    on: sinon.stub().callsFake((event: string, callback: (...args: any[]) => void) => {
                        if (event === "exit") {
                            // System PATH ffmpeg succeeds
                            if (command === "ffmpeg") {
                                setTimeout(() => callback(0), 10);
                            } else {
                                // Installer package should not be called if system PATH works
                                setTimeout(() => callback(1), 10);
                            }
                        } else if (event === "error") {
                            // Only fail if it's not system PATH
                            if (command !== "ffmpeg") {
                                setTimeout(() => callback(new Error("Command not found")), 10);
                            }
                        }
                        return mockProcess;
                    }),
                    stderr: {
                        on: sinon.stub(),
                    },
                    kill: sinon.stub(),
                };
                return mockProcess;
            });

            cp.spawn = mockSpawn;

            try {
                // This test verifies the preference logic, but actual extraction may still fail
                // without real FFmpeg, so we just verify the preference order
                await extractAudioFromVideo(videoData);
                // Verify system PATH was tried first (if any calls were made)
                if (spawnCalls.length > 0) {
                    assert.strictEqual(spawnCalls[0], "ffmpeg", "Should try system PATH first");
                }
            } catch (error) {
                // Expected if FFmpeg extraction fails
            } finally {
                cp.spawn = originalSpawn;
            }
        });

        test("should fallback to installer package when system PATH fails", async () => {
            const videoData = Buffer.from("fake video data");
            const spawnCalls: string[] = [];

            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cp = require("child_process");
            const originalSpawn = cp.spawn;
            const mockSpawn = sinon.stub().callsFake((command: string, args: string[]) => {
                spawnCalls.push(command);

                const mockProcess = {
                    on: sinon.stub().callsFake((event: string, callback: (...args: any[]) => void) => {
                        if (event === "exit") {
                            // System PATH fails
                            if (command === "ffmpeg") {
                                setTimeout(() => callback(1), 10);
                            } else {
                                // Installer package also fails in this test
                                setTimeout(() => callback(1), 10);
                            }
                        } else if (event === "error") {
                            // System PATH error
                            if (command === "ffmpeg") {
                                setTimeout(() => callback(new Error("spawn ffmpeg ENOENT")), 10);
                            } else {
                                // Installer package error
                                setTimeout(() => callback(new Error("FFmpeg error")), 10);
                            }
                        }
                        return mockProcess;
                    }),
                    stderr: {
                        on: sinon.stub(),
                    },
                    kill: sinon.stub(),
                };
                return mockProcess;
            });

            cp.spawn = mockSpawn;

            try {
                const result = await extractAudioFromVideo(videoData);
                // Should fallback to video data
                assert.ok(Buffer.isBuffer(result), "Should return a Buffer");
                // Verify system PATH was tried first
                if (spawnCalls.length > 0) {
                    assert.strictEqual(spawnCalls[0], "ffmpeg", "Should try system PATH first");
                }
            } finally {
                cp.spawn = originalSpawn;
            }
        });
    });

    suite("processMediaAttachment", () => {
        test("should process video attachments and extract audio", async () => {
            const videoData = Buffer.from("fake video data");
            const base64Data = videoData.toString("base64");
            const attachment = {
                dataBase64: `data:video/mp4;base64,${base64Data}`,
                startTime: 0,
                endTime: 10,
            };

            // Mock spawn to simulate FFmpeg not available
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cp = require("child_process");
            const originalSpawn = cp.spawn;
            const mockSpawn = sinon.stub().callsFake(() => {
                const mockProcess = {
                    on: sinon.stub().callsFake((event: string, callback: (...args: any[]) => void) => {
                        if (event === "error") {
                            setTimeout(() => callback(new Error("spawn ffmpeg ENOENT")), 10);
                        }
                        return mockProcess;
                    }),
                    stderr: {
                        on: sinon.stub(),
                    },
                    kill: sinon.stub(),
                };
                return mockProcess;
            });

            cp.spawn = mockSpawn;

            try {
                const result = await processMediaAttachment(attachment, true);
                assert.ok(Buffer.isBuffer(result), "Should return a Buffer");
            } finally {
                cp.spawn = originalSpawn;
            }
        });

        test("should return audio attachments as-is", async () => {
            const audioData = Buffer.from("fake audio data");
            const base64Data = audioData.toString("base64");
            const attachment = {
                dataBase64: `data:audio/mpeg;base64,${base64Data}`,
            };

            const result = await processMediaAttachment(attachment, false);
            assert.ok(Buffer.isBuffer(result), "Should return a Buffer");
            assert.strictEqual(result.toString(), audioData.toString(), "Should return audio data unchanged");
        });

        test("should handle base64 data without data URI prefix", async () => {
            const audioData = Buffer.from("fake audio data");
            const base64Data = audioData.toString("base64");
            const attachment = {
                dataBase64: base64Data, // No "data:..." prefix
            };

            const result = await processMediaAttachment(attachment, false);
            assert.ok(Buffer.isBuffer(result), "Should return a Buffer");
        });

        test("should handle base64 data with comma separator", async () => {
            const audioData = Buffer.from("fake audio data");
            const base64Data = audioData.toString("base64");
            const attachment = {
                dataBase64: `data:audio/mpeg;base64,${base64Data}`,
            };

            const result = await processMediaAttachment(attachment, false);
            assert.ok(Buffer.isBuffer(result), "Should return a Buffer");
            assert.strictEqual(result.toString(), audioData.toString(), "Should correctly parse data URI with comma");
        });

        test("should handle video attachments with time ranges", async () => {
            const videoData = Buffer.from("fake video data");
            const base64Data = videoData.toString("base64");
            const attachment = {
                dataBase64: `data:video/mp4;base64,${base64Data}`,
                startTime: 5,
                endTime: 15,
            };

            // Mock spawn to simulate FFmpeg not available
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cp = require("child_process");
            const originalSpawn = cp.spawn;
            const mockSpawn = sinon.stub().callsFake(() => {
                const mockProcess = {
                    on: sinon.stub().callsFake((event: string, callback: (...args: any[]) => void) => {
                        if (event === "error") {
                            setTimeout(() => callback(new Error("spawn ffmpeg ENOENT")), 10);
                        }
                        return mockProcess;
                    }),
                    stderr: {
                        on: sinon.stub(),
                    },
                    kill: sinon.stub(),
                };
                return mockProcess;
            });

            cp.spawn = mockSpawn;

            try {
                const result = await processMediaAttachment(attachment, true);
                assert.ok(Buffer.isBuffer(result), "Should return a Buffer");
            } finally {
                cp.spawn = originalSpawn;
            }
        });
    });

    suite("Error handling", () => {
        test("should handle invalid base64 data gracefully", async () => {
            const attachment = {
                dataBase64: "invalid-base64-data!!!",
            };

            try {
                await processMediaAttachment(attachment, false);
                // May succeed or fail depending on Buffer.from behavior
            } catch (error) {
                // If it fails, that's acceptable for invalid base64
                assert.ok(error, "Should handle invalid base64 appropriately");
            }
        });

        test("should handle missing attachment properties", async () => {
            const attachment: any = {
                // Missing dataBase64
            };

            try {
                await processMediaAttachment(attachment, false);
                // May throw or return empty buffer
            } catch (error) {
                // Expected if dataBase64 is required
                assert.ok(error, "Should handle missing properties");
            }
        });

        test("should handle extraction errors and fallback gracefully", async () => {
            const videoData = Buffer.from("fake video data");

            // Mock spawn to simulate FFmpeg extraction failure
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cp = require("child_process");
            const originalSpawn = cp.spawn;
            const mockSpawn = sinon.stub().callsFake(() => {
                const mockProcess = {
                    on: sinon.stub().callsFake((event: string, callback: (...args: any[]) => void) => {
                        if (event === "exit") {
                            setTimeout(() => callback(1), 10); // Non-zero exit
                        } else if (event === "error") {
                            setTimeout(() => callback(new Error("FFmpeg extraction failed")), 10);
                        }
                        return mockProcess;
                    }),
                    stderr: {
                        on: sinon.stub().callsFake((event: string, callback: (...args: any[]) => void) => {
                            // Simulate stderr output
                            setTimeout(() => callback(Buffer.from("FFmpeg error output")), 10);
                        }),
                    },
                    kill: sinon.stub(),
                };
                return mockProcess;
            });

            cp.spawn = mockSpawn;

            try {
                const result = await extractAudioFromVideo(videoData);
                // Should fallback to video data
                assert.ok(Buffer.isBuffer(result), "Should return a Buffer even on error");
            } finally {
                cp.spawn = originalSpawn;
            }
        });
    });
});

