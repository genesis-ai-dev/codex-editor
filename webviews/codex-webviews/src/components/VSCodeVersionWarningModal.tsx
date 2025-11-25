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

interface VSCodeVersionWarningModalProps {
    open: boolean;
    onClose: () => void;
}

export const VSCodeVersionWarningModal: React.FC<VSCodeVersionWarningModalProps> = ({
    open,
    onClose,
}) => {
    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent
                showCloseButton={false}
                className="bg-vscode-editor-background border-vscode-editorWidget-border max-w-[400px] sm:max-w-[400px] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
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
                        Update Required
                    </DialogTitle>
                    <DialogDescription
                        className="text-sm text-left leading-relaxed"
                        style={{
                            fontSize: "14px",
                            color: "var(--vscode-descriptionForeground)",
                            lineHeight: "1.5",
                        }}
                    >
                        Please visit{" "}
                        <a
                            className="text-center hover:underline"
                            href="https://codexeditor.app"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            codexeditor.app
                        </a>{" "}
                        to update Codex to the latest version.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex sm:flex-col gap-3 w-full sm:justify-center mt-4">
                    <Button variant="default" onClick={onClose} autoFocus>
                        OK
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default VSCodeVersionWarningModal;
