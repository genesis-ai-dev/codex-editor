import React, { useState } from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus, MediaFilesStrategy } from "types";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Skeleton } from "../../../components/ui/skeleton";
import { cn } from "../../../lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

interface ParsedProjectInfo {
    groups: string[];
    cleanName: string;
    displayUrl: string;
    uniqueId: string;
}

interface ProjectCardProps {
    project: ProjectWithSyncStatus;
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    onDeleteProject?: (project: ProjectWithSyncStatus) => void;
    vscode: any;
    expandedProjects: Record<string, boolean>;
    setExpandedProjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    newlyAddedProjects: Set<string>;
    statusChangedProjects: Set<string>;
    parseProjectUrl: (url?: string) => ParsedProjectInfo;
    getStatusIcon: (syncStatus: ProjectSyncStatus) => {
        icon: string;
        title: string;
        className: string;
    };
    isProgressDataLoaded?: boolean;
    isAnyOperationApplying?: boolean;
    isOnline?: boolean;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
    project,
    onCloneProject,
    onOpenProject,
    onDeleteProject,
    vscode,
    expandedProjects,
    setExpandedProjects,
    newlyAddedProjects,
    statusChangedProjects,
    parseProjectUrl,
    getStatusIcon,
    isProgressDataLoaded = false,
    isAnyOperationApplying = false,
    isOnline = true,
}) => {
    const [mediaStrategy, setMediaStrategy] = useState<MediaFilesStrategy>(
        project.mediaStrategy || "auto-download"
    );
    const [pendingStrategy, setPendingStrategy] = useState<MediaFilesStrategy | null>(null);
    const [previousStrategy, setPreviousStrategy] = useState<MediaFilesStrategy | null>(null);
    const [isHealing, setIsHealing] = useState<boolean>(false);
    const [isCloning, setIsCloning] = useState<boolean>(false);
    const [isOpening, setIsOpening] = useState<boolean>(false);
    const [isZipping, setIsZipping] = useState<boolean>(false);
    const [isZippingMini, setIsZippingMini] = useState<boolean>(false);
    const [isCleaning, setIsCleaning] = useState<boolean>(false);
    const userInitiatedStrategyChangeRef = React.useRef<boolean>(false);
    const [isApplyingStrategyDuringOtherOp, setIsApplyingStrategyDuringOtherOp] =
        useState<boolean>(false);
    const isProjectLocal = ["downloadedAndSynced", "localOnlyNotSynced"].includes(
        project.syncStatus
    );
    const isChangingStrategy = isProjectLocal && pendingStrategy !== null;
    const disableControls =
        isAnyOperationApplying ||
        isChangingStrategy ||
        isHealing ||
        isCloning ||
        isOpening ||
        isZipping ||
        isZippingMini ||
        isCleaning ||
        isApplyingStrategyDuringOtherOp;

    // Sync local state with project.mediaStrategy when it changes from backend
    // This ensures the UI always reflects the persisted value from localProjectSettings.json
    // Only sync for local projects where the backend manages state
    React.useEffect(() => {
        const incoming = project.mediaStrategy || "auto-download";
        // Always sync from props when they change, but skip if we're actively changing
        // (pendingStrategy is set during user-initiated changes, or userInitiatedStrategyChangeRef tracks in-flight changes)
        // For cloud-only projects, don't sync from props - user selection is stored locally
        if (
            !pendingStrategy &&
            !userInitiatedStrategyChangeRef.current &&
            incoming !== mediaStrategy &&
            isProjectLocal
        ) {
            setMediaStrategy(incoming);
        }
    }, [project.mediaStrategy, pendingStrategy, mediaStrategy, isProjectLocal]);

    const getStrategyLabel = (strategy: MediaFilesStrategy): string => {
        switch (strategy) {
            case "auto-download":
                return "Auto Download Media";
            case "stream-and-save":
                return "Stream & Save";
            case "stream-only":
                return "Stream Only";
            default:
                return "Auto Download Media";
        }
    };

    const handleMediaStrategyChange = (strategy: MediaFilesStrategy) => {
        const isLocal = ["downloadedAndSynced", "localOnlyNotSynced"].includes(project.syncStatus);
        if (isLocal) {
            // Store the current strategy before changing (so we can revert on cancel)
            setPreviousStrategy(mediaStrategy);

            // Update label immediately, but only enter applying state when provider signals start
            setMediaStrategy(strategy);
            // Mark that this was a user-initiated change (for highlighting purposes)
            userInitiatedStrategyChangeRef.current = true;
            vscode.postMessage({
                command: "project.setMediaStrategy",
                projectPath: project.path,
                mediaStrategy: strategy,
            });
        } else {
            // Cloud-only project: store selection for later clone without entering applying state
            setPendingStrategy(null);
            setMediaStrategy(strategy);
        }
    };

    // Listen for result from provider to either confirm or revert selection
    React.useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const msg = event.data;
            if (msg?.command === "project.mediaStrategyApplying") {
                if (msg.projectPath === project.path) {
                    if (msg.applying && isProjectLocal) {
                        // Check if this was user-initiated (user changed dropdown) or auto-applied (mismatch detected)
                        if (userInitiatedStrategyChangeRef.current) {
                            // User-initiated: highlight dropdown by setting pendingStrategy
                            if (!pendingStrategy) setPendingStrategy(mediaStrategy);
                        } else {
                            // Auto-applied during open/clone: don't highlight dropdown, just disable controls
                            setIsApplyingStrategyDuringOtherOp(true);
                        }
                    } else {
                        // Applying finished or not applying
                        setPendingStrategy(null);
                        setIsApplyingStrategyDuringOtherOp(false);
                        userInitiatedStrategyChangeRef.current = false;
                    }
                }
                return;
            }
            if (msg?.command === "project.setMediaStrategyResult") {
                if (!msg.success) {
                    // Revert to previous strategy (before the change was attempted)
                    if (previousStrategy) {
                        setMediaStrategy(previousStrategy);
                    }
                }
                // Success case: parent component will update the project prop via its message handler
                setPendingStrategy(null);
                setPreviousStrategy(null); // Clear previous strategy after handling result
                userInitiatedStrategyChangeRef.current = false;
            }
            if (msg?.command === "project.healingInProgress") {
                if (msg.projectPath === project.path) {
                    setIsHealing(msg.healing);
                }
                return;
            }
            if (msg?.command === "project.cloningInProgress") {
                // For cloud projects, match by gitOriginUrl since they don't have a local path yet
                // For local projects, match by path
                const matchesByUrl =
                    msg.gitOriginUrl &&
                    project.gitOriginUrl &&
                    msg.gitOriginUrl === project.gitOriginUrl;
                const matchesByPath =
                    msg.projectPath && project.path && msg.projectPath === project.path;
                if (matchesByUrl || matchesByPath) {
                    setIsCloning(msg.cloning);
                    // Clear strategy applying state when cloning completes
                    if (!msg.cloning) {
                        setIsApplyingStrategyDuringOtherOp(false);
                        userInitiatedStrategyChangeRef.current = false;
                    }
                }
                return;
            }
            if (msg?.command === "project.openingInProgress") {
                if (msg.projectPath === project.path) {
                    setIsOpening(msg.opening);
                    // Clear strategy applying state when opening completes
                    if (!msg.opening) {
                        setIsApplyingStrategyDuringOtherOp(false);
                        userInitiatedStrategyChangeRef.current = false;
                    }
                }
                return;
            }
            if (msg?.command === "project.zippingInProgress") {
                if (msg.projectPath === project.path) {
                    if (msg.zipType === "full") {
                        setIsZipping(msg.zipping);
                    } else if (msg.zipType === "mini") {
                        setIsZippingMini(msg.zipping);
                    }
                }
                return;
            }
            if (msg?.command === "project.cleaningInProgress") {
                if (msg.projectPath === project.path) {
                    setIsCleaning(msg.cleaning);
                }
                return;
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [pendingStrategy, project, isProjectLocal, mediaStrategy]);

    const renderMediaStrategyDropdown = () => {
        // Highlight dropdown when strategy is being changed/applied (either explicitly or during open/clone)
        const isStrategyHighlighted = isChangingStrategy || isApplyingStrategyDuringOtherOp;

        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                            "h-6 text-xs px-2",
                            isStrategyHighlighted &&
                                "ring-2 ring-amber-300 border-amber-300 bg-amber-50 text-amber-700 shadow-sm"
                        )}
                        disabled={disableControls}
                        title="Media Files Download Strategy"
                    >
                        {isChangingStrategy ? (
                            <>
                                <i className="codicon codicon-loading codicon-modifier-spin mr-1" />
                                Applying...
                            </>
                        ) : (
                            <>
                                {getStrategyLabel(mediaStrategy)}
                                <i className="codicon codicon-chevron-down ml-1 text-[10px]" />
                            </>
                        )}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                        onClick={() => handleMediaStrategyChange("auto-download")}
                        className={cn(
                            "text-xs cursor-pointer",
                            mediaStrategy === "auto-download" && "bg-accent"
                        )}
                        disabled={disableControls}
                    >
                        <i className="codicon codicon-cloud-download mr-2" />
                        Auto Download Media
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => handleMediaStrategyChange("stream-and-save")}
                        className={cn(
                            "text-xs cursor-pointer",
                            mediaStrategy === "stream-and-save" && "bg-accent"
                        )}
                        disabled={disableControls}
                    >
                        <i className="codicon codicon-cloud-upload mr-2" />
                        Stream & Save
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => handleMediaStrategyChange("stream-only")}
                        className={cn(
                            "text-xs cursor-pointer",
                            mediaStrategy === "stream-only" && "bg-accent"
                        )}
                        disabled={disableControls}
                    >
                        <i className="codicon codicon-play-circle mr-2" />
                        Stream Only
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    };

    const renderProjectActions = (project: ProjectWithSyncStatus) => {
        const isLocal = ["downloadedAndSynced", "localOnlyNotSynced"].includes(project.syncStatus);
        const isRemote = project.syncStatus === "cloudOnlyNotSynced";

        if (isLocal) {
            return (
                <div className="flex gap-1 items-center">
                    {renderMediaStrategyDropdown()}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenProject(project)}
                        className={cn(
                            "h-6 text-xs px-2",
                            (isChangingStrategy || isOpening || isHealing) &&
                                "ring-2 ring-amber-300 border-amber-300 bg-amber-50 text-amber-700 shadow-sm"
                        )}
                        disabled={disableControls}
                    >
                        {isHealing ? (
                            <>
                                <i className="codicon codicon-loading codicon-modifier-spin mr-1" />
                                Updating...
                            </>
                        ) : isOpening ? (
                            <>
                                <i className="codicon codicon-loading codicon-modifier-spin mr-1" />
                                Opening...
                            </>
                        ) : (
                            <>
                                <i className="codicon codicon-folder-opened mr-1" />
                                Open
                            </>
                        )}
                    </Button>
                </div>
            );
        }

        if (isRemote) {
            return (
                <div className="flex gap-1 items-center">
                    {renderMediaStrategyDropdown()}
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onCloneProject({ ...project, mediaStrategy })}
                        className={cn(
                            "h-6 text-xs px-2",
                            (isChangingStrategy || isCloning) &&
                                "ring-2 ring-amber-300 border-amber-300 bg-amber-50 text-amber-700 shadow-sm"
                        )}
                        disabled={disableControls}
                    >
                        {isCloning ? (
                            <>
                                <i className="codicon codicon-loading codicon-modifier-spin mr-1" />
                                Cloning...
                            </>
                        ) : (
                            <>
                                <i className="codicon codicon-arrow-circle-down mr-1" />
                                Clone
                            </>
                        )}
                    </Button>
                </div>
            );
        }

        return null;
    };

    const renderProjectCard = () => {
        if (!project) return null;
        const { cleanName, displayUrl } = parseProjectUrl(project.gitOriginUrl);
        const isUnpublished = !project.gitOriginUrl;
        const status = getStatusIcon(project.syncStatus);
        const isExpanded = expandedProjects[project.name];
        const isNewlyAdded = newlyAddedProjects.has(project.name);
        const isStatusChanged = statusChangedProjects.has(project.name);
        const isUpdateRequired = project.pendingUpdate?.required;

        const isApplyingForThisProject = isChangingStrategy;
        return (
            <div
                key={`${project.name}-${project.gitOriginUrl || "no-url"}`}
                className={cn(
                    "flex items-center justify-between py-2 px-3 transition-colors duration-200 border-b last:border-b-0",
                    !isApplyingForThisProject && "hover:bg-muted/30",
                    isNewlyAdded && "bg-blue-50/50",
                    isStatusChanged && "bg-green-50/50"
                )}
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="relative flex-shrink-0">
                        <i
                            className={cn(
                                "codicon text-sm",
                                status.icon,
                                status.className,
                                "transition-all duration-300"
                            )}
                            title={status.title}
                        />
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="font-normal truncate transition-colors duration-200 text-sm">
                            {project.name || cleanName}
                        </span>
                        {isUnpublished && (
                            <Badge variant="outline" className="text-xs px-1 py-0">
                                Unpublished
                            </Badge>
                        )}
                        {isNewlyAdded && (
                            <Badge
                                variant="default"
                                className="text-xs bg-blue-500 animate-pulse px-1 py-0"
                            >
                                New
                            </Badge>
                        )}
                        {isStatusChanged && (
                            <Badge
                                variant="default"
                                className="text-xs bg-green-500 animate-pulse px-1 py-0"
                            >
                                Updated
                            </Badge>
                        )}
                        {isUpdateRequired && (
                            <Badge
                                variant="default"
                                className="text-xs bg-amber-500 text-amber-50 border-amber-500"
                                title={project.pendingUpdate?.reason || "Project administrator requires update"}
                            >
                                Update required
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {project.completionPercentage !== undefined ? (
                        <div className="flex items-center gap-1">
                            <span className="text-xs font-medium text-muted-foreground">
                                {project.completionPercentage.toFixed(0)}%
                            </span>
                            <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-green-500 transition-all duration-500 ease-out"
                                    style={{
                                        width: `${Math.min(project.completionPercentage, 100)}%`,
                                    }}
                                />
                            </div>
                        </div>
                    ) : !isProgressDataLoaded ? (
                        <div className="flex items-center gap-1">
                            <Skeleton className="h-3 w-5" />
                            <Skeleton className="h-1.5 w-12" />
                        </div>
                    ) : null}
                    {renderProjectActions(project)}
                    {(displayUrl || onDeleteProject) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                setExpandedProjects((prev) => ({
                                    ...prev,
                                    [project.name]: !prev[project.name],
                                }))
                            }
                            className="h-6 w-6 p-0 transition-transform duration-200"
                            disabled={disableControls}
                        >
                            <i
                                className={cn(
                                    "codicon codicon-chevron-down transition-transform duration-200 text-xs",
                                    isExpanded && "rotate-180"
                                )}
                            />
                        </Button>
                    )}
                </div>
            </div>
        );
    };

    const renderProjectDetails = () => {
        if (!project) return null;
        const { cleanName,displayUrl, uniqueId } = parseProjectUrl(project.gitOriginUrl);
        const isExpanded = expandedProjects[project.name];
        const isLocal = ["downloadedAndSynced", "localOnlyNotSynced"].includes(project.syncStatus);

        if (!isExpanded || (!displayUrl && !onDeleteProject)) return null;

        return (
            <div className="bg-muted/30 border-t">
                <div className="p-3 space-y-2">
                    {displayUrl && (
                        <>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground font-mono">
                                    {displayUrl}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        navigator.clipboard.writeText(project.gitOriginUrl || "")
                                    }
                                    className="h-6 text-xs"
                                >
                                    <i className="codicon codicon-copy" />
                                </Button>
                            </div>
                            {uniqueId && (
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">
                                        #{uniqueId}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => navigator.clipboard.writeText(uniqueId)}
                                        className="h-6 text-xs"
                                    >
                                        <i className="codicon codicon-copy" />
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                    {isLocal && (
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs">{cleanName}</span>
                            <div className="flex gap-2">
                                {(project.syncStatus === "downloadedAndSynced" ||
                                    project.syncStatus === "error") &&
                                    mediaStrategy === "stream-and-save" && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                vscode.postMessage({
                                                    command: "project.cleanupMediaFiles",
                                                    projectPath: project.path,
                                                });
                                            }}
                                            className={cn(
                                                "h-6 text-xs text-purple-600 hover:text-purple-700",
                                                isCleaning &&
                                                    "ring-2 ring-amber-300 border-amber-300 bg-amber-50 text-amber-700 shadow-sm"
                                            )}
                                            disabled={disableControls}
                                            title="Delete downloaded media files to save space"
                                        >
                                            {isCleaning ? (
                                                <>
                                                    <i className="codicon codicon-loading codicon-modifier-spin mr-1" />
                                                    Cleaning...
                                                </>
                                            ) : (
                                                <>
                                                    <i className="codicon codicon-trash mr-1" />
                                                    Clean Media
                                                </>
                                            )}
                                        </Button>
                                    )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        vscode.postMessage({
                                            command: "zipProject",
                                            projectName: project.name,
                                            projectPath: project.path,
                                            includeGit: true,
                                        });
                                    }}
                                    className={cn(
                                        "h-6 text-xs",
                                        isZipping &&
                                            "ring-2 ring-amber-300 border-amber-300 bg-amber-50 text-amber-700 shadow-sm"
                                    )}
                                    disabled={disableControls}
                                >
                                    {isZipping ? (
                                        <>
                                            <i className="codicon codicon-loading codicon-modifier-spin mr-1" />
                                            Zipping...
                                        </>
                                    ) : (
                                        <>
                                            <i className="codicon codicon-package mr-1" />
                                            ZIP (with git)
                                        </>
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        vscode.postMessage({
                                            command: "zipProject",
                                            projectName: project.name,
                                            projectPath: project.path,
                                        });
                                    }}
                                    className={cn(
                                        "h-6 text-xs",
                                        isZippingMini &&
                                            "ring-2 ring-amber-300 border-amber-300 bg-amber-50 text-amber-700 shadow-sm"
                                    )}
                                    disabled={disableControls}
                                >
                                    {isZippingMini ? (
                                        <>
                                            <i className="codicon codicon-loading codicon-modifier-spin mr-1" />
                                            Zipping...
                                        </>
                                    ) : (
                                        <>
                                            <i className="codicon codicon-file-zip mr-1" />
                                            Mini ZIP
                                        </>
                                    )}
                                </Button>
                                {onDeleteProject && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onDeleteProject(project)}
                                        className="h-6 text-xs text-red-500 hover:text-red-600"
                                        disabled={disableControls}
                                    >
                                        <i className="codicon codicon-trash mr-1" />
                                        Delete
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div key={`${project.name}-${project.gitOriginUrl || "no-url"}`}>
            {renderProjectCard()}
            {renderProjectDetails()}
        </div>
    );
};
