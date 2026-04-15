import React from "react";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import Editor from "../Editor";

const mockVscode = {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
};

Object.defineProperty(window, "vscodeApi", {
    value: mockVscode,
    writable: true,
});

global.acquireVsCodeApi = vi.fn().mockReturnValue(mockVscode);

type EventListenerEntry = {
    type: string;
    handler: EventListener;
    options?: boolean | AddEventListenerOptions;
};

let capturedListeners: EventListenerEntry[] = [];

vi.mock("quill", () => {
    class MockBlot {
        static blotName = "mock";
        static tagName = "span";
    }

    class MockInline extends MockBlot {
        static blotName = "inline";
        static tagName = "span";
    }

    const MockQuill = vi.fn().mockImplementation(() => {
        capturedListeners = [];

        const quillInstance = {
            root: {
                innerHTML: "<p>existing content</p>",
                focus: vi.fn(),
                blur: vi.fn(),
                click: vi.fn(),
                addEventListener: vi.fn(
                    (
                        type: string,
                        handler: EventListener,
                        options?: boolean | AddEventListenerOptions
                    ) => {
                        capturedListeners.push({ type, handler, options });
                    }
                ),
                removeEventListener: vi.fn(),
                querySelectorAll: vi.fn().mockReturnValue([]),
                querySelector: vi.fn().mockReturnValue(null),
            },
            getText: vi.fn().mockReturnValue("existing content"),
            getLength: vi.fn().mockReturnValue(17),
            getContents: vi
                .fn()
                .mockReturnValue({ ops: [{ insert: "existing content" }] }),
            setContents: vi.fn(),
            updateContents: vi.fn(),
            insertText: vi.fn(),
            deleteText: vi.fn(),
            format: vi.fn(),
            getFormat: vi.fn().mockReturnValue({}),
            removeFormat: vi.fn(),
            setSelection: vi.fn(),
            getSelection: vi
                .fn()
                .mockReturnValue({ index: 0, length: 0 }),
            getLeaf: vi
                .fn()
                .mockReturnValue([
                    { domNode: document.createElement("span") },
                ]),
            getIndex: vi.fn().mockReturnValue(0),
            getSemanticHTML: vi.fn().mockReturnValue(""),
            getModule: vi
                .fn()
                .mockReturnValue({ destroy: vi.fn(), dispose: vi.fn() }),
            focus: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            update: vi.fn(),
            clipboard: { dangerouslyPasteHTML: vi.fn() },
            history: { clear: vi.fn() },
            emitter: { emit: vi.fn() },
        };

        return quillInstance;
    });

    (MockQuill as any).import = vi.fn().mockImplementation((path: string) => {
        if (path === "ui/icons") return {};
        return MockInline;
    });
    (MockQuill as any).register = vi.fn();

    return { default: MockQuill };
});

vi.mock("../contextProviders/UnsavedChangesContext", () => ({
    default: React.createContext({
        setUnsavedChanges: vi.fn(),
        showFlashingBorder: false,
        unsavedChanges: false,
    }),
}));

vi.mock("@sharedUtils", () => ({
    getVSCodeAPI: () => mockVscode,
}));

beforeAll(() => {
    URL.createObjectURL = URL.createObjectURL || vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = URL.revokeObjectURL || vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

const getPasteListeners = () =>
    capturedListeners.filter((l) => l.type === "paste");

const isCapture = (entry: EventListenerEntry) => {
    if (typeof entry.options === "boolean") return entry.options;
    if (typeof entry.options === "object") return !!entry.options?.capture;
    return false;
};

const makePasteEvent = (plainText: string, htmlText?: string) => {
    const prevented = { value: false };
    const stopped = { value: false };
    return {
        preventDefault: vi.fn(() => {
            prevented.value = true;
        }),
        stopPropagation: vi.fn(() => {
            stopped.value = true;
        }),
        clipboardData: {
            getData: vi.fn((type: string) => {
                if (type === "text/plain") return plainText;
                if (type === "text/html")
                    return htmlText ?? `<b>${plainText}</b>`;
                return "";
            }),
        },
        _prevented: prevented,
        _stopped: stopped,
    } as unknown as ClipboardEvent & {
        _prevented: { value: boolean };
        _stopped: { value: boolean };
    };
};

describe("Editor paste-as-plain-text", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedListeners = [];
        cleanup();
    });

    it("registers a capture-phase paste listener and a bubble-phase paste listener", () => {
        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>hello</p>"
                editHistory={[]}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
                pasteAsPlainText={false}
            />
        );

        const pasteListeners = getPasteListeners();
        expect(pasteListeners.length).toBe(2);

        const captureListeners = pasteListeners.filter(isCapture);
        const bubbleListeners = pasteListeners.filter((l) => !isCapture(l));
        expect(captureListeners.length).toBe(1);
        expect(bubbleListeners.length).toBe(1);
    });

    it("does NOT preventDefault when pasteAsPlainText is false", () => {
        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>hello</p>"
                editHistory={[]}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
                pasteAsPlainText={false}
            />
        );

        const captureListener = getPasteListeners().find(isCapture)!;
        const event = makePasteEvent("plain text");

        captureListener.handler(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
    });

    it("calls preventDefault + stopPropagation and inserts plain text when pasteAsPlainText is true", async () => {
        const onChange = vi.fn();

        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>hello</p>"
                editHistory={[]}
                onChange={onChange}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
                pasteAsPlainText={true}
            />
        );

        const captureListener = getPasteListeners().find(isCapture)!;
        const event = makePasteEvent("pasted plain");

        captureListener.handler(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();

        const Quill = (await import("quill")).default;
        const quillInstance = (Quill as any).mock.results[0].value;

        expect(quillInstance.insertText).toHaveBeenCalledWith(
            0,
            "pasted plain",
            {},
            "user"
        );
    });

    it("replaces selected text when there is a selection during plain-text paste", async () => {
        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>hello world</p>"
                editHistory={[]}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
                pasteAsPlainText={true}
            />
        );

        const Quill = (await import("quill")).default;
        const quillInstance = (Quill as any).mock.results[0].value;

        quillInstance.getSelection.mockReturnValue({ index: 6, length: 5 });

        const captureListener = getPasteListeners().find(isCapture)!;
        const event = makePasteEvent("universe");

        captureListener.handler(event);

        expect(quillInstance.deleteText).toHaveBeenCalledWith(
            6,
            5,
            "user"
        );
        expect(quillInstance.insertText).toHaveBeenCalledWith(
            6,
            "universe",
            {},
            "user"
        );
        expect(quillInstance.setSelection).toHaveBeenCalledWith(
            14,
            0,
            "silent"
        );
    });

    it("does not insert text when clipboard is empty", async () => {
        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>hello</p>"
                editHistory={[]}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
                pasteAsPlainText={true}
            />
        );

        const Quill = (await import("quill")).default;
        const quillInstance = (Quill as any).mock.results[0].value;

        const captureListener = getPasteListeners().find(isCapture)!;
        const event = makePasteEvent("");

        captureListener.handler(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(quillInstance.insertText).not.toHaveBeenCalled();
    });

    it("responds to pasteAsPlainText prop changing from false to true", async () => {
        const { rerender } = render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>hello</p>"
                editHistory={[]}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
                pasteAsPlainText={false}
            />
        );

        const captureListener = getPasteListeners().find(isCapture)!;
        const event1 = makePasteEvent("should pass through");
        captureListener.handler(event1);
        expect(event1.preventDefault).not.toHaveBeenCalled();

        rerender(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>hello</p>"
                editHistory={[]}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
                pasteAsPlainText={true}
            />
        );

        await waitFor(() => {
            const event2 = makePasteEvent("should be plain");
            captureListener.handler(event2);
            expect(event2.preventDefault).toHaveBeenCalled();
            expect(event2.stopPropagation).toHaveBeenCalled();
        });
    });

    it("triggers onChange after plain-text paste", async () => {
        vi.useFakeTimers();
        const onChange = vi.fn();

        render(
            <Editor
                currentLineId="cell-1"
                initialValue="<p>hello</p>"
                editHistory={[]}
                onChange={onChange}
                textDirection="ltr"
                setIsEditingFootnoteInline={vi.fn()}
                isEditingFootnoteInline={false}
                pasteAsPlainText={true}
            />
        );

        const captureListener = getPasteListeners().find(isCapture)!;
        const event = makePasteEvent("new text");

        captureListener.handler(event);

        vi.advanceTimersByTime(100);

        expect(onChange).toHaveBeenCalled();

        vi.useRealTimers();
    });
});
