import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";

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
        <Dialog open={open}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>
                {content}
                <DialogFooter>
                    <VSCodeButton appearance="secondary" onClick={onCancel}>
                        Cancel
                    </VSCodeButton>
                    <VSCodeButton onClick={() => onSubmit} disabled={disableSubmit}>
                        Continue
                    </VSCodeButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ConfirmModal;
