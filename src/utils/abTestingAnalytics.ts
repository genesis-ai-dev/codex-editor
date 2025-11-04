import * as vscode from "vscode";

const ANALYTICS_BASE = "https://zero.codexeditor.app";

async function postJson(path: string, payload: any): Promise<void> {
    try {
        await fetch(`${ANALYTICS_BASE}${path}` as any, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        } as any);
    } catch (err) {
        console.warn(`[ABTestingAnalytics] POST ${path} failed`, err);
    }
}

function getOptionalContext() {
    try {
        const pm = vscode.workspace.getConfiguration("codex-project-manager");
        const userEmail = pm.get<string>("userEmail") || undefined;
        const userName = pm.get<string>("userName") || undefined;
        const projectName = pm.get<string>("projectName") || undefined;
        return { userId: userEmail || userName, projectId: projectName };
    } catch {
        return {} as { userId?: string; projectId?: string };
    }
}

export async function recordAbResult(args: {
    category: string;
    options: string[];
    winner: number; // 0-based
    userId?: string | number;
    projectId?: string | number;
}): Promise<void> {
    const extras = getOptionalContext();
    const body: any = {
        category: args.category,
        options: args.options,
        winner: args.winner,
    };
    if (args.userId ?? extras.userId) body.user_id = args.userId ?? extras.userId;
    if (args.projectId ?? extras.projectId) body.project_id = args.projectId ?? extras.projectId;
    await postJson("/analytics/result", body);
}

