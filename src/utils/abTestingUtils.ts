import * as vscode from "vscode";

/**
 * Record user's variant selection
 */
export async function recordVariantSelection(
    testId: string,
    cellId: string,
    selectedIndex: number,
    selectionTimeMs: number,
    names?: string[],
    testName?: string
): Promise<void> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;

        const abTestPath = vscode.Uri.joinPath(workspaceFolders[0].uri, "files", "ab-test-results.jsonl");
        // Append a compact selection line separate from creation
        const selectionRecord = {
            testId,
            cellId,
            timestamp: Date.now(),
            selectedIndex,
            selectionTimeMs,
            names
        };
        const newLine = new TextEncoder().encode(JSON.stringify(selectionRecord) + "\n");
        try {
            const existing = await vscode.workspace.fs.readFile(abTestPath);
            const combined = new Uint8Array(existing.length + newLine.length);
            combined.set(existing, 0);
            combined.set(newLine, existing.length);
            await vscode.workspace.fs.writeFile(abTestPath, combined);
        } catch {
            await vscode.workspace.fs.writeFile(abTestPath, newLine);
        }
        console.log(`Recorded variant selection for test ${testId} cell ${cellId}: variant ${selectedIndex}`);

        // Post selection to external analytics if we have variant names
        try {
            if (Array.isArray(names) && typeof selectedIndex === "number" && names[selectedIndex]) {
                const { recordAbEvent, recordAbResult } = await import("./abTestingAnalytics");
                const variantName = names[selectedIndex];

                // Use the test name directly - no pattern matching needed
                if (!testName) {
                    return; // Skip analytics if no test name provided
                }

                // Event: selection counts as a conversion for the chosen variant
                await recordAbEvent({
                    testName: testName,
                    variant: variantName,
                    outcome: true,
                });
                // Result: declare the chosen variant as the winner for this run
                await recordAbResult({
                    category: testName,
                    options: names,
                    winner: selectedIndex,
                });
            }
        } catch (analyticsError) {
            console.warn("[A/B] Failed to post analytics", analyticsError);
        }
    } catch (error) {
        console.error("Failed to record variant selection:", error);
    }
}
