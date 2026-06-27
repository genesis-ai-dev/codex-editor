import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { RenameModal } from "../RenameModal";
import { getBookNameValidationMessage } from "@sharedUtils";

describe("RenameModal validation", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const onValueChange = vi.fn();

    beforeEach(() => {
        onClose.mockReset();
        onConfirm.mockReset();
        onValueChange.mockReset();
    });

    const renderModal = (value: string) =>
        render(
            <RenameModal
                open={true}
                title="Edit Book Name"
                description="Enter new name for"
                originalLabel="Genesis"
                value={value}
                placeholder="Enter new book name"
                confirmButtonLabel="Save"
                validate={getBookNameValidationMessage}
                onClose={onClose}
                onConfirm={onConfirm}
                onValueChange={onValueChange}
            />
        );

    it("does not show a warning for a valid name", () => {
        renderModal("1-New-Items");
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows a warning when the value contains a period", () => {
        renderModal("1. New Items");
        const alert = screen.getByRole("alert");
        expect(alert).toBeInTheDocument();
        expect(alert.textContent).toContain('"."');
        expect(alert.textContent?.toLowerCase()).toContain("not allowed");
    });

    it("disables the Save button when the value is invalid", () => {
        renderModal("1. New Items");
        const saveButton = screen.getByRole("button", { name: /save/i });
        expect(saveButton).toBeDisabled();
    });

    it("re-enables Save once the period is removed", () => {
        const { rerender } = renderModal("1. New Items");
        expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

        rerender(
            <RenameModal
                open={true}
                title="Edit Book Name"
                description="Enter new name for"
                originalLabel="Genesis"
                value="1 New Items"
                placeholder="Enter new book name"
                confirmButtonLabel="Save"
                validate={getBookNameValidationMessage}
                onClose={onClose}
                onConfirm={onConfirm}
                onValueChange={onValueChange}
            />
        );

        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
    });

    it("ignores Enter when the value is invalid", () => {
        renderModal("1. New Items");
        const input = screen.getByPlaceholderText("Enter new book name");
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("invokes onConfirm on Enter when the value is valid", () => {
        renderModal("1-New-Items");
        const input = screen.getByPlaceholderText("Enter new book name");
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
