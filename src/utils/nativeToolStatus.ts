import type { NativeToolKey, NativeToolStatusEntry } from "../../types";
import type { FrontierAPI } from "../../webviews/codex-webviews/src/StartupFlow/types";
import { MetadataManager } from "./metadataManager";
import type { ToolCheckResult } from "./toolsManager";
import { getAudioToolMode, getGitToolMode, getSqliteToolMode } from "./toolPreferences";

const NATIVE_TOOL_ORDER: readonly NativeToolKey[] = ["search", "sync", "audio"];

function normalizeNonNativeTools(value: unknown): NativeToolKey[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const values = new Set(value.filter(
        (tool): tool is NativeToolKey => NATIVE_TOOL_ORDER.includes(tool as NativeToolKey),
    ));
    return NATIVE_TOOL_ORDER.filter((tool) => values.has(tool));
}

function sameToolList(left: NativeToolKey[], right: NativeToolKey[]): boolean {
    return left.length === right.length && left.every((tool, index) => tool === right[index]);
}

export function normalizeNativeToolStatusEntries(value: unknown): NativeToolStatusEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const entriesByUsername = new Map<string, NativeToolStatusEntry>();
    for (const rawEntry of value) {
        if (!rawEntry || typeof rawEntry !== "object") {
            continue;
        }

        const entry = rawEntry as Partial<NativeToolStatusEntry>;
        const username = typeof entry.username === "string" ? entry.username.trim() : "";
        if (!username || typeof entry.timestamp !== "number") {
            continue;
        }

        const normalizedEntry: NativeToolStatusEntry = {
            username,
            timestamp: entry.timestamp,
            nonNative: normalizeNonNativeTools(entry.nonNative),
        };
        const existing = entriesByUsername.get(username);
        if (!existing || normalizedEntry.timestamp >= existing.timestamp) {
            entriesByUsername.set(username, normalizedEntry);
        }
    }

    return Array.from(entriesByUsername.values()).sort((left, right) =>
        left.username.localeCompare(right.username),
    );
}

export function normalizeNativeToolStatusHistory(value: unknown): NativeToolStatusEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((rawEntry): rawEntry is Record<string, unknown> =>
            !!rawEntry && typeof rawEntry === "object",
        )
        .map((rawEntry) => {
            const username = typeof rawEntry.username === "string"
                ? rawEntry.username.trim()
                : "";
            const timestamp = rawEntry.timestamp;
            if (!username || typeof timestamp !== "number") {
                return null;
            }
            return {
                username,
                timestamp,
                nonNative: normalizeNonNativeTools(rawEntry.nonNative),
            };
        })
        .filter((entry): entry is NativeToolStatusEntry => entry !== null)
        .sort((left, right) =>
            left.timestamp - right.timestamp || left.username.localeCompare(right.username),
        );
}

export function mergeNativeToolStatusEntries(...values: unknown[]): NativeToolStatusEntry[] {
    const entriesByUsername = new Map<string, NativeToolStatusEntry>();
    for (const value of values) {
        for (const entry of normalizeNativeToolStatusEntries(value)) {
            const existing = entriesByUsername.get(entry.username);
            if (!existing || entry.timestamp > existing.timestamp) {
                entriesByUsername.set(entry.username, entry);
            }
        }
    }

    return Array.from(entriesByUsername.values()).sort((left, right) =>
        left.username.localeCompare(right.username),
    );
}

export function mergeNativeToolStatusHistory(...values: unknown[]): NativeToolStatusEntry[] {
    const entriesByKey = new Map<string, NativeToolStatusEntry>();
    for (const value of values) {
        for (const entry of normalizeNativeToolStatusHistory(value)) {
            const key = `${entry.username}:${entry.timestamp}`;
            if (!entriesByKey.has(key)) {
                entriesByKey.set(key, entry);
            }
        }
    }

    return Array.from(entriesByKey.values()).sort((left, right) =>
        left.timestamp - right.timestamp || left.username.localeCompare(right.username),
    );
}

function getActiveNonNativeTools(result: ToolCheckResult): NativeToolKey[] {
    const nonNative: NativeToolKey[] = [];

    if (!result.nativeSqliteAvailable || getSqliteToolMode() !== "auto") {
        nonNative.push("search");
    }
    if (!result.nativeGitAvailable || getGitToolMode() !== "auto") {
        nonNative.push("sync");
    }
    // A usable x64 FFmpeg asset on Windows ARM64 is treated as native
    // operation for this project status, even though it is not ARM-native.
    if (!result.ffmpeg || getAudioToolMode() !== "auto") {
        nonNative.push("audio");
    }

    return nonNative;
}

export async function updateNativeToolStatus(
    workspaceUri: import("vscode").Uri,
    result: ToolCheckResult,
    frontierApi: FrontierAPI | undefined,
): Promise<{ success: boolean; changed: boolean; }> {
    const userInfo = await frontierApi?.getUserInfo?.();
    const username = userInfo?.username?.trim();
    if (!username) {
        return { success: true, changed: false };
    }
    const nextEntry: NativeToolStatusEntry = {
        username,
        timestamp: Date.now(),
        nonNative: getActiveNonNativeTools(result),
    };
    let changed = false;

    const updateResult = await MetadataManager.safeUpdateMetadata<Record<string, unknown>>(
        workspaceUri,
        (metadata) => {
            const currentMeta = metadata.meta && typeof metadata.meta === "object"
                ? metadata.meta as Record<string, unknown>
                : {};
            const currentEntries = normalizeNativeToolStatusEntries(currentMeta.nativeToolStatus);
            const currentHistory = normalizeNativeToolStatusHistory(
                currentMeta.nativeToolStatusHistory,
            );
            const currentEntry = currentEntries.find((entry) => entry.username === username);

            if (currentEntry && sameToolList(currentEntry.nonNative, nextEntry.nonNative)) {
                return metadata;
            }

            const nextEntries = [
                ...currentEntries.filter((entry) => entry.username !== username),
                nextEntry,
            ].sort((left, right) => left.username.localeCompare(right.username));
            const nextMeta: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(currentMeta)) {
                if (key === "nativeToolStatus") {
                    continue;
                }
                nextMeta[key] = value;
                if (key === "validationCountAudio") {
                    nextMeta.nativeToolStatus = nextEntries;
                }
            }
            if (!("nativeToolStatus" in nextMeta)) {
                nextMeta.nativeToolStatus = nextEntries;
            }
            nextMeta.nativeToolStatusHistory = [
                ...currentHistory,
                nextEntry,
            ];
            metadata.meta = nextMeta;
            changed = true;
            return metadata;
        },
    );

    return { success: updateResult.success, changed };
}
