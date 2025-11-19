import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ABTestVariantSelector } from "../components/ABTestVariantSelector";

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

describe("ABTestVariantSelector", () => {
    const defaultProps = {
        variants: ["Translation variant A", "Translation variant B"],
        cellId: "test-cell-123",
        testId: "test-456",
        names: ["fts5-bm25", "sbs"],
        abProbability: 0.15,
        onVariantSelected: vi.fn(),
        onDismiss: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should render A/B test modal with two variants", () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        expect(screen.getByText(/Choose Translation/i)).toBeInTheDocument();
        expect(screen.getByText("Translation variant A")).toBeInTheDocument();
        expect(screen.getByText("Translation variant B")).toBeInTheDocument();
    });

    it("should display test result with variant names after selection", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variant = screen.getByText("Translation variant A");
        fireEvent.click(variant);

        await waitFor(() => {
            expect(screen.getByText(/Result/i)).toBeInTheDocument();
        });
    });

    it("should call onVariantSelected with correct index when variant A is clicked", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variantA = screen.getByText("Translation variant A");
        fireEvent.click(variantA);

        await waitFor(() => {
            expect(defaultProps.onVariantSelected).toHaveBeenCalledWith(
                0,
                expect.any(Number)
            );
        });
    });

    it("should call onVariantSelected with correct index when variant B is clicked", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variantB = screen.getByText("Translation variant B");
        fireEvent.click(variantB);

        await waitFor(() => {
            expect(defaultProps.onVariantSelected).toHaveBeenCalledWith(
                1,
                expect.any(Number)
            );
        });
    });

    it("should call onVariantSelected when variant is clicked", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variant = screen.getByText("Translation variant A");
        fireEvent.click(variant);

        await waitFor(() => {
            expect(defaultProps.onVariantSelected).toHaveBeenCalled();
        });
    });

    it("should display 'See less' and 'See more' frequency controls after selection", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variant = screen.getByText("Translation variant A");
        fireEvent.click(variant);

        await waitFor(() => {
            expect(screen.getByText(/See less/i)).toBeTruthy();
            expect(screen.getByText(/See more/i)).toBeTruthy();
        });
    });

    it("should send adjustABTestingProbability message when 'See less' is clicked", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        // First select a variant to reveal controls
        const variant = screen.getByText("Translation variant A");
        fireEvent.click(variant);

        await waitFor(() => {
            const seeLessButton = screen.queryByText(/See less/i);
            expect(seeLessButton).toBeTruthy();
        });

        const seeLessButton = screen.getByText(/See less/i);
        fireEvent.click(seeLessButton);

        await waitFor(() => {
            expect(mockVscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    command: "adjustABTestingProbability",
                    content: expect.objectContaining({
                        delta: -0.1,
                        buttonChoice: "less"
                    })
                })
            );
        });
    });

    it("should send adjustABTestingProbability message when 'See more' is clicked", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        // First select a variant to reveal controls
        const variant = screen.getByText("Translation variant A");
        fireEvent.click(variant);

        await waitFor(() => {
            const seeMoreButton = screen.queryByText(/See more/i);
            expect(seeMoreButton).toBeTruthy();
        });

        const seeMoreButton = screen.getByText(/See more/i);
        fireEvent.click(seeMoreButton);

        await waitFor(() => {
            expect(mockVscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    command: "adjustABTestingProbability",
                    content: expect.objectContaining({
                        delta: 0.1,
                        buttonChoice: "more"
                    })
                })
            );
        });
    });

    it("should handle variants without names gracefully", () => {
        const propsWithoutNames = {
            ...defaultProps,
            names: undefined,
        };

        render(<ABTestVariantSelector {...propsWithoutNames} />);

        expect(screen.getByText("Translation variant A")).toBeInTheDocument();
        expect(screen.getByText("Translation variant B")).toBeInTheDocument();
    });

    it("should record selection time when variant is clicked", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variant = screen.getByText("Translation variant A");
        fireEvent.click(variant);

        await waitFor(() => {
            expect(defaultProps.onVariantSelected).toHaveBeenCalledWith(
                expect.any(Number),
                expect.any(Number)
            );
        });

        const call = defaultProps.onVariantSelected.mock.calls[0];
        const selectionTime = call[1];
        expect(selectionTime).toBeGreaterThanOrEqual(0);
        expect(selectionTime).toBeLessThan(10000);
    });

    it("should pass correct index to onVariantSelected", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variant = screen.getByText("Translation variant B");
        fireEvent.click(variant);

        await waitFor(() => {
            expect(defaultProps.onVariantSelected).toHaveBeenCalledWith(
                1,
                expect.any(Number)
            );
        });
    });

    it("should dismiss modal when onDismiss is called", () => {
        const { unmount } = render(<ABTestVariantSelector {...defaultProps} />);

        defaultProps.onDismiss();
        
        expect(defaultProps.onDismiss).toHaveBeenCalled();
        unmount();
    });
});

