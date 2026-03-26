import * as path from "path";

/**
 * Absolute path to the codex-editor repository root.
 * The webpack test bundle defines `process.env.CODEX_EDITOR_REPO_ROOT`; falls back for direct/ts-node runs.
 */
export function getCodexEditorRepoRoot(): string {
    const fromEnv = process.env.CODEX_EDITOR_REPO_ROOT;
    if (typeof fromEnv === "string" && fromEnv.length > 0) {
        return fromEnv;
    }
    return path.resolve(__dirname, "..", "..", "..");
}
