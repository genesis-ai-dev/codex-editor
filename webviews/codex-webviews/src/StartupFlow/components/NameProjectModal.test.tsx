import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { NameProjectModal } from "./NameProjectModal";

describe("NameProjectModal", () => {
    let mockOnSubmit: ReturnType<typeof vi.fn>;
    let mockOnCancel: ReturnType<typeof vi.fn>;
    let mockVscode: any;

    beforeEach(() => {
        mockOnSubmit = vi.fn();
        mockOnCancel = vi.fn();
        mockVscode = {
            postMessage: vi.fn(),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function renderModal(props: Partial<React.ComponentProps<typeof NameProjectModal>> = {}) {
        return render(
            <NameProjectModal
                open={true}
                defaultValue=""
                onCancel={mockOnCancel}
                onSubmit={mockOnSubmit}
                vscode={mockVscode}
                {...props}
            />
        );
    }

    describe("Initial render", () => {
        it("should render modal when open", () => {
            renderModal();
            expect(screen.getByText("New Project")).toBeInTheDocument();
            expect(screen.getByText("Choose a name for your new project")).toBeInTheDocument();
        });

        it("should not show empty error message when first opened", () => {
            renderModal();
            expect(screen.queryByText("Project name cannot be empty")).not.toBeInTheDocument();
        });

        it("should show input field with placeholder", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project");
            expect(input).toBeInTheDocument();
            expect(input).toHaveValue("");
        });

        it("should disable Create button when name is empty", () => {
            renderModal();
            const createButton = screen.getByRole("button", { name: /create/i });
            expect(createButton).toBeDisabled();
        });

        it("should use defaultValue when provided", () => {
            renderModal({ defaultValue: "test-project" });
            const input = screen.getByPlaceholderText("my-translation-project");
            expect(input).toHaveValue("test-project");
        });
    });

    describe("User interaction", () => {
        it("should update input value when user types", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            fireEvent.change(input, { target: { value: "my-project" } });

            expect(input.value).toBe("my-project");
        });

        it("should show empty error after user interacts and clears input", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            // Type something
            fireEvent.change(input, { target: { value: "test" } });
            expect(screen.queryByText("Project name cannot be empty")).not.toBeInTheDocument();

            // Clear it
            fireEvent.change(input, { target: { value: "" } });
            expect(screen.getByText("Project name cannot be empty")).toBeInTheDocument();
        });

        it("should set hasInteracted on blur", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            // Focus and blur without typing
            fireEvent.focus(input);
            fireEvent.blur(input);

            // Now clearing should show error
            fireEvent.change(input, { target: { value: "" } });
            expect(screen.getByText("Project name cannot be empty")).toBeInTheDocument();
        });
    });

    describe("Validation", () => {
        it("should show error for name longer than 256 characters", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const longName = "a".repeat(257);

            act(() => {
                fireEvent.change(input, { target: { value: longName } });
            });

            expect(
                screen.getByText("Project name is too long (max 256 characters)")
            ).toBeInTheDocument();
        });

        it("should disable Create button when name is too long", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });
            const longName = "a".repeat(257);

            act(() => {
                fireEvent.change(input, { target: { value: longName } });
            });

            expect(createButton).toBeDisabled();
        });

        it("should enable Create button when name is valid", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            act(() => {
                fireEvent.change(input, { target: { value: "valid-project-name" } });
            });

            expect(createButton).not.toBeDisabled();
        });
    });

    describe("Submit behavior", () => {
        it("should call onSubmit with trimmed name", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            act(() => {
                fireEvent.change(input, { target: { value: "  test-project  " } });
            });

            expect(createButton).not.toBeDisabled();

            act(() => {
                fireEvent.click(createButton);
            });

            expect(mockOnSubmit).toHaveBeenCalledWith("test-project");
        });

        it("should not submit if validation error exists", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            fireEvent.change(input, { target: { value: "a".repeat(257) } });

            // Button should be disabled
            expect(createButton).toBeDisabled();

            // Try to click (shouldn't work)
            fireEvent.click(createButton);

            expect(mockOnSubmit).not.toHaveBeenCalled();
        });

        it("should mark as interacted when submit is attempted", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            // Type something first, then clear it - this sets hasInteracted=true
            act(() => {
                fireEvent.change(input, { target: { value: "test" } });
            });

            // Clear input - this should set hasInteracted and show error
            act(() => {
                fireEvent.change(input, { target: { value: "" } });
            });

            // Button should be disabled and error should show
            expect(createButton).toBeDisabled();
            expect(screen.getByText("Project name cannot be empty")).toBeInTheDocument();
            expect(mockOnSubmit).not.toHaveBeenCalled();
        });
    });

    describe("Cancel behavior", () => {
        it("should call onCancel when Cancel button is clicked", () => {
            renderModal();
            const cancelButton = screen.getByRole("button", { name: /cancel/i });

            fireEvent.click(cancelButton);

            expect(mockOnCancel).toHaveBeenCalledTimes(1);
        });
    });

    describe("Modal state management", () => {
        it("should reset state when modal opens", () => {
            const { rerender } = renderModal({ open: false });

            // Open modal
            rerender(
                <NameProjectModal
                    open={true}
                    defaultValue=""
                    onCancel={mockOnCancel}
                    onSubmit={mockOnSubmit}
                    vscode={mockVscode}
                />
            );

            // Should not show error
            expect(screen.queryByText("Project name cannot be empty")).not.toBeInTheDocument();
        });

        it("should update defaultValue when prop changes", () => {
            const { rerender } = renderModal({ defaultValue: "initial" });
            const input = screen.getByPlaceholderText("my-translation-project");
            expect(input).toHaveValue("initial");

            rerender(
                <NameProjectModal
                    open={true}
                    defaultValue="updated"
                    onCancel={mockOnCancel}
                    onSubmit={mockOnSubmit}
                    vscode={mockVscode}
                />
            );

            expect(input).toHaveValue("updated");
        });
    });

    describe("Edge cases", () => {
        it("should handle whitespace-only name", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            fireEvent.change(input, { target: { value: "   " } });

            // Should show error after interaction
            expect(screen.getByText("Project name cannot be empty")).toBeInTheDocument();
            expect(createButton).toBeDisabled();
        });

        it("should trim name on submit", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            act(() => {
                fireEvent.change(input, { target: { value: "  trimmed-project  " } });
            });

            expect(createButton).not.toBeDisabled();

            act(() => {
                fireEvent.click(createButton);
            });

            expect(mockOnSubmit).toHaveBeenCalledWith("trimmed-project");
        });
    });
});
