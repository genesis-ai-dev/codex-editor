import { useEffect, useMemo, useState } from "react";
import { WebviewHeader } from "../components/WebviewHeader";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../components/ui/select";
import { Button } from "../components/ui/button";

const vscode = acquireVsCodeApi();

type Visibility = "private" | "internal" | "public";

export interface GroupList {
    id: number;
    name: string;
    path: string;
}

export default function PublishProject() {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [visibility, setVisibility] = useState<Visibility>("private");
    const [groups, setGroups] = useState<GroupList[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [projectId, setProjectId] = useState<string | undefined>(undefined);

    const isValidName = useMemo(() => /^[\w.-]+$/.test(name) && name.length > 0, [name]);
    const canCreate = isValidName && !busy;

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const m = event.data;
            if (m?.type === "init") {
                if (m.defaults?.projectId) {
                    setProjectId(m.defaults.projectId);
                    // Strip projectId from name if it's included
                    if (m.defaults?.name) {
                        const nameWithId = m.defaults.name;
                        const nameWithoutId = nameWithId.endsWith(`-${m.defaults.projectId}`)
                            ? nameWithId.slice(
                                  0,
                                  nameWithId.length - `-${m.defaults.projectId}`.length
                              )
                            : nameWithId;
                        setName(nameWithoutId);
                    }
                } else if (m.defaults?.name) {
                    setName(m.defaults.name);
                }
                if (m.defaults?.visibility) setVisibility(m.defaults.visibility as Visibility);
            } else if (m?.type === "busy") {
                setBusy(!!m.value);
            } else if (m?.type === "error") {
                setError(m.message || "An error occurred");
            } else if (m?.type === "groups") {
                const list: GroupList[] = Array.isArray(m.groups) ? m.groups : [];
                setGroups(list);
                // Auto-select first group when available
                if (list.length > 0) {
                    setSelectedGroupId(list[0].id);
                }
            }
        };

        window.addEventListener("message", handleMessage);
        vscode.postMessage({ command: "init" });
        vscode.postMessage({ command: "fetchGroups" });
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const onFetchGroups = () => {
        setError(undefined);
        vscode.postMessage({ command: "fetchGroups" });
    };

    const onCreate = () => {
        if (!canCreate) return;
        setError(undefined);

        // Append projectId to name if available
        let finalName = name;
        if (projectId) {
            finalName = `${name}-${projectId}`;
        }

        vscode.postMessage({
            command: "createProject",
            payload: {
                name: finalName,
                description: description || undefined,
                visibility,
                projectType: "group",
                groupId: selectedGroupId,
            },
        });
    };

    const onCancel = () => {
        vscode.postMessage({ command: "cancel" });
    };

    const displayGroups = () => {
        if (groups.length === 0) {
            return (
                <SelectItem value="none" disabled className="text-base">
                    No groups found
                </SelectItem>
            );
        }

        return groups.map((g) => (
            <SelectItem key={g.id} value={g.id.toString()} className="text-base">
                {g.name} ({g.path})
            </SelectItem>
        ));
    };

    const hasGroup = selectedGroupId !== undefined;
    const disableOnCreateButton = !canCreate || busy || !hasGroup;

    return (
        <div className="min-h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]">
            <WebviewHeader
                title="Publish Project"
                vscode={vscode}
                showBackButton={false}
                showBorderShadow={false}
            />
            <div className="max-w-3xl mx-auto p-6">
                {error && (
                    <div className="mb-4 text-[var(--vscode-errorForeground)] bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)] rounded-md p-3 text-sm">
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <div className="space-y-1">
                        <label
                            className="text-sm text-[var(--vscode-descriptionForeground)]"
                            htmlFor="name"
                        >
                            Project name
                        </label>
                        <input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-md px-2 py-1 text-base outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]"
                            placeholder="my-project"
                        />
                        {!isValidName && (
                            <div className="text-sm text-[var(--vscode-errorForeground)]">
                                Use only letters, numbers, underscore, dot, or hyphen.
                            </div>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label
                            className="text-sm text-[var(--vscode-descriptionForeground)]"
                            htmlFor="description"
                        >
                            Description (optional)
                        </label>
                        <textarea
                            id="description"
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full rounded-md px-2 py-1 text-base outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]"
                            placeholder="Short description..."
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        <div className="space-y-1">
                            <label
                                className="text-sm text-[var(--vscode-descriptionForeground)]"
                                htmlFor="visibility"
                            >
                                Visibility
                            </label>
                            <Select
                                value={visibility}
                                onValueChange={(value) => setVisibility(value as Visibility)}
                            >
                                <SelectTrigger className="w-full rounded-md px-2 py-1 text-base focus-visible:ring-0 focus-visible:ring-offset-0 outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]">
                                    <SelectValue placeholder="Select a visibility" />
                                </SelectTrigger>
                                <SelectContent className="w-full rounded-md text-base outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]">
                                    <SelectItem value="private" className="text-base">
                                        private
                                    </SelectItem>
                                    <SelectItem value="internal" className="text-base">
                                        internal
                                    </SelectItem>
                                    <SelectItem value="public" className="text-base">
                                        public
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex items-end gap-3">
                        <div className="flex-1 space-y-1">
                            <label
                                className="text-sm text-[var(--vscode-descriptionForeground)]"
                                htmlFor="group"
                            >
                                Group
                            </label>
                            <Select
                                value={selectedGroupId?.toString() ?? ""}
                                onValueChange={(value) => setSelectedGroupId(Number(value))}
                            >
                                <SelectTrigger className="w-full rounded-md px-2 py-1 text-base focus-visible:ring-0 focus-visible:ring-offset-0 outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]">
                                    <SelectValue placeholder="Select a group" />
                                </SelectTrigger>
                                <SelectContent className="w-full rounded-md text-base outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]">
                                    {displayGroups()}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            onClick={onFetchGroups}
                            disabled={busy}
                            className="whitespace-nowrap rounded-md border text-sm px-2 py-1 border-[var(--vscode-button-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] disabled:opacity-60"
                        >
                            Load Groups
                        </Button>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            onClick={onCancel}
                            disabled={busy}
                            className="rounded-md border text-sm px-4 py-2 border-[var(--vscode-button-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] disabled:opacity-60"
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="default"
                            onClick={onCreate}
                            disabled={disableOnCreateButton}
                            className={`${
                                disableOnCreateButton
                                    ? "cursor-not-allowed pointer-events-auto"
                                    : "cursor-pointer"
                            }`}
                        >
                            {busy ? "Creating..." : "Create"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
