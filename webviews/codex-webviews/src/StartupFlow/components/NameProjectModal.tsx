import React, { useEffect, useMemo, useState, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../../components/ui/dialog";
import { Button, Input } from "../../components/ui";
import { MessagesToStartupFlowProvider, MessagesFromStartupFlowProvider } from "types";

interface NameProjectModalProps {
    open: boolean;
    defaultValue?: string;
    onCancel: () => void;
    onSubmit: (name: string) => void;
    vscode: any;
}

export const NameProjectModal: React.FC<NameProjectModalProps> = ({
    open,
    defaultValue = "",
    onCancel,
    onSubmit,
    vscode,
}) => {
    const [name, setName] = useState<string>(defaultValue);
    const [nameExistsError, setNameExistsError] = useState<string>("");
    const [isCheckingName, setIsCheckingName] = useState<boolean>(false);
    const [hasInteracted, setHasInteracted] = useState<boolean>(false);
    const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (open) {
            setName(defaultValue);
            setNameExistsError("");
            setHasInteracted(false);
        }
    }, [open, defaultValue]);

    // Check if project name exists when name changes (with debounce)
    useEffect(() => {
        if (!open || !name.trim()) {
            setNameExistsError("");
            return;
        }

        // Clear previous timeout
        if (checkTimeoutRef.current) {
            clearTimeout(checkTimeoutRef.current);
        }

        // Debounce the check by 500ms
        setIsCheckingName(true);
        checkTimeoutRef.current = setTimeout(() => {
            vscode.postMessage({
                command: "project.checkNameExists",
                projectName: name.trim(),
            } as MessagesToStartupFlowProvider);
        }, 500);

        return () => {
            if (checkTimeoutRef.current) {
                clearTimeout(checkTimeoutRef.current);
            }
        };
    }, [name, open, vscode]);

    // Listen for name existence check response
    useEffect(() => {
        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            if (message?.command === "project.nameExistsCheck") {
                setIsCheckingName(false);
                if (message.exists) {
                    setNameExistsError(
                        message.errorMessage || "A project with this name already exists."
                    );
                } else {
                    setNameExistsError("");
                }
            }
        };

        window.addEventListener("message", messageHandler);
        return () => window.removeEventListener("message", messageHandler);
    }, []);

    const validationError = useMemo(() => {
        // Only show empty error if user has interacted with the field
        if (hasInteracted && !name.trim()) return "Project name cannot be empty";
        if (name.length > 100) return "Project name is too long (max 100 characters)";
        if (nameExistsError) return nameExistsError;
        return "";
    }, [name, nameExistsError, hasInteracted]);

    const handleSubmit = () => {
        // Mark as interacted when user tries to submit
        setHasInteracted(true);

        // Don't submit if there's a validation error or if we're still checking
        if (validationError || isCheckingName) {
            return;
        }
        onSubmit(name.trim());
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New Project</DialogTitle>
                    <DialogDescription>Choose a name for your new project</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                    <Input
                        type="text"
                        value={name}
                        className="placeholder:text-gray-400"
                        onChange={(e) => {
                            setHasInteracted(true);
                            setName(e.target.value);
                        }}
                        onBlur={() => setHasInteracted(true)}
                        placeholder="my-translation-project"
                        autoFocus
                    />
                    {isCheckingName && name.trim() ? (
                        <span className="text-sm text-gray-500">Checking availability...</span>
                    ) : validationError ? (
                        <span className="text-sm text-red-500">{validationError}</span>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        disabled={Boolean(validationError) || isCheckingName}
                        onClick={handleSubmit}
                    >
                        Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NameProjectModal;
