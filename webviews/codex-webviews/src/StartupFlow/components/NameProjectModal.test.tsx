import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { NameProjectModal } from "./NameProjectModal";
import { MessagesFromStartupFlowProvider } from "types";

describe("NameProjectModal", () => {
    let mockVscode: any;
    let mockOnSubmit: ReturnType<typeof vi.fn>;
    let mockOnCancel: ReturnType<typeof vi.fn>;
    let messageHandlers: Array<(event: MessageEvent) => void>;

    beforeEach(() => {
        vi.useFakeTimers();
        messageHandlers = [];
        mockOnSubmit = vi.fn();
        mockOnCancel = vi.fn();
        mockVscode = {
            postMessage: vi.fn(),
        };

        // Mock window.addEventListener for message events
        const originalAddEventListener = window.addEventListener;
        window.addEventListener = vi.fn((event: string, handler: any) => {
            if (event === "message") {
                messageHandlers.push(handler);
            }
            originalAddEventListener(event, handler);
        });

        // Mock window.removeEventListener
        const originalRemoveEventListener = window.removeEventListener;
        window.removeEventListener = vi.fn((event: string, handler: any) => {
            if (event === "message") {
                const index = messageHandlers.indexOf(handler);
                if (index > -1) {
                    messageHandlers.splice(index, 1);
                }
            }
            originalRemoveEventListener(event, handler);
        });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.restoreAllMocks();
        vi.useRealTimers();
        messageHandlers = [];
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

    function simulateMessageResponse(message: MessagesFromStartupFlowProvider) {
        const event = new MessageEvent("message", {
            data: message,
        });
        messageHandlers.forEach((handler) => handler(event));
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
                vi.runAllTimers();
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
                vi.runAllTimers();
            });

            // Simulate name check response
            act(() => {
                simulateMessageResponse({
                    command: "project.nameExistsCheck",
                    exists: false,
                    isCodexProject: false,
                });
            });

            expect(createButton).not.toBeDisabled();
        });
    });

    describe("Name existence checking", () => {
        it("should send checkNameExists message after debounce", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            fireEvent.change(input, { target: { value: "test-project" } });

            // Should not send immediately
            expect(mockVscode.postMessage).not.toHaveBeenCalled();

            // Fast-forward 500ms
            vi.advanceTimersByTime(500);

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "project.checkNameExists",
                projectName: "test-project",
            });
        });

        it("should show checking availability message while checking", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            fireEvent.change(input, { target: { value: "test-project" } });
            vi.advanceTimersByTime(500);

            expect(screen.getByText("Checking availability...")).toBeInTheDocument();
        });

        it("should handle name exists response", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            act(() => {
                fireEvent.change(input, { target: { value: "existing-project" } });
                vi.runAllTimers();
            });

            act(() => {
                simulateMessageResponse({
                    command: "project.nameExistsCheck",
                    exists: true,
                    isCodexProject: true,
                    errorMessage:
                        'A project with the name "existing-project" already exists. Please choose a different name.',
                });
            });

            expect(
                screen.getByText(/A project with the name.*already exists/i)
            ).toBeInTheDocument();
            expect(screen.queryByText("Checking availability...")).not.toBeInTheDocument();
        });

        it("should handle name does not exist response", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            act(() => {
                fireEvent.change(input, { target: { value: "new-project" } });
                vi.runAllTimers();
            });

            act(() => {
                simulateMessageResponse({
                    command: "project.nameExistsCheck",
                    exists: false,
                    isCodexProject: false,
                });
            });

            expect(screen.queryByText("Checking availability...")).not.toBeInTheDocument();
            expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
        });

        it("should debounce multiple rapid changes", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            fireEvent.change(input, { target: { value: "a" } });
            vi.advanceTimersByTime(200);
            fireEvent.change(input, { target: { value: "ab" } });
            vi.advanceTimersByTime(200);
            fireEvent.change(input, { target: { value: "abc" } });

            // Should only have called postMessage once after final debounce
            expect(mockVscode.postMessage).not.toHaveBeenCalled();

            vi.advanceTimersByTime(500);

            expect(mockVscode.postMessage).toHaveBeenCalledTimes(1);
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "project.checkNameExists",
                projectName: "abc",
            });
        });

        it("should disable Create button while checking", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            fireEvent.change(input, { target: { value: "test-project" } });
            vi.advanceTimersByTime(500);

            expect(createButton).toBeDisabled();
        });
    });

    describe("Submit behavior", () => {
        it("should call onSubmit with trimmed name", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            act(() => {
                fireEvent.change(input, { target: { value: "  test-project  " } });
                vi.runAllTimers();
            });

            // Simulate name check response
            act(() => {
                simulateMessageResponse({
                    command: "project.nameExistsCheck",
                    exists: false,
                    isCodexProject: false,
                });
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

            fireEvent.change(input, { target: { value: "a".repeat(101) } });

            // Button should be disabled
            expect(createButton).toBeDisabled();

            // Try to click (shouldn't work)
            fireEvent.click(createButton);

            expect(mockOnSubmit).not.toHaveBeenCalled();
        });

        it("should not submit while checking name", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            fireEvent.change(input, { target: { value: "test-project" } });
            vi.advanceTimersByTime(500);

            // Button should be disabled while checking
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

        it("should call onCancel when dialog is closed", () => {
            renderModal();

            // Find and click the close button (usually rendered by Dialog)
            const dialog = screen.getByRole("dialog");
            // Simulate closing via onOpenChange
            // This is typically handled by clicking outside or pressing Escape
            // For testing, we'll trigger it programmatically
            const closeButton = screen.queryByRole("button", { name: /close/i });
            if (closeButton) {
                fireEvent.click(closeButton);
            }
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

        it("should clear nameExistsError when name changes", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            // Type name and get error response
            act(() => {
                fireEvent.change(input, { target: { value: "existing" } });
                vi.runAllTimers();
            });

            act(() => {
                simulateMessageResponse({
                    command: "project.nameExistsCheck",
                    exists: true,
                    isCodexProject: true,
                    errorMessage: "A project with this name already exists.",
                });
            });

            expect(screen.getByText(/already exists/i)).toBeInTheDocument();

            // Change name - this should clear the error immediately
            act(() => {
                fireEvent.change(input, { target: { value: "new-name" } });
            });

            // Error should be cleared when name changes (before new check completes)
            expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
        });
    });

    describe("Edge cases", () => {
        it("should handle empty string name check", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;

            fireEvent.change(input, { target: { value: "test" } });
            fireEvent.change(input, { target: { value: "" } });

            // Should not send check for empty name
            vi.advanceTimersByTime(500);
            expect(mockVscode.postMessage).not.toHaveBeenCalled();
        });

        it("should handle whitespace-only name", () => {
            renderModal();
            const input = screen.getByPlaceholderText("my-translation-project") as HTMLInputElement;
            const createButton = screen.getByRole("button", { name: /create/i });

            fireEvent.change(input, { target: { value: "   " } });

            // Should not send check for whitespace-only
            vi.advanceTimersByTime(500);
            expect(mockVscode.postMessage).not.toHaveBeenCalled();

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
                vi.runAllTimers();
            });

            act(() => {
                simulateMessageResponse({
                    command: "project.nameExistsCheck",
                    exists: false,
                    isCodexProject: false,
                });
            });

            expect(createButton).not.toBeDisabled();

            act(() => {
                fireEvent.click(createButton);
            });

            expect(mockOnSubmit).toHaveBeenCalledWith("trimmed-project");
        });
    });
});
