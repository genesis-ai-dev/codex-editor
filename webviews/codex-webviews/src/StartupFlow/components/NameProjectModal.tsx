import React, { useEffect, useMemo, useState } from "react";
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
    const [hasInteracted, setHasInteracted] = useState<boolean>(false);

    useEffect(() => {
        if (open) {
            setName(defaultValue);
            setHasInteracted(false);
        }
    }, [open, defaultValue]);

    const validationError = useMemo(() => {
        // Only show empty error if user has interacted with the field
        if (hasInteracted && !name.trim()) return "Project name cannot be empty";
        if (name.length > 256) return "Project name is too long (max 256 characters)";
        return "";
    }, [name, hasInteracted]);

    const handleSubmit = () => {
        setHasInteracted(true);

        if (!name.trim() || validationError) {
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
                    {validationError ? (
                        <span className="text-sm text-red-500">{validationError}</span>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!name.trim() || Boolean(validationError)}
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
