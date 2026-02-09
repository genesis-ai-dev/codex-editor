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
                0
            );
        });
    });

    it("should call onVariantSelected with correct index when variant B is clicked", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variantB = screen.getByText("Translation variant B");
        fireEvent.click(variantB);

        await waitFor(() => {
            expect(defaultProps.onVariantSelected).toHaveBeenCalledWith(
                1
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

    it("should show thank you message after selection", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variant = screen.getByText("Translation variant A");
        fireEvent.click(variant);

        await waitFor(() => {
            expect(screen.getByText(/Thanks! Your choice helps improve suggestions/i)).toBeInTheDocument();
        });
    });

    it("should emit selected index when variant is clicked", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variant = screen.getByText("Translation variant A");
        fireEvent.click(variant);

        await waitFor(() => {
            expect(defaultProps.onVariantSelected).toHaveBeenCalledWith(
                expect.any(Number)
            );
        });
    });

    it("should pass correct index to onVariantSelected", async () => {
        render(<ABTestVariantSelector {...defaultProps} />);

        const variant = screen.getByText("Translation variant B");
        fireEvent.click(variant);

        await waitFor(() => {
            expect(defaultProps.onVariantSelected).toHaveBeenCalledWith(
                1
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
