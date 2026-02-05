import { useEffect, useMemo, useState } from "react";
import { WebviewHeader } from "../components/WebviewHeader";
import { Button } from "../components/ui/button";

const vscode = acquireVsCodeApi();

export interface GroupList {
    id: number;
    name: string;
    path: string;
}

export default function PublishProject() {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [groups, setGroups] = useState<GroupList[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>(undefined);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [projectId, setProjectId] = useState<string | undefined>(undefined);
    const [groupFilter, setGroupFilter] = useState("");
    const [loadingGroups, setLoadingGroups] = useState(true);

    const isValidName = useMemo(() => /^[\w.-]+$/.test(name) && name.length > 0, [name]);
    
    // Filter groups based on search input
    const filteredGroups = useMemo(() => {
        if (!groupFilter.trim()) return groups;
        const lowerFilter = groupFilter.toLowerCase();
        return groups.filter(
            (g) =>
                g.name.toLowerCase().includes(lowerFilter) ||
                g.path.toLowerCase().includes(lowerFilter)
        );
    }, [groups, groupFilter]);

    // Get the selected group for display
    const selectedGroup = useMemo(
        () => groups.find((g) => g.id === selectedGroupId),
        [groups, selectedGroupId]
    );
    const canCreate = isValidName && !busy;

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const m = event.data;
            if (m?.type === "init") {
                if (m.defaults?.projectId) {
                    setProjectId(m.defaults.projectId);
                }
                // Keep the full name with UUID for proper identification
                if (m.defaults?.name) {
                    setName(m.defaults.name);
                }
            } else if (m?.type === "busy") {
                setBusy(!!m.value);
            } else if (m?.type === "error") {
                setError(m.message || "An error occurred");
                setLoadingGroups(false);
            } else if (m?.type === "groups") {
                const list: GroupList[] = Array.isArray(m.groups) ? m.groups : [];
                setGroups(list);
                setLoadingGroups(false);
                // Auto-select first group when available
                if (list.length > 0 && selectedGroupId === undefined) {
                    setSelectedGroupId(list[0].id);
                }
            }
        };

        window.addEventListener("message", handleMessage);
        vscode.postMessage({ command: "init" });
        // Immediately fetch groups when webview opens
        vscode.postMessage({ command: "fetchGroups" });
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const onFetchGroups = () => {
        setError(undefined);
        setLoadingGroups(true);
        vscode.postMessage({ command: "fetchGroups" });
    };

    const onCreate = () => {
        if (!canCreate) return;
        setError(undefined);

        vscode.postMessage({
            command: "createProject",
            payload: {
                name: name,
                description: description || undefined,
                visibility: "private",
                projectType: "group",
                groupId: selectedGroupId,
            },
        });
    };

    const onCancel = () => {
        vscode.postMessage({ command: "cancel" });
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
                            Project name (from workspace folder)
                        </label>
                        <input
                            id="name"
                            value={name}
                            readOnly
                            className="w-full rounded-md px-2 py-1 text-base outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-disabledForeground)] cursor-not-allowed"
                            placeholder="my-project"
                            title="Project name is based on the workspace folder name and cannot be changed"
                        />
                        <div className="text-xs text-[var(--vscode-descriptionForeground)]">
                            Project name matches your workspace folder and includes a unique ID
                        </div>
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

                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label
                                className="text-sm text-[var(--vscode-descriptionForeground)]"
                                htmlFor="groupFilter"
                            >
                                Group
                            </label>
                            <Button
                                onClick={onFetchGroups}
                                disabled={busy || loadingGroups}
                                className="whitespace-nowrap rounded-md border text-xs px-2 py-0.5 border-[var(--vscode-button-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] disabled:opacity-60"
                            >
                                {loadingGroups ? "Loading..." : "Refresh"}
                            </Button>
                        </div>
                        <input
                            id="groupFilter"
                            type="text"
                            value={groupFilter}
                            onChange={(e) => setGroupFilter(e.target.value)}
                            placeholder="Search groups..."
                            className="w-full rounded-md px-2 py-1 text-base outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]"
                        />
                        {selectedGroup && (
                            <div className="text-xs text-[var(--vscode-descriptionForeground)]">
                                Selected: <span className="font-medium">{selectedGroup.name}</span>
                            </div>
                        )}
                        <div className="border border-[var(--vscode-input-border)] rounded-md max-h-40 overflow-y-auto bg-[var(--vscode-input-background)]">
                            {loadingGroups ? (
                                <div className="px-3 py-2 text-sm text-[var(--vscode-descriptionForeground)]">
                                    Loading groups...
                                </div>
                            ) : filteredGroups.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-[var(--vscode-descriptionForeground)]">
                                    {groups.length === 0
                                        ? "No groups available"
                                        : "No groups match your search"}
                                </div>
                            ) : (
                                filteredGroups.map((g) => (
                                    <div
                                        key={g.id}
                                        onClick={() => setSelectedGroupId(g.id)}
                                        className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                                            selectedGroupId === g.id
                                                ? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                                                : "hover:bg-[var(--vscode-list-hoverBackground)]"
                                        }`}
                                    >
                                        {g.name}
                                    </div>
                                ))
                            )}
                        </div>
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
