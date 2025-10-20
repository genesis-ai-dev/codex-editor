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
}

export const NameProjectModal: React.FC<NameProjectModalProps> = ({
    open,
    defaultValue = "",
    onCancel,
    onSubmit,
}) => {
    const [name, setName] = useState<string>(defaultValue);
    useEffect(() => setName(defaultValue), [defaultValue]);

    const validationError = useMemo(() => {
        if (!name.trim()) return "Project name cannot be empty";
        if (name.length > 100) return "Project name is too long (max 100 characters)";
        return "";
    }, [name]);

    return (
        <Dialog open={open}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        New Project
                    </DialogTitle>
                    <DialogDescription>
                        Choose a name for your new project
                    </DialogDescription>
                </DialogHeader>

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

                <DialogFooter>
                    <VSCodeButton appearance="secondary" onClick={onCancel}>
                        Cancel
                    </VSCodeButton>
                    <VSCodeButton
                        disabled={Boolean(validationError)}
                        onClick={() => onSubmit(name.trim())}
                    >
                        Create
                    </VSCodeButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NameProjectModal;
