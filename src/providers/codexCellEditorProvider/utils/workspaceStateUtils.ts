import * as vscode from "vscode";

/**
 * Gets the cached chapter for a given URI from workspace state
 * @param workspaceState The workspace state memento
 * @param uri The document URI
 * @returns The cached chapter number (defaults to 1)
 */
export function getCachedChapter(workspaceState: vscode.Memento, uri: string): number {
    const key = `chapter-cache-${uri}`;
    return workspaceState.get(key, 1); // Default to chapter 1
}

/**
 * Updates the cached chapter for a given URI in workspace state
 * @param workspaceState The workspace state memento
 * @param uri The document URI
 * @param chapter The chapter number to cache
 */
export async function updateCachedChapter(
    workspaceState: vscode.Memento,
    uri: string,
    chapter: number
): Promise<void> {
    const key = `chapter-cache-${uri}`;
    await workspaceState.update(key, chapter);
}

/**
 * Gets the cached subsection for a given URI from workspace state
 * @param workspaceState The workspace state memento
 * @param uri The document URI
 * @returns The cached subsection index (defaults to 0)
 */
export function getCachedSubsection(workspaceState: vscode.Memento, uri: string): number {
    const key = `subsection-cache-${uri}`;
    return workspaceState.get(key, 0); // Default to subsection 0
}

/**
 * Updates the cached subsection for a given URI in workspace state
 * @param workspaceState The workspace state memento
 * @param uri The document URI
 * @param subsectionIndex The subsection index to cache
 */
export async function updateCachedSubsection(
    workspaceState: vscode.Memento,
    uri: string,
    subsectionIndex: number
): Promise<void> {
    const key = `subsection-cache-${uri}`;
    await workspaceState.update(key, subsectionIndex);
}

/**
 * Gets the preferred editor tab from workspace state
 * @param workspaceState The workspace state memento
 * @returns The preferred tab (defaults to "source")
 */
export function getPreferredEditorTab(
    workspaceState: vscode.Memento
): "source" | "backtranslation" | "footnotes" | "timestamps" | "audio" {
    const key = `codex-editor-preferred-tab`;
    return workspaceState.get(
        key,
        "source"
    ) as "source" | "backtranslation" | "footnotes" | "timestamps" | "audio";
}

/**
 * Updates the preferred editor tab in workspace state
 * @param workspaceState The workspace state memento
 * @param tab The tab to set as preferred
 */
export async function updatePreferredEditorTab(
    workspaceState: vscode.Memento,
    tab: "source" | "backtranslation" | "footnotes" | "timestamps" | "audio"
): Promise<void> {
    const key = `codex-editor-preferred-tab`;
    await workspaceState.update(key, tab);
}
