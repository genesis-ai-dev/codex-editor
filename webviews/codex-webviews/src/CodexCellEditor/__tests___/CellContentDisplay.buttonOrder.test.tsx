import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuillCellContent } from "../../../../../types";
import { CodexCellTypes } from "../../../../../types/enums";
import CellContentDisplay from "../CellContentDisplay";

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
    shouldDisableValidation: vi.fn().mockReturnValue(false),
}));

// Mock context providers
vi.mock("../contextProviders/UnsavedChangesContext", () => ({
    default: React.createContext({
        setUnsavedChanges: vi.fn(),
        showFlashingBorder: false,
        unsavedChanges: false,
        toggleFlashingBorder: vi.fn(),
    }),
}));

vi.mock("../contextProviders/TooltipContext", () => ({
    useTooltip: () => ({
        showTooltip: vi.fn(),
        hideTooltip: vi.fn(),
    }),
}));

// Mock useMessageHandler
vi.mock("../hooks/useCentralizedMessageDispatcher", () => ({
    useMessageHandler: vi.fn(() => {}),
}));

// Mock audio controller
vi.mock("../lib/audioController", () => ({
    globalAudioController: {
        playExclusive: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn(),
        removeListener: vi.fn(),
    },
}));

// Mock audio cache
vi.mock("../lib/audioCache", () => ({
    getCachedAudioDataUrl: vi.fn().mockReturnValue(null),
    setCachedAudioDataUrl: vi.fn(),
}));

// Mock ValidationButton and AudioValidationButton to make them easier to identify
vi.mock("../ValidationButton", () => ({
    default: () => <div className="validation-button-container" data-testid="validation-button" />,
}));

vi.mock("../AudioValidationButton", () => ({
    default: () => (
        <div className="audio-validation-button-container" data-testid="audio-validation-button" />
    ),
}));

// Mock CommentsBadge
vi.mock("../CommentsBadge", () => ({
    default: () => <div data-testid="comments-badge" />,
}));

// Mock ReactMarkdown
vi.mock("react-markdown", () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Helper function to create a mock cell
const createMockCell = (
    cellId: string,
    content: string = "<p>Test content</p>"
): QuillCellContent => ({
    cellMarkers: [cellId],
    cellContent: content,
    cellType: CodexCellTypes.TEXT,
    editHistory: [
        {
            editMap: ["value"],
            value: content,
            author: "test-user",
            validatedBy: [],
            timestamp: Date.now(),
            type: "user-edit" as any,
        },
    ],
    cellLabel: "Test Label",
    timestamps: {
        startTime: 0,
        endTime: 5,
    },
});

describe("CellContentDisplay - Button Order Tests", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Button order for .codex files (non-source text)", () => {
        it("should render buttons in correct order: AudioValidationButton → AudioPlayButton → ValidationButton", () => {
            const mockCell = createMockCell("cell-1");
            const props = {
                cell: mockCell,
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: false, // .codex file
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "1",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-1": "available" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            // Find all buttons in the action-button-container
            const actionContainer = container.querySelector(".action-button-container");
            expect(actionContainer).toBeTruthy();

            // Get all button elements in order
            const audioValidationButton = container.querySelector(
                '[data-testid="audio-validation-button"]'
            );
            const audioPlayButton = container.querySelector(".audio-play-button");
            const validationButton = container.querySelector('[data-testid="validation-button"]');

            // Verify all buttons exist
            expect(audioValidationButton).toBeTruthy();
            expect(audioPlayButton).toBeTruthy();
            expect(validationButton).toBeTruthy();

            // Verify order: Get all direct children of action-button-container
            // Buttons are wrapped in divs, so we need to check the order of the wrapper divs
            const allChildren = Array.from(actionContainer?.children || []);

            // Find indices of wrapper divs containing each button
            const audioValidationIndex = allChildren.findIndex((el) =>
                el.querySelector('[data-testid="audio-validation-button"]')
            );
            const audioPlayIndex = allChildren.findIndex(
                (el) =>
                    el.querySelector(".audio-play-button") ||
                    el.classList.contains("audio-play-button")
            );
            const validationIndex = allChildren.findIndex((el) =>
                el.querySelector('[data-testid="validation-button"]')
            );

            expect(audioValidationIndex).toBeGreaterThan(-1);
            expect(audioPlayIndex).toBeGreaterThan(-1);
            expect(validationIndex).toBeGreaterThan(-1);

            // Verify order: AudioValidationButton < AudioPlayButton < ValidationButton
            expect(audioValidationIndex).toBeLessThan(audioPlayIndex);
            expect(audioPlayIndex).toBeLessThan(validationIndex);
        });

        it("should render buttons in correct order even when audio is missing", () => {
            const mockCell = createMockCell("cell-2");
            const props = {
                cell: mockCell,
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: false, // .codex file
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "2",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-2": "missing" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            const actionContainer = container.querySelector(".action-button-container");
            expect(actionContainer).toBeTruthy();

            // Get all button elements in order
            const audioValidationButton = container.querySelector(
                '[data-testid="audio-validation-button"]'
            );
            const audioPlayButton = container.querySelector(".audio-play-button");
            const validationButton = container.querySelector('[data-testid="validation-button"]');

            // Verify all buttons exist
            expect(audioValidationButton).toBeTruthy();
            expect(audioPlayButton).toBeTruthy();
            expect(validationButton).toBeTruthy();

            // Verify order: Get all direct children of action-button-container
            const allChildren = Array.from(actionContainer?.children || []);
            const audioValidationIndex = allChildren.findIndex((el) =>
                el.querySelector('[data-testid="audio-validation-button"]')
            );
            const audioPlayIndex = allChildren.findIndex(
                (el) =>
                    el.querySelector(".audio-play-button") ||
                    el.classList.contains("audio-play-button")
            );
            const validationIndex = allChildren.findIndex((el) =>
                el.querySelector('[data-testid="validation-button"]')
            );

            expect(audioValidationIndex).toBeLessThan(audioPlayIndex);
            expect(audioPlayIndex).toBeLessThan(validationIndex);
        });
    });

    describe("Button order for .source files (source text)", () => {
        it("should render only AudioPlayButton (no validation buttons)", () => {
            const mockCell = createMockCell("cell-source-1");
            const props = {
                cell: mockCell,
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: true, // .source file
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "1",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-source-1": "available" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            const actionContainer = container.querySelector(".action-button-container");
            expect(actionContainer).toBeTruthy();

            // Verify AudioPlayButton exists
            const audioPlayButton = container.querySelector(".audio-play-button");
            expect(audioPlayButton).toBeTruthy();

            // Verify validation buttons do NOT exist for source text
            const audioValidationButton = container.querySelector(
                '[data-testid="audio-validation-button"]'
            );
            const validationButton = container.querySelector('[data-testid="validation-button"]');

            expect(audioValidationButton).toBeNull();
            expect(validationButton).toBeNull();
        });

        it("should render AudioPlayButton in correct position even when audio is missing", () => {
            const mockCell = createMockCell("cell-source-2");
            const props = {
                cell: mockCell,
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: true, // .source file
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "2",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-source-2": "missing" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            const actionContainer = container.querySelector(".action-button-container");
            expect(actionContainer).toBeTruthy();

            // Verify AudioPlayButton exists
            const audioPlayButton = container.querySelector(".audio-play-button");
            expect(audioPlayButton).toBeTruthy();

            // Verify validation buttons do NOT exist
            const audioValidationButton = container.querySelector(
                '[data-testid="audio-validation-button"]'
            );
            const validationButton = container.querySelector('[data-testid="validation-button"]');

            expect(audioValidationButton).toBeNull();
            expect(validationButton).toBeNull();
        });
    });

    describe("Merge buttons in source editing mode", () => {
        it("should show merge button when source editing mode is turned on for non-first, non-merged cells", () => {
            // Create two cells - first cell should not have merge button, second should
            const firstCell = createMockCell("cell-source-first");
            const secondCell = createMockCell("cell-source-second");
            const translationUnits = [firstCell, secondCell];

            const props = {
                cell: secondCell, // Second cell (not first)
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: true, // .source file
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "2",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-source-second": "available" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
                isCorrectionEditorMode: true, // Source editing mode ON
                translationUnits: translationUnits,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            // Verify merge button exists (codicon-merge)
            const mergeButton = container.querySelector(".codicon-merge");
            expect(mergeButton).toBeTruthy();
            expect(mergeButton?.closest("button")?.getAttribute("title")).toBe("Merge with previous cell");
        });

        it("should NOT show merge button when source editing mode is turned off", () => {
            const firstCell = createMockCell("cell-source-first");
            const secondCell = createMockCell("cell-source-second");
            const translationUnits = [firstCell, secondCell];

            const props = {
                cell: secondCell,
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: true,
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "2",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-source-second": "available" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
                isCorrectionEditorMode: false, // Source editing mode OFF
                translationUnits: translationUnits,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            // Verify merge button does NOT exist
            const mergeButton = container.querySelector(".codicon-merge");
            expect(mergeButton).toBeNull();
        });

        it("should NOT show merge button on the first cell even when source editing mode is on", () => {
            const firstCell = createMockCell("cell-source-first");
            const secondCell = createMockCell("cell-source-second");
            const translationUnits = [firstCell, secondCell];

            const props = {
                cell: firstCell, // First cell
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: true,
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "1",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-source-first": "available" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
                isCorrectionEditorMode: true, // Source editing mode ON
                translationUnits: translationUnits,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            // Verify merge button does NOT exist on first cell
            const mergeButton = container.querySelector(".codicon-merge");
            expect(mergeButton).toBeNull();
        });

        it("should NOT show merge button on merged cells even when source editing mode is on", () => {
            const firstCell = createMockCell("cell-source-first");
            const mergedCell = {
                ...createMockCell("cell-source-merged"),
                merged: true, // Cell is already merged
            };
            const translationUnits = [firstCell, mergedCell];

            const props = {
                cell: mergedCell,
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: true,
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "2",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-source-merged": "available" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
                isCorrectionEditorMode: true, // Source editing mode ON
                translationUnits: translationUnits,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            // Verify merge button does NOT exist (should show cancel merge button instead)
            const mergeButton = container.querySelector(".codicon-merge");
            expect(mergeButton).toBeNull();

            // Verify cancel merge button exists instead
            const cancelMergeButton = container.querySelector(".codicon-debug-step-back");
            expect(cancelMergeButton).toBeTruthy();
        });
    });

    describe("Button order consistency across display modes", () => {
        it("should maintain correct button order in ONE_LINE_PER_CELL mode for .codex files", () => {
            const mockCell = createMockCell("cell-mode-1");
            const props = {
                cell: mockCell,
                vscode: mockVscode as any,
                textDirection: "ltr" as const,
                isSourceText: false,
                hasDuplicateId: false,
                alertColorCode: undefined,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                lineNumber: "1",
                label: "Test Label",
                lineNumbersEnabled: true,
                isInTranslationProcess: false,
                translationState: null as any,
                allTranslationsComplete: false,
                handleCellClick: vi.fn(),
                audioAttachments: {
                    "cell-mode-1": "available" as const,
                },
                currentUsername: "test-user",
                requiredValidations: 1,
                requiredAudioValidations: 1,
            };

            const { container } = render(<CellContentDisplay {...props} />);

            const actionContainer = container.querySelector(".action-button-container");
            const allChildren = Array.from(actionContainer?.children || []);
            const audioValidationIndex = allChildren.findIndex((el) =>
                el.querySelector('[data-testid="audio-validation-button"]')
            );
            const audioPlayIndex = allChildren.findIndex(
                (el) =>
                    el.querySelector(".audio-play-button") ||
                    el.classList.contains("audio-play-button")
            );
            const validationIndex = allChildren.findIndex((el) =>
                el.querySelector('[data-testid="validation-button"]')
            );

            expect(audioValidationIndex).toBeLessThan(audioPlayIndex);
            expect(audioPlayIndex).toBeLessThan(validationIndex);
        });

    });
});
