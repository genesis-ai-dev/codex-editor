import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../../components/ui/dialog";

interface ConfirmModalProps {
    open: boolean;
    title?: string;
    description?: string;
    onCancel: () => void;
    onSubmit: (name?: string) => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    open,
    title = "Confirm",
    description,
    onCancel,
    onSubmit,
}) => {
    const data = (window as any).__codexConfirmData as
        | { original: string; sanitized: string }
        | undefined;

    const sanitized = data?.sanitized || "";
    const original = data?.original || "";

    return (
        <Dialog open={open}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>

                <div className="flex flex-col justify-center items-center py-8">
                    <div className="font-semibold">{sanitized}</div>
                </div>

                <DialogFooter>
                    <VSCodeButton appearance="secondary" onClick={onCancel}>
                        Cancel
                    </VSCodeButton>
                    <VSCodeButton onClick={() => onSubmit(sanitized)} disabled={!sanitized}>
                        Continue
                    </VSCodeButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ConfirmModal;
