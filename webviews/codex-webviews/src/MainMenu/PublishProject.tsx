import React, { useEffect, useMemo, useState } from "react";
import { WebviewHeader } from "../components/WebviewHeader";
import { createRoot } from "react-dom/client";

const vscode = acquireVsCodeApi();

type Visibility = "private" | "internal" | "public";
type ProjectType = "personal" | "group";

export interface GroupList {
    id: number;
    name: string;
    path: string;
}

export default function PublishProject() {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [visibility, setVisibility] = useState<Visibility>("private");
    const [projectType, setProjectType] = useState<ProjectType>("personal");
    const [groups, setGroups] = useState<GroupList[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    const isValidName = useMemo(() => /^[\w.-]+$/.test(name) && name.length > 0, [name]);
    const canCreate = isValidName && !busy;

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const m = event.data;
            if (m?.type === "init") {
                if (m.defaults?.name) setName(m.defaults.name);
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
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const onFetchGroups = () => {
        setError(undefined);
        vscode.postMessage({ command: "fetchGroups" });
    };

    const onCreate = () => {
        if (!canCreate) return;
        setError(undefined);
        vscode.postMessage({
            command: "createProject",
            payload: {
                name,
                description: description || undefined,
                visibility,
                projectType,
                groupId: projectType === "group" ? selectedGroupId : undefined,
            },
        });
    };

    const onCancel = () => {
        vscode.postMessage({ command: "cancel" });
    };

    return (
        <div className="min-h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]">
            <WebviewHeader title="Publish Project" vscode={vscode} />
            <div className="max-w-3xl mx-auto p-6">
                {error && (
                    <div className="mb-4 text-[var(--vscode-errorForeground)] bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)] rounded-md p-3 text-sm">
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <div className="space-y-1">
                        <label
                            className="text-xs text-[var(--vscode-descriptionForeground)]"
                            htmlFor="name"
                        >
                            Project name
                        </label>
                        <input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-md px-3 py-2 text-sm outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]"
                            placeholder="my-project"
                        />
                        {!isValidName && (
                            <div className="text-xs text-[var(--vscode-errorForeground)]">
                                Use only letters, numbers, underscore, dot, or hyphen.
                            </div>
                        )}
                    </div>

                    <div className="space-y-1">
                        <label
                            className="text-xs text-[var(--vscode-descriptionForeground)]"
                            htmlFor="description"
                        >
                            Description (optional)
                        </label>
                        <textarea
                            id="description"
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full rounded-md px-3 py-2 text-sm outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]"
                            placeholder="Short description..."
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label
                                className="text-xs text-[var(--vscode-descriptionForeground)]"
                                htmlFor="visibility"
                            >
                                Visibility
                            </label>
                            <select
                                id="visibility"
                                value={visibility}
                                onChange={(e) => setVisibility(e.target.value as Visibility)}
                                className="w-full rounded-md px-3 py-2 text-sm outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]"
                            >
                                <option value="private">private</option>
                                <option value="internal">internal</option>
                                <option value="public">public</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <span className="text-xs text-[var(--vscode-descriptionForeground)]">
                            Project type
                        </span>
                        <div className="flex items-center gap-4">
                            <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="ptype"
                                    value="personal"
                                    checked={projectType === "personal"}
                                    onChange={() => setProjectType("personal")}
                                />
                                Personal
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="ptype"
                                    value="group"
                                    checked={projectType === "group"}
                                    onChange={() => setProjectType("group")}
                                />
                                Group
                            </label>
                        </div>
                    </div>

                    {projectType === "group" && (
                        <div className="flex items-end gap-3">
                            <div className="flex-1 space-y-1">
                                <label
                                    className="text-xs text-[var(--vscode-descriptionForeground)]"
                                    htmlFor="group"
                                >
                                    Group
                                </label>
                                <select
                                    id="group"
                                    disabled={!groups.length}
                                    value={selectedGroupId ?? ""}
                                    onChange={(e) => setSelectedGroupId(Number(e.target.value))}
                                    className="w-full rounded-md px-3 py-2 text-sm outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]"
                                >
                                    {groups.map((g) => (
                                        <option key={g.id} value={g.id}>
                                            {g.name} ({g.path})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button
                                onClick={onFetchGroups}
                                disabled={busy}
                                className="whitespace-nowrap rounded-md border text-sm px-3 py-2 border-[var(--vscode-button-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] disabled:opacity-60"
                            >
                                Load Groups
                            </button>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            onClick={onCancel}
                            disabled={busy}
                            className="rounded-md border text-sm px-4 py-2 border-[var(--vscode-button-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] disabled:opacity-60"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onCreate}
                            disabled={!canCreate}
                            className="rounded-md text-sm px-4 py-2 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] disabled:opacity-60"
                        >
                            {busy ? "Creating..." : "Create"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById("root")!);
root.render(<PublishProject />);
