import * as vscode from "vscode";
import { safePostMessageToPanel } from "../utils/webviewUtils";

export type ExportStage =
    | "preparing"
    | "processing"
    | "downloading"
    | "writing"
    | "finalizing";

export type ExportMissingReason =
    // Tier 1 — informational (no warning icon)
    | "no-audio-recorded"
    | "no-text-recorded"
    // Tier 2 — soft warning (yellow)
    | "no-audio-selected"
    // The selected take's bytes couldn't be resolved, but the cell still has
    // other usable (non-deleted, non-missing) recordings the user can switch
    // to — recoverable without re-recording, hence a warning rather than error.
    | "selected-audio-missing-alternatives"
    | "audio-file-missing"
    | "pointer-corrupt"
    | "source-not-found"
    // Tier 3 — hard error (red)
    | "download-failed"
    | "transcode-failed"
    | "write-failed"
    | "error";

export type ExportMissingSeverity = "info" | "warn" | "error";

/**
 * Maps a reason to its display severity. Used by the webview to colour the
 * missing-files card and pick its icon.
 */
export function severityForReason(reason: ExportMissingReason): ExportMissingSeverity {
    switch (reason) {
        case "no-audio-recorded":
        case "no-text-recorded":
            return "info";
        case "no-audio-selected":
        case "selected-audio-missing-alternatives":
        case "pointer-corrupt":
        case "source-not-found":
            return "warn";
        // `audio-file-missing` lives here at Tier 3: the user explicitly
        // approved this take and the resolver could not fetch the bytes
        // from anywhere (local file, local pointer, LFS). After PR 2's
        // stale-flag fixes, this state only fires when the audio is
        // genuinely unrecoverable — which warrants the red icon.
        case "audio-file-missing":
        case "download-failed":
        case "transcode-failed":
        case "write-failed":
        case "error":
            return "error";
    }
}

export interface ExportProgressEvent {
    stage: ExportStage;
    message?: string;
    file?: string;
    current?: number;
    total?: number;
    increment?: number;
}

/**
 * Optional pointer to the exact cell a missing-file event came from. When
 * present, the webview renders the entry as a clickable row that deep-links
 * into the codex editor (same UX as the Step 1 audio-stats popover).
 */
export interface ExportMissingFileLocation {
    cellId?: string;
    codexPath?: string;
}

export interface ExportMissingFile {
    file: string;
    reason: ExportMissingReason;
    detail?: string;
    cellId?: string;
    codexPath?: string;
}

export interface ExportSummary {
    exportPath: string;
    filesExported?: number;
    audioCopied?: number;
    audioMissing?: number;
    audioFailed?: number;
    missingFiles?: ExportMissingFile[];
    extraMessages?: string[];
}

export interface ExportProgressReporter {
    report(event: ExportProgressEvent): void;
    fileMissing(
        file: string,
        reason: ExportMissingReason,
        detail?: string,
        location?: ExportMissingFileLocation
    ): void;
    complete(summary: ExportSummary): void;
    error(message: string): void;
    /**
     * Signals that the export was cancelled by the user before it finished.
     * Implementations should treat this as a terminal state distinct from
     * `complete`/`error` (the partial output has already been cleaned up by the
     * time this fires).
     */
    cancelled(summary?: ExportSummary): void;
}

/**
 * Returns a reporter that swallows every event. Used as the default when
 * `exportCodexContent` is called from a context that does not own a webview
 * (tests, future palette commands, etc.).
 */
export function createNoopReporter(): ExportProgressReporter {
    return {
        report: () => undefined,
        fileMissing: () => undefined,
        complete: () => undefined,
        error: () => undefined,
        cancelled: () => undefined,
    };
}

/**
 * Returns a reporter that aggregates `fileMissing` events. Useful when a
 * top-level orchestrator needs to display a single combined summary even if
 * downstream exporters each call `complete` on their own.
 */
export function createAggregatingReporter(target: ExportProgressReporter): {
    reporter: ExportProgressReporter;
    drain(): {
        missingFiles: ExportMissingFile[];
        extraMessages: string[];
        lastExportPath?: string;
        hadError: boolean;
        errorMessages: string[];
    };
} {
    const missingFiles: ExportMissingFile[] = [];
    const extraMessages: string[] = [];
    const errorMessages: string[] = [];
    let lastExportPath: string | undefined;
    let hadError = false;

    return {
        reporter: {
            report(event) {
                target.report(event);
            },
            fileMissing(file, reason, detail, location) {
                missingFiles.push({ file, reason, detail, ...location });
                target.fileMissing(file, reason, detail, location);
            },
            complete(summary) {
                if (summary.exportPath) lastExportPath = summary.exportPath;
                if (summary.missingFiles) missingFiles.push(...summary.missingFiles);
                if (summary.extraMessages) extraMessages.push(...summary.extraMessages);
            },
            error(message) {
                hadError = true;
                errorMessages.push(message);
            },
            cancelled(summary) {
                target.cancelled(summary);
            },
        },
        drain() {
            return {
                missingFiles,
                extraMessages,
                lastExportPath,
                hadError,
                errorMessages,
            };
        },
    };
}

/**
 * Forwards export progress events to the export webview panel via postMessage.
 */
export function createWebviewReporter(
    panel: vscode.WebviewPanel,
    context = "ProjectExport"
): ExportProgressReporter {
    return {
        report(event) {
            safePostMessageToPanel(
                panel,
                { command: "exportProgress", event },
                context
            );
        },
        fileMissing(file, reason, detail, location) {
            safePostMessageToPanel(
                panel,
                {
                    command: "exportFileMissing",
                    file,
                    reason,
                    detail,
                    cellId: location?.cellId,
                    codexPath: location?.codexPath,
                },
                context
            );
        },
        complete(summary) {
            safePostMessageToPanel(
                panel,
                { command: "exportCompleted", summary },
                context
            );
        },
        error(message) {
            safePostMessageToPanel(
                panel,
                { command: "exportError", message },
                context
            );
        },
        cancelled(summary) {
            safePostMessageToPanel(
                panel,
                { command: "exportCancelled", summary },
                context
            );
        },
    };
}
