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
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleSubmit();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                onCancel();
                            }
                        }}
                        placeholder="my-translation-project"
                        autoFocus
                    />
                    {name.trim() ? (
                        <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800">
                            Your project name may appear in publicly available bug reports. Please do
                            not name your project anything that could pose a security or IP risk to
                            your team.
                        </div>
                    ) : null}
                    {validationError ? (
                        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                            {validationError}
                        </div>
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
