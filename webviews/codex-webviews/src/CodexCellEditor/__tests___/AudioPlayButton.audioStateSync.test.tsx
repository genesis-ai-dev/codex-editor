import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AudioPlayButton from "../AudioPlayButton";

// Mock the VSCode API
const mockVscode = {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
};

Object.defineProperty(window, "vscodeApi", {
    value: mockVscode,
    writable: true,
});

// Mock the acquireVsCodeApi function
global.acquireVsCodeApi = vi.fn().mockReturnValue(mockVscode);

// Mock audio controller
const mockPlayExclusive = vi.fn().mockResolvedValue(undefined);
const mockAddListener = vi.fn();
const mockRemoveListener = vi.fn();

vi.mock("../lib/audioController", () => ({
    globalAudioController: {
        playExclusive: mockPlayExclusive,
        addListener: mockAddListener,
        removeListener: mockRemoveListener,
    },
}));

// Mock audio cache
const mockGetCachedAudioDataUrl = vi.fn().mockReturnValue("blob:test-audio-url");
vi.mock("../lib/audioCache", () => ({
    getCachedAudioDataUrl: () => mockGetCachedAudioDataUrl(),
    setCachedAudioDataUrl: vi.fn(),
}));

// Mock useMessageHandler
vi.mock("../hooks/useCentralizedMessageDispatcher", () => ({
    useMessageHandler: vi.fn(() => {}),
}));

describe("AudioPlayButton - Audio State Synchronization", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockVscode.postMessage.mockClear();
        mockPlayExclusive.mockClear();
        mockPlayExclusive.mockResolvedValue(undefined);
        mockGetCachedAudioDataUrl.mockReturnValue("blob:test-audio-url");
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("disabled prop behavior", () => {
        it("should disable button when disabled prop is true", () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-1"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={true}
                    isSourceText={false}
                />
            );

            const button = screen.getByRole("button") as HTMLButtonElement;
            expect(button.disabled).toBe(true);
        });

        it("should enable button when disabled prop is false", () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-2"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={false}
                    isSourceText={false}
                />
            );

            const button = screen.getByRole("button") as HTMLButtonElement;
            expect(button.disabled).toBe(false);
        });

        it("should not call handlePlayAudio when disabled and clicked", async () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-3"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={true}
                    isSourceText={false}
                />
            );

            const button = screen.getByRole("button");
            fireEvent.click(button);

            // Wait a bit to ensure any async operations complete
            await waitFor(() => {
                // playExclusive should not be called when disabled
                expect(mockPlayExclusive).not.toHaveBeenCalled();
            });
        });

        it("should show disabled tooltip when disabled", () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-4"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={true}
                    isSourceText={false}
                />
            );

            const button = screen.getByRole("button");
            expect(button.getAttribute("title")).toBe(
                "Audio playback disabled - other type is playing"
            );
        });

        it("should apply disabled styling (opacity and cursor)", () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-5"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={true}
                    isSourceText={false}
                />
            );

            const button = screen.getByRole("button");
            const styles = window.getComputedStyle(button);
            expect(button.style.opacity).toBe("0.4");
            expect(button.style.cursor).toBe("not-allowed");
        });
    });

    describe("audio state broadcasting", () => {
        it("should broadcast audio state change with isPlaying false when audio stops", async () => {
            const { rerender } = render(
                <AudioPlayButton
                    cellId="test-cell-stop-1"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={false}
                    isSourceText={false}
                />
            );

            // Simulate audio stopping by triggering the onended callback
            const mockAudio = {
                play: vi.fn().mockResolvedValue(undefined),
                pause: vi.fn(),
                onended: null as any,
                src: "",
                readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
            };

            global.Audio = vi.fn().mockImplementation(() => mockAudio) as any;

            const button = screen.getByRole("button");
            fireEvent.click(button);

            // Wait for audio to start
            await waitFor(() => {
                expect(mockAudio.onended).toBeDefined();
            });

            // Simulate audio ending
            if (mockAudio.onended) {
                mockAudio.onended();
            }

            await waitFor(() => {
                const stopMessages = mockVscode.postMessage.mock.calls.filter(
                    (call: any[]) =>
                        call[0]?.command === "audioStateChanged" &&
                        call[0]?.content?.isPlaying === false
                );

                expect(stopMessages.length).toBeGreaterThan(0);
            });
        });

        it("should include correct message structure in broadcast", async () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-structure-1"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={false}
                    isSourceText={true}
                />
            );

            const mockAudio = {
                play: vi.fn().mockResolvedValue(undefined),
                pause: vi.fn(),
                onended: null as any,
                src: "",
                readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
            };

            global.Audio = vi.fn().mockImplementation(() => mockAudio) as any;

            const button = screen.getByRole("button");
            fireEvent.click(button);

            await waitFor(() => {
                const calls = mockVscode.postMessage.mock.calls;
                const audioStateCall = calls.find(
                    (call: any[]) =>
                        call[0]?.command === "audioStateChanged" &&
                        call[0]?.destination === "webview" &&
                        call[0]?.content?.type === "audioPlaying"
                );

                expect(audioStateCall).toBeDefined();
                if (!audioStateCall) return;
                const message = audioStateCall[0];
                expect(message).toHaveProperty("command", "audioStateChanged");
                expect(message).toHaveProperty("destination", "webview");
                expect(message).toHaveProperty("content");
                expect(message.content).toHaveProperty("type", "audioPlaying");
                expect(message.content).toHaveProperty("webviewType", "source");
                expect(message.content).toHaveProperty("isPlaying");
                expect(typeof message.content.isPlaying).toBe("boolean");
            });
        });
    });

    describe("isSourceText prop", () => {
        it("should broadcast webviewType as 'source' when isSourceText is true", async () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-source-type"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={false}
                    isSourceText={true}
                />
            );

            const mockAudio = {
                play: vi.fn().mockResolvedValue(undefined),
                pause: vi.fn(),
                onended: null as any,
                src: "",
                readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
            };

            global.Audio = vi.fn().mockImplementation(() => mockAudio) as any;

            const button = screen.getByRole("button");
            fireEvent.click(button);

            await waitFor(() => {
                const sourceMessages = mockVscode.postMessage.mock.calls.filter(
                    (call: any[]) => call[0]?.content?.webviewType === "source"
                );

                expect(sourceMessages.length).toBeGreaterThan(0);
            });
        });

        it("should broadcast webviewType as 'target' when isSourceText is false", async () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-target-type"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={false}
                    isSourceText={false}
                />
            );

            const mockAudio = {
                play: vi.fn().mockResolvedValue(undefined),
                pause: vi.fn(),
                onended: null as any,
                src: "",
                readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
            };

            global.Audio = vi.fn().mockImplementation(() => mockAudio) as any;

            const button = screen.getByRole("button");
            fireEvent.click(button);

            await waitFor(() => {
                const targetMessages = mockVscode.postMessage.mock.calls.filter(
                    (call: any[]) => call[0]?.content?.webviewType === "target"
                );

                expect(targetMessages.length).toBeGreaterThan(0);
            });
        });
    });

    describe("disabled state interaction with hover", () => {
        it("should not change opacity on hover when disabled", () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-hover-disabled"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={true}
                    isSourceText={false}
                />
            );

            const button = screen.getByRole("button");
            const initialOpacity = button.style.opacity;

            fireEvent.mouseEnter(button);
            expect(button.style.opacity).toBe(initialOpacity); // Should remain at 0.4

            fireEvent.mouseLeave(button);
            expect(button.style.opacity).toBe(initialOpacity); // Should remain at 0.4
        });

        it("should change opacity on hover when not disabled", () => {
            render(
                <AudioPlayButton
                    cellId="test-cell-hover-enabled"
                    state="available"
                    vscode={mockVscode as any}
                    disabled={false}
                    isSourceText={false}
                />
            );

            const button = screen.getByRole("button");
            const initialOpacity = button.style.opacity;

            fireEvent.mouseEnter(button);
            expect(button.style.opacity).toBe("1");

            fireEvent.mouseLeave(button);
            expect(button.style.opacity).toBe(initialOpacity);
        });
    });
});
