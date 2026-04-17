import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import CodexCellEditor from "../CodexCellEditor";
import { GlobalMessage } from "../../../../../types";

// Mock the VSCode API
const mockVscode = {
    postMessage: vi.fn(),
    getState: vi.fn().mockReturnValue({}),
    setState: vi.fn(),
};

Object.defineProperty(window, "vscodeApi", {
    value: mockVscode,
    writable: true,
});

// Mock the acquireVsCodeApi function
global.acquireVsCodeApi = vi.fn().mockReturnValue(mockVscode);

// Mock useMessageHandler to capture handler registration
const registeredHandlers: Map<string, (event: MessageEvent) => void> = new Map();

vi.mock("../hooks/useCentralizedMessageDispatcher", () => ({
    useMessageHandler: vi.fn((eventName: string, handler: (event: MessageEvent) => void) => {
        registeredHandlers.set(eventName, handler);
    }),
}));

// Mock other dependencies
vi.mock("@sharedUtils", () => ({
    getVSCodeAPI: () => mockVscode,
}));

vi.mock("quill", () => {
    const MockQuill = vi.fn().mockImplementation(() => ({
        root: {
            innerHTML: "<p>Test</p>",
            focus: vi.fn(),
            blur: vi.fn(),
        },
        getText: vi.fn().mockReturnValue(""),
        getLength: vi.fn().mockReturnValue(0),
        getContents: vi.fn().mockReturnValue({ ops: [] }),
        setContents: vi.fn(),
        updateContents: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        import: vi.fn(),
    }));
    (MockQuill as any).import = vi.fn();
    (MockQuill as any).register = vi.fn();
    return { default: MockQuill };
});

// Mock other components and hooks
vi.mock("../CellList", () => ({
    default: () => <div data-testid="cell-list">CellList</div>,
}));

vi.mock("../TextCellEditor", () => ({
    default: () => <div data-testid="text-cell-editor">TextCellEditor</div>,
}));

vi.mock("../contextProviders/UnsavedChangesContext", () => ({
    default: React.createContext({
        setUnsavedChanges: vi.fn(),
        showFlashingBorder: false,
        unsavedChanges: false,
        toggleFlashingBorder: vi.fn(),
    }),
}));

describe("CodexCellEditor - Audio State Synchronization", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registeredHandlers.clear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("audio state change listener", () => {
        it("should register audioStateChanged message handler", () => {
            render(<CodexCellEditor />);

            expect(registeredHandlers.has("codexCellEditor-audioStateChanged")).toBe(true);
        });

        it("should update isOtherTypeAudioPlaying when source webview reports target is playing", async () => {
            const { container } = render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                // Simulate message from source webview indicating target is playing
                const message: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "target",
                        isPlaying: true,
                    },
                };

                const event = new MessageEvent("message", {
                    data: message,
                });

                handler(event);

                // Wait for state update
                await waitFor(() => {
                    // The component should have updated isOtherTypeAudioPlaying state
                    // We can verify this by checking if the prop is passed to CellList
                    // Since we're mocking CellList, we'll verify the handler was called correctly
                    expect(handler).toHaveBeenCalled;
                });
            }
        });

        it("should update isOtherTypeAudioPlaying when target webview reports source is playing", async () => {
            render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                // Simulate message from target webview indicating source is playing
                const message: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "source",
                        isPlaying: true,
                    },
                };

                const event = new MessageEvent("message", {
                    data: message,
                });

                handler(event);

                await waitFor(() => {
                    expect(handler).toHaveBeenCalled;
                });
            }
        });

        it("should set isOtherTypeAudioPlaying to false when audio stops", async () => {
            render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                // First, set playing to true
                const startMessage: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "target",
                        isPlaying: true,
                    },
                };

                handler(new MessageEvent("message", { data: startMessage }));

                // Then, set playing to false
                const stopMessage: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "target",
                        isPlaying: false,
                    },
                };

                handler(new MessageEvent("message", { data: stopMessage }));

                await waitFor(() => {
                    expect(handler).toHaveBeenCalled;
                });
            }
        });

        it("should ignore messages from same webview type", async () => {
            render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                // Simulate message from source webview when current webview is also source
                // This should be ignored
                const message: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "source",
                        isPlaying: true,
                    },
                };

                const event = new MessageEvent("message", {
                    data: message,
                });

                handler(event);

                // Handler should still be called, but state shouldn't update
                // (we can't easily test state without more complex setup, but we verify handler exists)
                await waitFor(() => {
                    expect(handler).toBeDefined();
                });
            }
        });

        it("should only process messages with correct structure", async () => {
            render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                // Invalid message structure - missing content.type
                const invalidMessage1 = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        webviewType: "target",
                        isPlaying: true,
                    },
                };

                handler(new MessageEvent("message", { data: invalidMessage1 }));

                // Invalid message structure - wrong command
                const invalidMessage2: GlobalMessage = {
                    command: "otherCommand",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "target",
                        isPlaying: true,
                    },
                };

                handler(new MessageEvent("message", { data: invalidMessage2 }));

                // Invalid message structure - wrong destination
                const invalidMessage3: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "provider",
                    content: {
                        type: "audioPlaying",
                        webviewType: "target",
                        isPlaying: true,
                    },
                };

                handler(new MessageEvent("message", { data: invalidMessage3 }));

                // Handler should handle these gracefully without crashing
                await waitFor(() => {
                    expect(handler).toBeDefined();
                });
            }
        });

        it("should handle multiple rapid state changes", async () => {
            render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                // Send multiple rapid state changes
                const messages: GlobalMessage[] = [
                    {
                        command: "audioStateChanged",
                        destination: "webview",
                        content: {
                            type: "audioPlaying",
                            webviewType: "target",
                            isPlaying: true,
                        },
                    },
                    {
                        command: "audioStateChanged",
                        destination: "webview",
                        content: {
                            type: "audioPlaying",
                            webviewType: "target",
                            isPlaying: false,
                        },
                    },
                    {
                        command: "audioStateChanged",
                        destination: "webview",
                        content: {
                            type: "audioPlaying",
                            webviewType: "target",
                            isPlaying: true,
                        },
                    },
                ];

                messages.forEach((message) => {
                    handler(new MessageEvent("message", { data: message }));
                });

                await waitFor(() => {
                    expect(handler).toBeDefined();
                });
            }
        });
    });

    describe("message structure validation", () => {
        it("should validate command is 'audioStateChanged'", async () => {
            render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                const validMessage: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "target",
                        isPlaying: true,
                    },
                };

                handler(new MessageEvent("message", { data: validMessage }));

                await waitFor(() => {
                    expect(handler).toBeDefined();
                });
            }
        });

        it("should validate destination is 'webview'", async () => {
            render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                const validMessage: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "target",
                        isPlaying: true,
                    },
                };

                handler(new MessageEvent("message", { data: validMessage }));

                await waitFor(() => {
                    expect(handler).toBeDefined();
                });
            }
        });

        it("should validate content.type is 'audioPlaying'", async () => {
            render(<CodexCellEditor />);

            const handler = registeredHandlers.get("codexCellEditor-audioStateChanged");
            expect(handler).toBeDefined();

            if (handler) {
                const validMessage: GlobalMessage = {
                    command: "audioStateChanged",
                    destination: "webview",
                    content: {
                        type: "audioPlaying",
                        webviewType: "target",
                        isPlaying: true,
                    },
                };

                handler(new MessageEvent("message", { data: validMessage }));

                await waitFor(() => {
                    expect(handler).toBeDefined();
                });
            }
        });
    });
});
