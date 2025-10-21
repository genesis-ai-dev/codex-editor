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

interface NameProjectModalProps {
    open: boolean;
    defaultValue?: string;
    onCancel: () => void;
    onSubmit: (name: string) => void;
}

export const NameProjectModal: React.FC<NameProjectModalProps> = ({
    open,
    defaultValue = "",
    onCancel,
    onSubmit,
}) => {
    const [name, setName] = useState<string>(defaultValue);

    useEffect(() => {
        if (open) {
            setName(defaultValue);
        }
    }, [open, defaultValue]);

    const validationError = useMemo(() => {
        if (!name.trim()) return "Project name cannot be empty";
        if (name.length > 100) return "Project name is too long (max 100 characters)";
        return "";
    }, [name]);

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
                        onChange={(e) => setName(e.target.value)}
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
                        disabled={Boolean(validationError)}
                        onClick={() => onSubmit(name.trim())}
                    >
                        Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NameProjectModal;
