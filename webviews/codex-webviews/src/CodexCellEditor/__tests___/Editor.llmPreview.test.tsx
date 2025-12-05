import React from "react";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { EditHistory } from "../../../../../types";
import { EditType } from "../../../../../types/enums";
import Editor from "../Editor";

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

// Mock Quill with text-change event simulation
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

    const MockQuill = vi.fn().mockImplementation(() => {
        const textChangeHandlers: Array<(delta: any, oldDelta: any, source: string) => void> = [];

        const quillInstance = {
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
            getSelection: vi.fn().mockReturnValue({ index: 0, length: 0 }),
            getLeaf: vi.fn().mockReturnValue([{ domNode: document.createElement("span") }]),
            getIndex: vi.fn().mockReturnValue(0),
            getSemanticHTML: vi.fn().mockReturnValue(""),
            getModule: vi.fn().mockReturnValue({
                destroy: vi.fn(),
                dispose: vi.fn(),
            }),
            focus: vi.fn(),
            on: vi.fn(
                (event: string, handler: (delta: any, oldDelta: any, source: string) => void) => {
                    if (event === "text-change") {
                        textChangeHandlers.push(handler);
                        // Simulate initial text-change event (api source) to trigger checkIfLLMContent
                        // This happens during first load and sets the ref, but returns early
                        setTimeout(() => {
                            handler({ ops: [] }, { ops: [] }, "api");
                            // Then simulate a user text-change event with NO content change
                            // This tests the isLLMContentNeedingApprovalRef behavior specifically
                            // If isLLMContentNeedingApprovalRef is true, content will be marked dirty
                            // even if it matches baseline (line 637-640 in Editor.tsx)
                            setTimeout(() => {
                                // Simulate user event with no actual content change
                                // This way dirty state is only triggered by isLLMContentNeedingApprovalRef
                                handler({ ops: [] }, { ops: [] }, "user");
                            }, 20);
                        }, 10);
                    }
                }
            ),
            off: vi.fn(),
            clipboard: {
                dangerouslyPasteHTML: vi.fn(),
            },
            import: vi.fn(),
        };

        return quillInstance;
    });

    (MockQuill as any).import = vi.fn().mockImplementation((path) => {
        if (path === "blots/inline") return MockInline;
        if (path === "blots/block") return MockBlock;
        if (path === "blots/embed") return MockEmbed;
        if (path === "ui/icons") return {};
        return MockBlot;
    });

    (MockQuill as any).register = vi.fn();

    return {
        default: MockQuill,
    };
});

// Mock context providers
vi.mock("../contextProviders/UnsavedChangesContext", () => ({
    default: React.createContext({
        setUnsavedChanges: vi.fn(),
        showFlashingBorder: false,
        unsavedChanges: false,
    }),
}));

// Mock @sharedUtils
vi.mock("@sharedUtils", () => ({
    getVSCodeAPI: () => mockVscode,
}));

// Global environment shims for jsdom
beforeAll(() => {
    URL.createObjectURL = URL.createObjectURL || vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = URL.revokeObjectURL || vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

describe("Editor LLM Preview Flag Tests", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should mark LLM content as needing approval when preview flag is true", async () => {
        const onDirtyChange = vi.fn();

        const editHistoryWithPreview: EditHistory[] = [
            {
                editMap: ["value"],
                value: "<p>LLM generated content</p>",
                author: "llm",
                timestamp: Date.now(),
                type: EditType.LLM_GENERATION,
                preview: true, // This is a preview edit
            },
        ];

        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>LLM generated content</p>"
                editHistory={editHistoryWithPreview}
                onDirtyChange={onDirtyChange}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
            />
        );

        // Wait for the text-change event to fire and checkIfLLMContent to be called
        // The checkIfLLMContent function sets isLLMContentNeedingApprovalRef.current = true
        // which causes the dirty checking logic to mark content as dirty
        await waitFor(
            () => {
                const dirtyTrueCalls = onDirtyChange.mock.calls.filter((call) => call[0] === true);
                // For preview content, we expect it to be marked as dirty
                expect(dirtyTrueCalls.length).toBeGreaterThan(0);
            },
            { timeout: 3000 }
        );
    });

    it("should NOT mark LLM content as needing approval when preview flag is false or missing", async () => {
        const onDirtyChange = vi.fn();

        const editHistoryWithoutPreview: EditHistory[] = [
            {
                editMap: ["value"],
                value: "<p>LLM generated content (saved)</p>",
                author: "llm",
                timestamp: Date.now(),
                type: EditType.LLM_GENERATION,
                // No preview flag - this means it was already saved
            },
        ];

        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>LLM generated content (saved)</p>"
                editHistory={editHistoryWithoutPreview}
                onDirtyChange={onDirtyChange}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
            />
        );

        // Wait for the text-change event to fire and checkIfLLMContent to be called
        // The checkIfLLMContent function should set isLLMContentNeedingApprovalRef.current = false
        // for saved content (no preview flag), so it should NOT be marked as dirty
        await waitFor(
            () => {
                // Give time for initialization and text-change event
                const dirtyTrueCalls = onDirtyChange.mock.calls.filter((call) => call[0] === true);
                // For saved content without preview flag, we should NOT have dirty=true calls
                // The content should be considered clean since it was already saved
                expect(dirtyTrueCalls.length).toBe(0);
            },
            { timeout: 3000 }
        );
    });

    it("should NOT mark LLM content as needing approval when preview is explicitly false", async () => {
        const onDirtyChange = vi.fn();

        const editHistoryWithPreviewFalse: EditHistory[] = [
            {
                editMap: ["value"],
                value: "<p>LLM generated content (saved)</p>",
                author: "llm",
                timestamp: Date.now(),
                type: EditType.LLM_GENERATION,
                preview: false, // Explicitly not a preview
            },
        ];

        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>LLM generated content (saved)</p>"
                editHistory={editHistoryWithPreviewFalse}
                onDirtyChange={onDirtyChange}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
            />
        );

        // Wait for the text-change event to fire
        // Should not mark as dirty when preview is false
        await waitFor(
            () => {
                const dirtyTrueCalls = onDirtyChange.mock.calls.filter((call) => call[0] === true);
                expect(dirtyTrueCalls.length).toBe(0);
            },
            { timeout: 3000 }
        );
    });

    it("should handle LLM_EDIT type with preview flag correctly", async () => {
        const onDirtyChange = vi.fn();

        const editHistoryWithLLMEdit: EditHistory[] = [
            {
                editMap: ["value"],
                value: "<p>LLM edited content</p>",
                author: "llm",
                timestamp: Date.now(),
                type: EditType.LLM_EDIT,
                preview: true, // Preview edit
            },
        ];

        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>LLM edited content</p>"
                editHistory={editHistoryWithLLMEdit}
                onDirtyChange={onDirtyChange}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
            />
        );

        // LLM_EDIT with preview: true should also be marked as needing approval
        await waitFor(
            () => {
                const dirtyCalls = onDirtyChange.mock.calls.filter((call) => call[0] === true);
                expect(dirtyCalls.length).toBeGreaterThan(0);
            },
            { timeout: 3000 }
        );
    });

    it("should handle user edits normally (not affected by preview flag)", async () => {
        const onDirtyChange = vi.fn();

        const editHistoryWithUserEdit: EditHistory[] = [
            {
                editMap: ["value"],
                value: "<p>User edited content</p>",
                author: "user",
                timestamp: Date.now(),
                type: EditType.USER_EDIT,
                // User edits don't have preview flag
            },
        ];

        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>User edited content</p>"
                editHistory={editHistoryWithUserEdit}
                onDirtyChange={onDirtyChange}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
            />
        );

        // User edits should not be affected by the preview flag logic
        // The checkIfLLMContent function only checks for LLM_GENERATION and LLM_EDIT types
        // So user edits should work normally - isLLMContentNeedingApprovalRef should remain false
        await waitFor(
            () => {
                // User edits don't trigger the LLM preview logic, so they should work normally
                // onDirtyChange should be called (might be false, but should be called)
                expect(onDirtyChange).toHaveBeenCalled();
            },
            { timeout: 3000 }
        );
    });
});
