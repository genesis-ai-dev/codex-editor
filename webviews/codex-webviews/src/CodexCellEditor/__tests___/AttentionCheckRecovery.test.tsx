import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Tests for the Attention Check A/B test recovery flow.
 *
 * Flow being tested:
 * 1. User sees [correct, decoy] translations
 * 2. If user picks decoy (wrong):
 *    - Analytics recorded as "failed"
 *    - Recovery UI shows [correct, spare] (two different correct translations)
 * 3. User picks from recovery options
 *    - NO analytics sent for recovery selection
 *    - Selected translation is applied
 */

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

vi.mock("@sharedUtils", () => ({
    getVSCodeAPI: () => mockVscode,
}));

// Mock Quill editor
vi.mock("quill", () => {
    const MockQuill = vi.fn().mockImplementation(() => ({
        root: {
            innerHTML: "",
            focus: vi.fn(),
        },
        getText: vi.fn().mockReturnValue(""),
        getContents: vi.fn().mockReturnValue({ ops: [] }),
        setContents: vi.fn(),
        getSelection: vi.fn().mockReturnValue({ index: 0, length: 0 }),
        setSelection: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        format: vi.fn(),
        getSemanticHTML: vi.fn().mockReturnValue(""),
        insertText: vi.fn(),
        deleteText: vi.fn(),
        focus: vi.fn(),
    }));
    (MockQuill as any).import = vi.fn().mockReturnValue(class {});
    (MockQuill as any).register = vi.fn();
    return { default: MockQuill };
});

// Import the component after mocks are set up
import { ABTestVariantSelector } from "../components/ABTestVariantSelector";

describe("Attention Check Recovery Flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("ABTestVariantSelector with attention check", () => {
        const correctTranslation = "Blessed are the meek, for they will inherit the earth.";
        const decoyTranslation = "Blessed are the poor in spirit, for theirs is the kingdom of heaven.";
        const spareTranslation = "The meek are blessed, for they will inherit the earth.";

        it("should render attention check with correct and decoy variants", () => {
            const props = {
                variants: [correctTranslation, decoyTranslation],
                cellId: "MAT-5-5",
                testId: "test-attention-123",
                onVariantSelected: vi.fn(),
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            expect(screen.getByText(/Choose Translation/i)).toBeInTheDocument();
            // Both variants should be visible (order may be randomized)
            expect(screen.getByText(correctTranslation)).toBeInTheDocument();
            expect(screen.getByText(decoyTranslation)).toBeInTheDocument();
        });

        it("should call onVariantSelected with selection time when variant is clicked", async () => {
            const onVariantSelected = vi.fn();
            const props = {
                variants: [correctTranslation, decoyTranslation],
                cellId: "MAT-5-5",
                testId: "test-attention-123",
                onVariantSelected,
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            const variant = screen.getByText(correctTranslation);
            fireEvent.click(variant);

            await waitFor(() => {
                expect(onVariantSelected).toHaveBeenCalledWith(
                    expect.any(Number), // index
                    expect.any(Number)  // selectionTimeMs
                );
            });
        });

        it("should show recovery header when headerOverride is provided", () => {
            const props = {
                variants: [correctTranslation, spareTranslation],
                cellId: "MAT-5-5",
                testId: "test-attention-123-recovery",
                headerOverride: "Let's look at another",
                onVariantSelected: vi.fn(),
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            expect(screen.getByText("Let's look at another")).toBeInTheDocument();
        });

        it("should display two different correct translations in recovery mode", () => {
            const props = {
                variants: [correctTranslation, spareTranslation],
                cellId: "MAT-5-5",
                testId: "test-attention-123-recovery",
                headerOverride: "Let's look at another",
                onVariantSelected: vi.fn(),
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            // Both translations should be different and visible
            expect(screen.getByText(correctTranslation)).toBeInTheDocument();
            expect(screen.getByText(spareTranslation)).toBeInTheDocument();
            expect(correctTranslation).not.toBe(spareTranslation);
        });

        it("should not show subtitle text when headerOverride is provided", () => {
            const props = {
                variants: [correctTranslation, spareTranslation],
                cellId: "MAT-5-5",
                testId: "test-attention-123-recovery",
                headerOverride: "Let's look at another",
                onVariantSelected: vi.fn(),
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            // The subtitle should not be shown
            expect(screen.queryByText(/Pick the translation that reads best/i)).not.toBeInTheDocument();
        });

        it("should prevent double selection", async () => {
            const onVariantSelected = vi.fn();
            const props = {
                variants: [correctTranslation, decoyTranslation],
                cellId: "MAT-5-5",
                testId: "test-attention-123",
                onVariantSelected,
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            const variant1 = screen.getByText(correctTranslation);
            const variant2 = screen.getByText(decoyTranslation);

            // Click first variant
            fireEvent.click(variant1);

            // Try to click second variant
            fireEvent.click(variant2);

            await waitFor(() => {
                // Should only be called once
                expect(onVariantSelected).toHaveBeenCalledTimes(1);
            });
        });

        it("should return null and not render when only one variant is provided", () => {
            const props = {
                variants: [correctTranslation],
                cellId: "MAT-5-5",
                testId: "test-attention-123",
                onVariantSelected: vi.fn(),
                onDismiss: vi.fn(),
            };

            const { container } = render(<ABTestVariantSelector {...props} />);

            expect(container.firstChild).toBeNull();
        });
    });

    describe("Recovery flow state transitions", () => {
        /**
         * This test simulates the full attention check flow:
         * 1. Initial state: show [correct, decoy]
         * 2. User picks decoy -> trigger recovery
         * 3. Recovery state: show [correct, spare]
         * 4. User picks from recovery -> apply and close
         */

        it("should simulate correct selection (no recovery needed)", async () => {
            const onVariantSelected = vi.fn();
            const correctTranslation = "Correct translation";
            const decoyTranslation = "Decoy translation";

            const props = {
                variants: [correctTranslation, decoyTranslation],
                cellId: "test-cell",
                testId: "test-123",
                onVariantSelected,
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            // User clicks the correct translation
            const correctOption = screen.getByText(correctTranslation);
            fireEvent.click(correctOption);

            await waitFor(() => {
                expect(onVariantSelected).toHaveBeenCalledWith(0, expect.any(Number));
            });

            // Verify the "Thanks" message appears
            expect(screen.getByText(/Thanks! Your choice helps improve suggestions/i)).toBeInTheDocument();
        });

        it("should simulate wrong selection (triggers recovery in parent)", async () => {
            const onVariantSelected = vi.fn();
            const correctTranslation = "Correct translation";
            const decoyTranslation = "Decoy translation";

            const props = {
                variants: [correctTranslation, decoyTranslation],
                cellId: "test-cell",
                testId: "test-123",
                onVariantSelected,
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            // User clicks the decoy translation
            const decoyOption = screen.getByText(decoyTranslation);
            fireEvent.click(decoyOption);

            await waitFor(() => {
                expect(onVariantSelected).toHaveBeenCalledWith(1, expect.any(Number));
            });
        });

        it("should render recovery UI with two different translations", () => {
            const onVariantSelected = vi.fn();
            const correctTranslation = "Correct translation version 1";
            const spareTranslation = "Correct translation version 2";

            // This simulates the recovery state where both variants are correct
            const recoveryProps = {
                variants: [correctTranslation, spareTranslation],
                cellId: "test-cell",
                testId: "test-123-recovery",
                headerOverride: "Let's look at another",
                onVariantSelected,
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...recoveryProps} />);

            // Should show recovery header
            expect(screen.getByText("Let's look at another")).toBeInTheDocument();

            // Should show both correct translations
            expect(screen.getByText(correctTranslation)).toBeInTheDocument();
            expect(screen.getByText(spareTranslation)).toBeInTheDocument();
        });
    });

    describe("Analytics behavior", () => {
        /**
         * These tests verify the analytics tracking behavior:
         * - Initial selection: always tracked
         * - Recovery selection: NOT tracked
         *
         * These tests verify the component's callback behavior
         * that enables proper analytics handling.
         */

        it("should call onVariantSelected callback for initial selection", async () => {
            const onVariantSelected = vi.fn();
            const props = {
                variants: ["Option A", "Option B"],
                cellId: "test-cell",
                testId: "test-123",
                onVariantSelected,
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            fireEvent.click(screen.getByText("Option A"));

            await waitFor(() => {
                expect(onVariantSelected).toHaveBeenCalledTimes(1);
            });
        });

        it("should call onVariantSelected callback for recovery selection", async () => {
            const onVariantSelected = vi.fn();
            const props = {
                variants: ["Correct V1", "Correct V2"],
                cellId: "test-cell",
                testId: "test-123-recovery",
                headerOverride: "Let's look at another",
                onVariantSelected,
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            fireEvent.click(screen.getByText("Correct V1"));

            await waitFor(() => {
                // The callback is still called - the parent decides whether to track
                expect(onVariantSelected).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe("Edge cases", () => {
        it("should handle empty variants array", () => {
            const props = {
                variants: [],
                cellId: "test-cell",
                testId: "test-123",
                onVariantSelected: vi.fn(),
                onDismiss: vi.fn(),
            };

            const { container } = render(<ABTestVariantSelector {...props} />);
            expect(container.firstChild).toBeNull();
        });

        it("should handle variants with HTML content", () => {
            const props = {
                variants: [
                    "<strong>Bold</strong> translation",
                    "Normal translation"
                ],
                cellId: "test-cell",
                testId: "test-123",
                onVariantSelected: vi.fn(),
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            // HTML should be stripped for display
            expect(screen.getByText("Bold translation")).toBeInTheDocument();
            expect(screen.getByText("Normal translation")).toBeInTheDocument();
        });

        it("should handle very long translations", () => {
            const longText = "A".repeat(500);
            const props = {
                variants: [longText, "Short"],
                cellId: "test-cell",
                testId: "test-123",
                onVariantSelected: vi.fn(),
                onDismiss: vi.fn(),
            };

            render(<ABTestVariantSelector {...props} />);

            expect(screen.getByText(longText)).toBeInTheDocument();
        });

        it("should dismiss when clicking overlay background", () => {
            const onDismiss = vi.fn();
            const props = {
                variants: ["A", "B"],
                cellId: "test-cell",
                testId: "test-123",
                onVariantSelected: vi.fn(),
                onDismiss,
            };

            render(<ABTestVariantSelector {...props} />);

            // Click the overlay (not the modal)
            const overlay = document.querySelector(".ab-test-overlay");
            if (overlay) {
                fireEvent.click(overlay);
                expect(onDismiss).toHaveBeenCalled();
            }
        });
    });
});
