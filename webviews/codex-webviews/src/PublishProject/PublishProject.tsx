import { useEffect, useMemo, useState } from "react";
import { WebviewHeader } from "../components/WebviewHeader";
import { Button } from "../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "../lib/utils";

const vscode = acquireVsCodeApi();

export interface GroupList {
    id: number;
    name: string;
    path: string;
}

interface PersistedState {
    groups: GroupList[];
    selectedGroupId: number | undefined;
    name: string;
    description: string;
    projectId: string | undefined;
}

// Get persisted state from VS Code webview API
const getPersistedState = (): PersistedState | undefined => {
    try {
        return vscode.getState() as PersistedState | undefined;
    } catch {
        return undefined;
    }
};

const persistedState = getPersistedState();

export default function PublishProject() {
    const [name, setName] = useState(persistedState?.name ?? "");
    const [description, setDescription] = useState(persistedState?.description ?? "");
    const [groups, setGroups] = useState<GroupList[]>(persistedState?.groups ?? []);
    const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>(persistedState?.selectedGroupId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [projectId, setProjectId] = useState<string | undefined>(persistedState?.projectId);
    // Only show loading if we don't have persisted groups
    const [loadingGroups, setLoadingGroups] = useState(!persistedState?.groups?.length);
    const [groupSearch, setGroupSearch] = useState("");
    const [comboboxOpen, setComboboxOpen] = useState(false);

    const isValidName = useMemo(() => /^[\w.-]+$/.test(name) && name.length > 0, [name]);
    
    // Filter groups based on search
    const filteredGroups = useMemo(() => {
        if (!groupSearch.trim()) return groups;
        const lowerSearch = groupSearch.toLowerCase();
        return groups.filter(
            (g) =>
                g.name.toLowerCase().includes(lowerSearch) ||
                g.path.toLowerCase().includes(lowerSearch)
        );
    }, [groups, groupSearch]);
    
    // Get the selected group for display
    const selectedGroup = useMemo(
        () => groups.find((g) => g.id === selectedGroupId),
        [groups, selectedGroupId]
    );

    const canCreate = isValidName && !busy;
    
    // Persist state whenever important values change
    useEffect(() => {
        vscode.setState({
            groups,
            selectedGroupId,
            name,
            description,
            projectId,
        } as PersistedState);
    }, [groups, selectedGroupId, name, description, projectId]);

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
                // Auto-select first group when available and none selected
                if (list.length > 0 && selectedGroupId === undefined) {
                    setSelectedGroupId(list[0].id);
                }
            }
        };

        window.addEventListener("message", handleMessage);
        vscode.postMessage({ command: "init" });
        
        // Only fetch groups if we don't have persisted groups
        if (!persistedState?.groups?.length) {
            vscode.postMessage({ command: "fetchGroups" });
        }
        
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
                                htmlFor="group"
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
                        <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    role="combobox"
                                    aria-expanded={comboboxOpen}
                                    disabled={loadingGroups || groups.length === 0}
                                    className="w-full flex items-center justify-between rounded-md px-2 py-1.5 text-base outline-none border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    <span className={cn(!selectedGroup && "text-[var(--vscode-descriptionForeground)]")}>
                                        {loadingGroups 
                                            ? "Loading groups..." 
                                            : groups.length === 0 
                                                ? "No groups available" 
                                                : selectedGroup 
                                                    ? selectedGroup.name 
                                                    : "Select a group..."}
                                    </span>
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent 
                                className="w-[var(--radix-popover-trigger-width)] p-0 border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)]"
                                align="start"
                            >
                                <div className="p-2 border-b border-[var(--vscode-input-border)]">
                                    <input
                                        type="text"
                                        placeholder="Search groups..."
                                        value={groupSearch}
                                        onChange={(e) => setGroupSearch(e.target.value)}
                                        className="w-full px-2 py-1 text-sm outline-none border border-[var(--vscode-input-border)] rounded bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]"
                                        autoFocus
                                    />
                                </div>
                                <div className="max-h-60 overflow-y-auto">
                                    {filteredGroups.length === 0 ? (
                                        <div className="px-3 py-2 text-sm text-[var(--vscode-descriptionForeground)]">
                                            No groups found
                                        </div>
                                    ) : (
                                        filteredGroups.map((g) => (
                                            <div
                                                key={g.id}
                                                onClick={() => {
                                                    setSelectedGroupId(g.id);
                                                    setComboboxOpen(false);
                                                    setGroupSearch("");
                                                }}
                                                className={cn(
                                                    "flex items-center px-3 py-1.5 text-sm cursor-pointer transition-colors",
                                                    selectedGroupId === g.id
                                                        ? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                                                        : "hover:bg-[var(--vscode-list-hoverBackground)]"
                                                )}
                                            >
                                                <Check
                                                    className={cn(
                                                        "mr-2 h-4 w-4",
                                                        selectedGroupId === g.id ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                {g.name}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </PopoverContent>
                        </Popover>
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
