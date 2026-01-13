import React from "react";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).acquireVsCodeApi = vi.fn().mockReturnValue(mockVscode);

// Minimal mocks for heavy deps used by CodexCellEditor
vi.mock("react-player", () => ({
    default: vi.fn(() => <div data-testid="react-player" />),
}));

vi.mock("quill", () => {
    class MockBlot {
        static blotName = "mock";
        static tagName = "span";
    }
    class MockInline extends MockBlot {
        static blotName = "inline";
        static tagName = "span";
    }
    class MockBlock extends MockBlot {
        static blotName = "block";
        static tagName = "div";
    }
    class MockEmbed extends MockBlot {
        static blotName = "embed";
        static tagName = "object";
    }

    const MockQuill = vi.fn().mockImplementation(() => ({
        root: {
            innerHTML: "<p>Test content</p>",
            focus: vi.fn(),
            blur: vi.fn(),
            click: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelectorAll: vi.fn().mockReturnValue([]),
        },
        getText: vi.fn().mockReturnValue("Test content"),
        getLength: vi.fn().mockReturnValue(12),
        getContents: vi.fn().mockReturnValue({ ops: [{ insert: "Test content" }] }),
        setContents: vi.fn(),
        updateContents: vi.fn(),
        insertText: vi.fn(),
        format: vi.fn(),
        getFormat: vi.fn(),
        removeFormat: vi.fn(),
        setSelection: vi.fn(),
        getModule: vi.fn().mockReturnValue({ destroy: vi.fn(), dispose: vi.fn() }),
        focus: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        import: vi.fn(),
    }));

    (MockQuill as any).import = vi.fn().mockImplementation((path: string) => {
        if (path === "blots/inline") return MockInline;
        if (path === "blots/block") return MockBlock;
        if (path === "blots/embed") return MockEmbed;
        if (path === "ui/icons") return {};
        return MockBlot;
    });
    (MockQuill as any).register = vi.fn();

    return { default: MockQuill };
});

// Mock CellList so we can drive CodexCellEditor.handleSaveHtml without rendering the whole UI tree
vi.mock("../CellList", () => ({
    default: (props: any) => {
        return (
            <div>
                <div data-testid="content-marker">
                    {props.contentBeingUpdated?.cellMarkers?.[0] || ""}
                </div>
                <div data-testid="is-saving">{props.isSaving ? "yes" : "no"}</div>
                <button
                    data-testid="set-content"
                    onClick={() =>
                        props.setContentBeingUpdated({
                            cellMarkers: ["cell-1"],
                            cellContent: "<p>Updated</p>",
                            cellChanged: true,
                        })
                    }
                >
                    set
                </button>
                <button data-testid="save" onClick={() => props.handleSaveHtml()}>
                    save
                </button>
            </div>
        );
    },
}));

// Import after mocks
import CodexCellEditor from "../CodexCellEditor";

describe("CodexCellEditor save ack gating", () => {
    beforeAll(() => {
        (window as any).initialData = {
            cachedChapter: 1,
            metadata: {},
            isSourceText: false,
            sourceCellMap: {},
            username: "test-user",
            validationCount: 1,
            validationCountAudio: 1,
            isAuthenticated: true,
            userAccessLevel: 10,
        };
    });

    beforeEach(() => {
        cleanup();
        mockVscode.postMessage.mockClear();
    });

    it("does not clear saving state on content refresh; only clears on saveHtmlSaved with matching requestId", async () => {
        render(<CodexCellEditor />);

        // Seed content so saveHtml has a cellId to save
        fireEvent.click(screen.getByTestId("set-content"));
        expect(screen.getByTestId("content-marker").textContent).toBe("cell-1");

        // Trigger save
        fireEvent.click(screen.getByTestId("save"));

        // Should be saving and should have posted saveHtml with requestId
        await waitFor(() => expect(screen.getByTestId("is-saving").textContent).toBe("yes"));
        expect(mockVscode.postMessage).toHaveBeenCalled();
        const call = (mockVscode.postMessage as any).mock.calls.find(
            (c: any[]) => c?.[0]?.command === "saveHtml"
        );
        expect(call).toBeTruthy();
        const requestId = call[0].requestId;
        expect(typeof requestId).toBe("string");
        expect(requestId.length).toBeGreaterThan(0);

        // Simulate provider content refresh — should NOT clear saving anymore
        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "providerSendsInitialContent",
                    content: [],
                    isSourceText: false,
                    sourceCellMap: {},
                },
            })
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.getByTestId("is-saving").textContent).toBe("yes");
        expect(screen.getByTestId("content-marker").textContent).toBe("cell-1");

        // Wrong requestId should be ignored
        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "saveHtmlSaved",
                    content: { requestId: "wrong", cellId: "cell-1", success: true },
                },
            })
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.getByTestId("is-saving").textContent).toBe("yes");

        // Matching requestId should clear saving and close editor (clears contentBeingUpdated)
        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "saveHtmlSaved",
                    content: { requestId, cellId: "cell-1", success: true },
                },
            })
        );

        await waitFor(() => expect(screen.getByTestId("is-saving").textContent).toBe("no"));
        await waitFor(() => expect(screen.getByTestId("content-marker").textContent).toBe(""));
    });
});

