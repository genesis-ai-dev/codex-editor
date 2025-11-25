import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import CodexCellEditor from "../CodexCellEditor";

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

// Mock @sharedUtils
vi.mock("@sharedUtils", () => ({
    getVSCodeAPI: () => mockVscode,
    shouldDisableValidation: vi.fn().mockReturnValue(false),
    getCellValueData: vi.fn(),
    cellHasAudioUsingAttachments: vi.fn().mockReturnValue(false),
    computeValidationStats: vi.fn().mockReturnValue({ validated: 0, total: 0 }),
    computeProgressPercents: vi.fn().mockReturnValue({ validated: 0, total: 0 }),
}));

// Mock the shared vscodeApi module
vi.mock("../shared/vscodeApi", () => ({
    getVSCodeAPI: () => mockVscode,
}));

// Mock Quill
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
        getModule: vi.fn().mockReturnValue({
            destroy: vi.fn(),
            dispose: vi.fn(),
        }),
        focus: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        import: vi.fn(),
    }));

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

// Mock ReactPlayer
vi.mock("react-player", () => ({
    default: vi.fn(() => <div data-testid="react-player" />),
}));

// Mock WhisperTranscriptionClient
vi.mock("../WhisperTranscriptionClient", () => ({
    WhisperTranscriptionClient: vi.fn(),
}));

// Mock context providers
const MockUnsavedChangesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return <div data-testid="unsaved-changes-provider">{children}</div>;
};

const MockSourceCellProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return <div data-testid="source-cell-provider">{children}</div>;
};

const MockScrollToContentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return <div data-testid="scroll-to-content-provider">{children}</div>;
};

// Mock the context modules
vi.mock("../contextProviders/UnsavedChangesContext", () => ({
    default: React.createContext({
        unsavedChanges: false,
        setUnsavedChanges: vi.fn(),
        showFlashingBorder: false,
        toggleFlashingBorder: vi.fn(),
    }),
}));

vi.mock("../contextProviders/SourceCellContext", () => ({
    default: React.createContext({
        sourceCellMap: {},
        setSourceCellMap: vi.fn(),
    }),
}));

vi.mock("../contextProviders/ScrollToContentContext", () => ({
    default: React.createContext({
        contentToScrollTo: null,
        setContentToScrollTo: vi.fn(),
    }),
}));

describe("VSCodeVersionWarningModal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cleanup();

        // Set up window.initialData to enable isSourceText mode
        (window as any).initialData = {
            isSourceText: true,
            cachedChapter: 1,
            metadata: {
                textDirection: "ltr",
                cellDisplayMode: "one-line-per-cell",
            },
        };
    });

    it("should display VSCodeVersionWarningModal when receiving showVSCodeVersionWarning message", async () => {
        render(<CodexCellEditor />);

        // Initially, modal should not be visible
        expect(screen.queryByText("Update Required")).not.toBeInTheDocument();

        // Simulate receiving the showVSCodeVersionWarning message
        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "showVSCodeVersionWarning",
                },
            })
        );

        // Wait for modal to appear
        await waitFor(() => {
            expect(screen.getByText("Update Required")).toBeInTheDocument();
        });

        // Verify modal content
        expect(screen.getByText(/Please visit/i)).toBeInTheDocument();
        expect(screen.getByText("codexeditor.app")).toBeInTheDocument();
        expect(screen.getByText(/to update Codex to the latest version/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /OK/i })).toBeInTheDocument();
    });

    it("should close modal when OK button is clicked", async () => {
        render(<CodexCellEditor />);

        // Simulate receiving the showVSCodeVersionWarning message
        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "showVSCodeVersionWarning",
                },
            })
        );

        // Wait for modal to appear
        await waitFor(() => {
            expect(screen.getByText("Update Required")).toBeInTheDocument();
        });

        // Click the OK button
        const okButton = screen.getByRole("button", { name: /OK/i });
        fireEvent.click(okButton);

        // Wait for modal to disappear
        await waitFor(() => {
            expect(screen.queryByText("Update Required")).not.toBeInTheDocument();
        });
    });

    it("should contain link to codexeditor.app", async () => {
        render(<CodexCellEditor />);

        // Simulate receiving the showVSCodeVersionWarning message
        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "showVSCodeVersionWarning",
                },
            })
        );

        // Wait for modal to appear
        await waitFor(() => {
            expect(screen.getByText("Update Required")).toBeInTheDocument();
        });

        // Verify the link exists and has correct attributes
        const link = screen.getByText("codexeditor.app");
        expect(link).toBeInTheDocument();
        expect(link.closest("a")).toHaveAttribute("href", "https://codexeditor.app");
        expect(link.closest("a")).toHaveAttribute("target", "_blank");
        expect(link.closest("a")).toHaveAttribute("rel", "noopener noreferrer");
    });
});
