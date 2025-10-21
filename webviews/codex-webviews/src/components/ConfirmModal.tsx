import React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";

interface ConfirmModalProps {
    open: boolean;
    title?: string;
    description?: string;
    content: React.ReactNode;
    disableSubmit?: boolean;
    onCancel: () => void;
    onSubmit: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    open,
    title = "Confirm",
    description,
    content,
    disableSubmit = false,
    onCancel,
    onSubmit,
}) => {
    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                {content}
                <DialogFooter>
                    <Button variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button autoFocus onClick={onSubmit} disabled={disableSubmit}>
                        Continue
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ConfirmModal;
