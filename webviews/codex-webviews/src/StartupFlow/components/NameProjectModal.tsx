import React, { useEffect, useMemo, useState } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../../components/ui/dialog";

interface NameProjectModalProps {
    open: boolean;
    defaultValue?: string;
    onCancel: () => void;
    onSubmit: (name: string) => void;
    pendingSanitizedName?: { original: string; sanitized: string } | null;
    onConfirmSanitized?: (proceed: boolean, sanitized?: string) => void;
}

export const NameProjectModal: React.FC<NameProjectModalProps> = ({
    open,
    defaultValue = "",
    onCancel,
    onSubmit,
    pendingSanitizedName,
    onConfirmSanitized,
}) => {
    const [name, setName] = useState<string>(defaultValue);
    useEffect(() => setName(defaultValue), [defaultValue]);

    const validationError = useMemo(() => {
        if (!name.trim()) return "Project name cannot be empty";
        if (name.length > 100) return "Project name is too long (max 100 characters)";
        return "";
    }, [name]);

    const isConfirmingSanitized = Boolean(pendingSanitizedName);

    return (
        <Dialog open={open}>
            <DialogContent className={`${isConfirmingSanitized ? "z-[60]" : ""}`}>
                <DialogHeader>
                    <DialogTitle>
                        {isConfirmingSanitized ? "Confirm Project Name" : "New Project"}
                    </DialogTitle>
                    <DialogDescription>
                        {isConfirmingSanitized
                            ? `Project name will be saved as "${pendingSanitizedName?.sanitized}"`
                            : "Choose a name for your new project"}
                    </DialogDescription>
                </DialogHeader>

                {!isConfirmingSanitized && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <VSCodeTextField
                            value={name}
                            onInput={(e: any) => setName(e.target.value || "")}
                            placeholder="my-translation-project"
                            autoFocus
                        />
                        {validationError ? (
                            <span style={{ color: "var(--vscode-errorForeground)", fontSize: 12 }}>
                                {validationError}
                            </span>
                        ) : null}
                    </div>
                )}

                {isConfirmingSanitized && (
                    <div style={{ fontSize: 12 }}>
                        <div>Original: {pendingSanitizedName?.original}</div>
                        <div>Sanitized: {pendingSanitizedName?.sanitized}</div>
                    </div>
                )}

                <DialogFooter>
                    {isConfirmingSanitized ? (
                        <>
                            <VSCodeButton
                                appearance="secondary"
                                onClick={() => onConfirmSanitized?.(false)}
                            >
                                Cancel
                            </VSCodeButton>
                            <VSCodeButton
                                onClick={() =>
                                    onConfirmSanitized?.(true, pendingSanitizedName?.sanitized)
                                }
                            >
                                Continue
                            </VSCodeButton>
                        </>
                    ) : (
                        <>
                            <VSCodeButton appearance="secondary" onClick={onCancel}>
                                Cancel
                            </VSCodeButton>
                            <VSCodeButton
                                disabled={Boolean(validationError)}
                                onClick={() => onSubmit(name.trim())}
                            >
                                Create
                            </VSCodeButton>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NameProjectModal;
