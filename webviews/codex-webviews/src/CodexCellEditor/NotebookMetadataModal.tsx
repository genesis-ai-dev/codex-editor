import React, { useEffect, useState } from "react";
import { CustomNotebookMetadata } from "../../../../types";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { Separator } from "../components/ui/separator";
import { Badge } from "../components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { formatBytes } from "../lib/utils";

interface NotebookMetadataModalProps {
    isOpen: boolean;
    onClose: () => void;
    metadata: CustomNotebookMetadata;
    /**
     * Commit the edited metadata. Only called when the user clicks "Save Changes".
     * `pendingVideoFilePath` is the absolute path of a staged video pick that the
     * host should import into the project as part of this save.
     */
    onSave: (updated: CustomNotebookMetadata, pendingVideoFilePath?: string) => void;
    onPickFile: () => void;
    /**
     * A video the user picked in the OS dialog but hasn't committed. Shown as a
     * pending video; only imported into the project on "Save Changes".
     */
    pickedVideoFile?: { fsPath: string; fileName: string; } | null;
    /** Called once the modal has adopted a delivered `pickedVideoFile`. */
    onPickedVideoConsumed?: () => void;
    /** Stream-and-save: a downloaded local copy can be reverted to a pointer to free space. */
    canFreeDiskSpace: boolean;
    onFreeDiskSpace: () => void;
    videoReferenceStatus: "none" | "url" | "local-usable" | "missing" | null;
    /** Size of the referenced video in bytes when known (local bytes or LFS pointer size). */
    videoSizeBytes?: number | null;
}

// Define user-editable fields with proper labels and descriptions
const USER_EDITABLE_FIELDS = {
    videoUrl: {
        label: "Video URL",
        description: "Link to video file for this chapter",
        type: "url" as const,
        hasFilePicker: true,
    },
    textDirection: {
        label: "Text Direction",
        description: "Reading direction for this content",
        type: "select" as const,
        options: [
            { value: "ltr", label: "Left to Right" },
            { value: "rtl", label: "Right to Left" },
        ],
    },
    fontSize: {
        label: "Font Size",
        description: "Text size in pixels",
        type: "number" as const,
        min: 8,
        max: 24,
    },
    corpusMarker: {
        label: "Corpus Marker",
        description: "Identifier for this text corpus",
        type: "text" as const,
    },
} as const;

const NotebookMetadataModal: React.FC<NotebookMetadataModalProps> = ({
    isOpen,
    onClose,
    metadata,
    onSave,
    onPickFile,
    pickedVideoFile,
    onPickedVideoConsumed,
    canFreeDiskSpace,
    onFreeDiskSpace,
    videoReferenceStatus,
    videoSizeBytes,
}) => {
    // All edits happen on a local draft and are only committed on "Save Changes".
    // Closing via X/Cancel discards the draft, so nothing — including video
    // removal — is persisted unless the user explicitly saves.
    const [draft, setDraft] = useState<CustomNotebookMetadata>(metadata);
    const [hasChanges, setHasChanges] = useState(false);
    // Safety gate for removing a video: the user must type/paste the exact file
    // name (local) or URL (remote) before the removal is allowed. `null` means
    // the confirmation panel is closed.
    const [removalConfirmText, setRemovalConfirmText] = useState<string | null>(null);
    // A video the user picked in the OS dialog but hasn't committed. It is only
    // imported into the project (and the videoUrl updated) when the user clicks
    // "Save Changes"; cancelling the modal discards it.
    const [pendingVideoFile, setPendingVideoFile] = useState<{
        fsPath: string;
        fileName: string;
    } | null>(null);

    // Start the draft from the latest saved metadata each time the modal opens.
    useEffect(() => {
        if (isOpen) {
            setDraft(metadata);
            setHasChanges(false);
            setRemovalConfirmText(null);
            setPendingVideoFile(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Adopt a staged pick delivered from the host. Clearing the draft URL keeps
    // any previously typed URL from lingering behind the pending chip, and the
    // one-shot consume callback prevents re-adopting it if the modal reopens.
    useEffect(() => {
        if (!isOpen || !pickedVideoFile) {
            return;
        }
        setPendingVideoFile(pickedVideoFile);
        setDraft((d) => ({ ...d, videoUrl: "" }) as CustomNotebookMetadata);
        setRemovalConfirmText(null);
        setHasChanges(true);
        onPickedVideoConsumed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pickedVideoFile, isOpen]);

    // Picking a file is an immediate host action that updates the saved videoUrl;
    // mirror it into the draft so the field reflects the newly picked file. Any
    // in-progress removal confirmation no longer applies to the new reference.
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setDraft((d) =>
            d.videoUrl === metadata.videoUrl ? d : { ...d, videoUrl: metadata.videoUrl }
        );
        setRemovalConfirmText(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [metadata.videoUrl]);

    const handleFieldChange = (key: string, value: string) => {
        setHasChanges(true);
        setDraft((d) => ({ ...d, [key]: value }) as CustomNotebookMetadata);
    };

    // Step 1 of removal: open the type-to-confirm panel. Nothing is changed yet.
    const handleClearVideo = () => {
        setRemovalConfirmText("");
    };

    const cancelClearVideo = () => {
        setRemovalConfirmText(null);
    };

    // Step 2 of removal (only reachable once the typed text matches): empty the
    // draft field. The actual file deletion + JSON change is still deferred to
    // Save (the host removes the old local file when the saved videoUrl changes).
    const confirmClearVideo = () => {
        setHasChanges(true);
        setDraft((d) => ({ ...d, videoUrl: "" }) as CustomNotebookMetadata);
        setRemovalConfirmText(null);
    };

    const handleSave = () => {
        onSave(draft, pendingVideoFile?.fsPath);
        setHasChanges(false);
        setPendingVideoFile(null);
    };

    const cancelPendingVideo = () => {
        setPendingVideoFile(null);
    };

    const handleClose = () => {
        setDraft(metadata);
        setHasChanges(false);
        setRemovalConfirmText(null);
        setPendingVideoFile(null);
        onClose();
    };

    const renderField = (key: string, config: typeof USER_EDITABLE_FIELDS[keyof typeof USER_EDITABLE_FIELDS]) => {
        const currentValue = draft[key as keyof CustomNotebookMetadata] || "";
        
        return (
            <div key={key} className="space-y-2">
                <div className="flex items-center gap-2">
                    <Label htmlFor={key} className="text-sm font-medium">
                        {config.label}
                    </Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button className="text-muted-foreground hover:text-foreground">
                                    <i className="codicon codicon-info" style={{ fontSize: '12px' }} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-xs">{config.description}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                
                {config.type === "select" && config.options ? (
                    <Select 
                        value={String(currentValue)} 
                        onValueChange={(value) => handleFieldChange(key, value)}
                    >
                        <SelectTrigger id={key}>
                            <SelectValue placeholder={`Select ${config.label.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                            {config.options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : config.type === "url" && config.hasFilePicker ? (
                    (() => {
                        // A staged pick takes precedence: show it as pending until
                        // the user saves (which imports it) or clears it (discard).
                        if (pendingVideoFile) {
                            return (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div
                                            className="flex-1 min-w-0 basis-0 flex items-center gap-2 rounded-md border border-input bg-muted px-3 py-2 text-sm overflow-hidden"
                                            title={pendingVideoFile.fsPath}
                                        >
                                            <i className="codicon codicon-device-camera-video shrink-0 text-muted-foreground" />
                                            <span className="truncate">{pendingVideoFile.fileName}</span>
                                            <Badge variant="secondary" className="ml-auto shrink-0">
                                                Pending
                                            </Badge>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="shrink-0"
                                            onClick={cancelPendingVideo}
                                            title="Discard this pending video"
                                        >
                                            <i className="codicon codicon-close mr-2" />
                                            Clear
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        This video will be added to the project when you save your
                                        changes.
                                    </p>
                                </div>
                            );
                        }

                        const videoValue = String(currentValue);
                        const hasVideo = !!videoValue;
                        // Lock the field (read-only chip + Clear) only while the
                        // draft still points at the SAVED video. While composing a
                        // new URL (draft differs from the saved value) the field
                        // must stay an editable input — otherwise typing the first
                        // character would flip it to the locked view immediately.
                        const reflectsSavedVideo = hasVideo && draft.videoUrl === metadata.videoUrl;
                        const isLocalFile = hasVideo && !/^https?:\/\//i.test(videoValue);
                        // Only flag "missing" when the draft still reflects the saved
                        // reference (not a pending edit the host hasn't evaluated yet).
                        const isMissing =
                            videoReferenceStatus === "missing" && draft.videoUrl === metadata.videoUrl;
                        // Offer "free up space" only while the field reflects the saved
                        // reference (not a pending edit the host hasn't evaluated yet).
                        const showFreeSpace =
                            canFreeDiskSpace && draft.videoUrl === metadata.videoUrl;
                        const fileName = videoValue.split(/[\\/]/).pop() || videoValue;
                        const displayLabel = isLocalFile ? fileName : videoValue;
                        // Only show the size for a local file that still reflects the
                        // saved reference (so the size matches what's actually on disk).
                        const sizeLabel =
                            isLocalFile && draft.videoUrl === metadata.videoUrl
                                ? formatBytes(videoSizeBytes)
                                : "";

                        // The token the user must type/paste to confirm removal:
                        // the file name for a local video, or the full URL for a
                        // remote one. Matching is exact after trimming surrounding
                        // whitespace (so a pasted value with stray spaces still
                        // works) — a deliberate "are you sure" gate.
                        const expectedToken = isLocalFile ? fileName : videoValue;
                        const isConfirmingRemoval = removalConfirmText !== null;
                        const trimmedExpected = expectedToken.trim();
                        const removalMatches =
                            isConfirmingRemoval &&
                            trimmedExpected.length > 0 &&
                            (removalConfirmText ?? "").trim() === trimmedExpected;

                        // When the saved video is set, lock the field. Changing it
                        // requires an explicit Clear first (deferred — the file is
                        // only deleted and the JSON updated on Save). Once cleared,
                        // the field becomes editable for the next URL or picked file.
                        if (reflectsSavedVideo) {
                            return (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div
                                            className={`flex-1 min-w-0 basis-0 flex items-center gap-2 rounded-md border px-3 py-2 text-sm overflow-hidden ${
                                                isMissing
                                                    ? "border-destructive bg-destructive/10"
                                                    : "border-input bg-muted"
                                            }`}
                                            title={videoValue}
                                        >
                                            <i
                                                className={`codicon shrink-0 ${
                                                    isLocalFile ? "codicon-device-camera-video" : "codicon-link"
                                                } text-muted-foreground`}
                                            />
                                            <span className="truncate">{displayLabel}</span>
                                            {sizeLabel && !isMissing && (
                                                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                                                    {sizeLabel}
                                                </span>
                                            )}
                                            {isMissing && (
                                                <Badge variant="destructive" className="ml-auto shrink-0">
                                                    File missing
                                                </Badge>
                                            )}
                                        </div>
                                        {showFreeSpace && !isConfirmingRemoval && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="shrink-0"
                                                onClick={onFreeDiskSpace}
                                                title="Remove the downloaded file to save space. It will stream again on demand."
                                            >
                                                <i className="codicon codicon-cloud-download mr-2" />
                                                Free up space
                                            </Button>
                                        )}
                                        {!isConfirmingRemoval && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="shrink-0"
                                                onClick={handleClearVideo}
                                                title={
                                                    isLocalFile
                                                        ? "Remove video (the local file is deleted when you save)"
                                                        : "Remove video"
                                                }
                                            >
                                                <i className="codicon codicon-trash mr-2" />
                                                Clear
                                            </Button>
                                        )}
                                    </div>

                                    {isConfirmingRemoval && (
                                        <Alert variant="destructive">
                                            <i className="codicon codicon-warning" />
                                            <AlertTitle>Remove this video?</AlertTitle>
                                            <AlertDescription className="space-y-3">
                                                <p>
                                                    {isLocalFile
                                                        ? "This removes the video reference and permanently deletes the local file when you save your changes."
                                                        : "This removes the video URL from this chapter when you save your changes."}
                                                </p>
                                                <div className="space-y-1.5">
                                                    <Label
                                                        htmlFor="video-removal-confirm"
                                                        className="text-xs font-medium text-foreground"
                                                    >
                                                        To confirm, type or paste the{" "}
                                                        {isLocalFile ? "file name" : "URL"} below:
                                                    </Label>
                                                    <code className="block select-all break-all rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
                                                        {expectedToken}
                                                    </code>
                                                    <Input
                                                        id="video-removal-confirm"
                                                        autoFocus
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        value={removalConfirmText ?? ""}
                                                        onChange={(e) =>
                                                            setRemovalConfirmText(e.target.value)
                                                        }
                                                        onKeyDown={(e) => {
                                                            // Escape is handled by the dialog's
                                                            // onEscapeKeyDown (cancels just this
                                                            // panel). Enter confirms when matched.
                                                            if (e.key === "Enter") {
                                                                e.preventDefault();
                                                                if (removalMatches) {
                                                                    confirmClearVideo();
                                                                }
                                                            }
                                                        }}
                                                        placeholder={
                                                            isLocalFile
                                                                ? "Type the file name to confirm"
                                                                : "Type the URL to confirm"
                                                        }
                                                        className="bg-background text-foreground"
                                                    />
                                                    {(removalConfirmText ?? "").length > 0 &&
                                                        !removalMatches && (
                                                            <p className="text-xs text-muted-foreground">
                                                                The text doesn't match yet.
                                                            </p>
                                                        )}
                                                </div>
                                                <div className="flex flex-wrap justify-end gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={cancelClearVideo}
                                                    >
                                                        Cancel
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="destructive"
                                                        disabled={!removalMatches}
                                                        onClick={confirmClearVideo}
                                                    >
                                                        <i className="codicon codicon-trash mr-2" />
                                                        Remove video
                                                    </Button>
                                                </div>
                                            </AlertDescription>
                                        </Alert>
                                    )}
                                </div>
                            );
                        }

                        return (
                            <div className="flex gap-2">
                                <Input
                                    id={key}
                                    type="url"
                                    value={videoValue}
                                    onChange={(e) => handleFieldChange(key, e.target.value)}
                                    placeholder="Enter video URL or use file picker"
                                    className="flex-1 min-w-0"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="shrink-0"
                                    onClick={onPickFile}
                                    title="Pick Video File"
                                >
                                    <i className="codicon codicon-folder-opened" />
                                </Button>
                            </div>
                        );
                    })()
                ) : config.type === "number" ? (
                    <Input
                        id={key}
                        type="number"
                        value={String(currentValue)}
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        min={config.min}
                        max={config.max}
                        placeholder={`Enter ${config.label.toLowerCase()}`}
                    />
                ) : (
                    <Input
                        id={key}
                        type="text"
                        value={String(currentValue)}
                        onChange={(e) => handleFieldChange(key, e.target.value)}
                        placeholder={`Enter ${config.label.toLowerCase()}`}
                    />
                )}
            </div>
        );
    };

    // Get technical/other fields for display in "Other" section
    const otherFields = Object.entries(metadata)
        .filter(([key]) => {
            // Include technical fields that users might want to see but not edit
            const otherFields = [
                'textDirectionSource', 'lineNumbersEnabled', 'lineNumbersEnabledSource',
                'validationMigrationComplete'
            ];
            return otherFields.includes(key);
        })
        .filter(([_, value]) => value !== undefined && value !== null);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent
                className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden"
                onEscapeKeyDown={(e) => {
                    // While the type-to-confirm removal panel is open, Escape should
                    // dismiss only that panel, not the whole modal. (Radix listens
                    // for Escape at the document level, so a synthetic
                    // stopPropagation on the input isn't enough — intercept here.)
                    if (removalConfirmText !== null) {
                        e.preventDefault();
                        cancelClearVideo();
                    }
                }}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <i className="codicon codicon-notebook" />
                        Edit Metadata
                    </DialogTitle>
                </DialogHeader>
                
                <div className="space-y-6">
                    {/* User-Editable Fields */}
                    <div className="space-y-4">
                        {Object.entries(USER_EDITABLE_FIELDS).map(([key, config]) => 
                            renderField(key, config)
                        )}
                    </div>


                    {/* System Info (Read-only) */}
                    <>
                        <Separator />
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-muted-foreground">System Information</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                <div className="min-w-0">
                                    <span className="text-muted-foreground">ID:</span>
                                    <span className="ml-2 font-mono break-all">{metadata.id}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Original Name:</span>
                                    <span className="ml-2">{metadata.originalName}</span>
                                </div>
                                {metadata.sourceCreatedAt && (
                                    <div>
                                        <span className="text-muted-foreground">Source Created:</span>
                                        <span className="ml-2">
                                            {new Date(metadata.sourceCreatedAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                )}
                                {metadata.codexLastModified && (
                                    <div>
                                        <span className="text-muted-foreground">Last Modified:</span>
                                        <span className="ml-2">
                                            {new Date(metadata.codexLastModified).toLocaleDateString()}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                    </>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={!hasChanges}>
                        <i className="codicon codicon-save mr-2" />
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NotebookMetadataModal;
