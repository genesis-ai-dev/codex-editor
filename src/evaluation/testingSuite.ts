import * as vscode from "vscode";
import { calculateCHRF } from "./metrics";
import { fetchCompletionConfig } from "../utils/llmUtils";
import { CodexNotebookReader } from "../serializer";
import { llmCompletion } from "../providers/translationSuggestions/llmCompletion";
import { getSQLiteIndexManager } from "../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager";

export interface TestResult {
    cellId: string;
    sourceContent: string;
    referenceTranslation: string;
    generatedTranslation: string;
    chrfScore: number;
    timestamp: string;
}

export interface TestSummary {
    testId: string;
    timestamp: string;
    cellCount: number;
    averageCHRF: number;
    configSnapshot: any;
    results: TestResult[];
}

async function ensureDir(uri: vscode.Uri) {
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        await vscode.workspace.fs.createDirectory(uri);
    }
}

async function writeJson(uri: vscode.Uri, data: unknown) {
    const enc = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, enc.encode(JSON.stringify(data, null, 2)));
}

function mapSourceUriToTargetUri(sourceUriStr: string): vscode.Uri | null {
    try {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) return null;
        const parsed = vscode.Uri.parse(sourceUriStr);
        const fileName = parsed.path.split("/").pop() || "";
        if (!fileName.toLowerCase().endsWith(".source")) return null;
        const targetFile = fileName.replace(/\.source$/i, ".codex");
        return vscode.Uri.joinPath(ws.uri, "files", "target", targetFile);
    } catch {
        return null;
    }
}

async function generateTranslationNonDestructive(cellId: string, targetUri: vscode.Uri): Promise<string> {
    try {
        const completionConfig = await fetchCompletionConfig();
        const notebookReader = new CodexNotebookReader(targetUri);
        const cts = new vscode.CancellationTokenSource();
        const result = await llmCompletion(notebookReader, cellId, completionConfig, cts.token, false);
        const variants = (result as any)?.variants || [];
        return Array.isArray(variants) && variants.length > 0 ? variants[0] : "";
    } catch (error) {
        console.error(`Failed to generate translation for ${cellId}:`, error);
        return "";
    }
}

export async function selectRandomCells(count: number, onlyValidated: boolean): Promise<string[]> {
    try {
        const indexManager = getSQLiteIndexManager();
        if (!indexManager) {
            throw new Error("Index manager not available");
        }

        const results = await indexManager.searchCompleteTranslationPairsWithValidation(
            "", // empty query gets all
            Math.max(count * 5, 100), // get more to shuffle from
            false, // don't return raw content
            onlyValidated
        );

        if (!Array.isArray(results) || results.length === 0) {
            return [];
        }

        // Shuffle and take requested count
        const shuffled = [...results].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count).map((r: any) => r.cellId || r.cell_id).filter(Boolean);
    } catch (error) {
        console.error("Error selecting random cells:", error);
        return [];
    }
}

export async function runAutomatedTest(
    cellIds: string[],
    progressCallback?: (message: string, progress: number) => void
): Promise<TestSummary> {
    const testId = `test-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) throw new Error("No workspace available");

    progressCallback?.("Saving configuration snapshot...", 10);

    // Auto-snapshot config; store snapshot path string
    const configSnapshot = await vscode.commands.executeCommand("codex-testing.snapshotConfig");

    const results: TestResult[] = [];
    const total = cellIds.length;

    for (let i = 0; i < total; i++) {
        const cellId = cellIds[i];
        const progress = 20 + ((i / total) * 70); // 20-90% for processing
        progressCallback?.(`Processing ${cellId} (${i + 1}/${total})...`, progress);

        try {
            // Get translation pair
            const pair: any = await vscode.commands.executeCommand(
                "codex-editor-extension.getTranslationPairFromProject",
                cellId,
                undefined,
                false
            );

            if (!pair?.sourceCell?.uri || !pair?.targetCell?.content) {
                console.warn(`Skipping ${cellId}: incomplete translation pair`);
                continue;
            }

            const sourceUriStr = pair.sourceCell.uri;
            const targetUri = mapSourceUriToTargetUri(sourceUriStr);
            if (!targetUri) {
                console.warn(`Skipping ${cellId}: failed to map to target file`);
                continue;
            }

            // Generate translation non-destructively
            const generatedTranslation = await generateTranslationNonDestructive(cellId, targetUri);
            const referenceTranslation = pair.targetCell.content || "";
            const sourceContent = pair.sourceCell.content || "";

            // Calculate CHRF
            const chrfScore = calculateCHRF(generatedTranslation, referenceTranslation);

            results.push({
                cellId,
                sourceContent,
                referenceTranslation,
                generatedTranslation,
                chrfScore,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`Error processing ${cellId}:`, error);
        }
    }

    progressCallback?.("Calculating summary...", 95);

    const averageCHRF = results.length > 0 ? 
        results.reduce((sum, r) => sum + r.chrfScore, 0) / results.length : 0;

    const summary: TestSummary = {
        testId,
        timestamp,
        cellCount: results.length,
        averageCHRF,
        configSnapshot,
        results
    };

    // Save results
    const baseDir = vscode.Uri.joinPath(ws.uri, ".codex", "automated-tests");
    await ensureDir(baseDir);
    const resultsFile = vscode.Uri.joinPath(baseDir, `${testId}.json`);
    await writeJson(resultsFile, summary);

    progressCallback?.("Test complete!", 100);

    return summary;
}
