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
        case "audio-file-missing":
        case "pointer-corrupt":
        case "source-not-found":
            return "warn";
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

export interface ExportMissingFile {
    file: string;
    reason: ExportMissingReason;
    detail?: string;
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
    fileMissing(file: string, reason: ExportMissingReason, detail?: string): void;
    complete(summary: ExportSummary): void;
    error(message: string): void;
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
            fileMissing(file, reason, detail) {
                missingFiles.push({ file, reason, detail });
                target.fileMissing(file, reason, detail);
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
        fileMissing(file, reason, detail) {
            safePostMessageToPanel(
                panel,
                { command: "exportFileMissing", file, reason, detail },
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
    };
}
