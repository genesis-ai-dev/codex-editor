import * as vscode from "vscode";
import { getAuthApi } from "../extension";

async function getAnalyticsBase(): Promise<string | null> {
    try {
        const frontierApi = getAuthApi();
        if (frontierApi) {
            // Use the same endpoint as LLM, just the base URL portion
            const llmEndpoint = await frontierApi.getLlmEndpoint();
            if (llmEndpoint) {
                // Extract base URL (e.g., "https://api.frontierrnd.com/api/v1/llm" -> "https://api.frontierrnd.com")
                const url = new URL(llmEndpoint);
                return `${url.protocol}//${url.host}`;
            }
        }
    } catch (error) {
        console.debug("[ABTestingAnalytics] Could not get endpoint from auth API:", error);
    }
    return null;
}

async function postJson(path: string, payload: any): Promise<void> {
    try {
        const baseUrl = await getAnalyticsBase();
        if (!baseUrl) {
            console.debug("[ABTestingAnalytics] No analytics endpoint available, skipping");
            return;
        }
        await fetch(`${baseUrl}${path}` as any, {
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
    await postJson("/api/v1/analytics/result", body);
}

