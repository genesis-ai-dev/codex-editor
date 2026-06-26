import React, { useEffect, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface RenameModalProps {
    open: boolean;
    title: string;
    description: string;
    originalLabel: string;
    value: string;
    placeholder?: string;
    confirmButtonLabel?: string;
    disabled?: boolean;
    /**
     * Optional inline validation. Returning a non-null string will display the
     * message under the input and disable the confirm button. The component
     * still respects `disabled` for non-validation reasons (e.g. empty input).
     */
    validate?: (value: string) => string | null;
    onClose: () => void;
    onConfirm: () => void;
    onValueChange: (value: string) => void;
}

export const RenameModal: React.FC<RenameModalProps> = ({
    open,
    title,
    description,
    originalLabel,
    value,
    placeholder,
    confirmButtonLabel = "Save",
    disabled = false,
    validate,
    onClose,
    onConfirm,
    onValueChange,
}) => {
    const validationMessage = validate ? validate(value) : null;
    const isInvalid = validationMessage !== null;
    const isConfirmDisabled = disabled || isInvalid;
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input when modal opens
    useEffect(() => {
        if (open && inputRef.current) {
            // Small delay to ensure dialog is fully rendered
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 100);
        }
    }, [open]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (!isConfirmDisabled) {
                onConfirm();
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent
                showCloseButton={false}
                className="bg-vscode-editor-background border-vscode-editorWidget-border min-w-[300px] max-w-[350px] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
                style={{
                    backgroundColor: "var(--vscode-editor-background)",
                    borderColor: "var(--vscode-editorWidget-border)",
                }}
            >
                <DialogHeader className="text-left">
                    <DialogTitle
                        className="text-base font-semibold mb-4"
                        style={{
                            fontSize: "16px",
                            fontWeight: "600",
                            color: "var(--vscode-foreground)",
                            marginBottom: "16px",
                        }}
                    >
                        {title}
                    </DialogTitle>
                    <DialogDescription
                        className="text-sm text-left leading-relaxed"
                        style={{
                            fontSize: "14px",
                            color: "var(--vscode-descriptionForeground)",
                            lineHeight: "1.5",
                        }}
                    >
                        {description.includes("{label}")
                            ? description.replace("{label}", originalLabel)
                            : `${description} "${originalLabel}"`}
                    </DialogDescription>
                </DialogHeader>
                <Input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => onValueChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    aria-invalid={isInvalid}
                    aria-describedby={isInvalid ? "rename-modal-error" : undefined}
                    className="w-full bg-vscode-input-background placeholder:text-gray-500 text-vscode-input-foreground border-vscode-input-border"
                    style={{
                        padding: "8px",
                        fontSize: "14px",
                        backgroundColor: "var(--vscode-input-background)",
                        color: "var(--vscode-input-foreground)",
                        borderColor: isInvalid
                            ? "var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground))"
                            : "var(--vscode-input-border)",
                        borderRadius: "6px",
                        marginBottom: isInvalid ? "8px" : "20px",
                    }}
                />
                {isInvalid && (
                    <div
                        id="rename-modal-error"
                        role="alert"
                        style={{
                            color: "var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground))",
                            fontSize: "12px",
                            lineHeight: "1.4",
                            marginBottom: "16px",
                        }}
                    >
                        {validationMessage}
                    </div>
                )}
                <DialogFooter className="flex gap-3 justify-end">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="default" onClick={onConfirm} disabled={isConfirmDisabled}>
                        {confirmButtonLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default RenameModal;
