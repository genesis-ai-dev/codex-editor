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
    onClose,
    onConfirm,
    onValueChange,
}) => {
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
            if (!disabled) {
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
                    className="w-full mb-5 bg-vscode-input-background placeholder:text-gray-500 text-vscode-input-foreground border-vscode-input-border"
                    style={{
                        padding: "8px",
                        fontSize: "14px",
                        backgroundColor: "var(--vscode-input-background)",
                        color: "var(--vscode-input-foreground)",
                        borderColor: "var(--vscode-input-border)",
                        borderRadius: "6px",
                        marginBottom: "20px",
                    }}
                />
                <DialogFooter className="flex gap-3 justify-end">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="default" onClick={onConfirm} disabled={disabled}>
                        {confirmButtonLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default RenameModal;
