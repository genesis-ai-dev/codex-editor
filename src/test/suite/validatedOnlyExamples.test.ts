// @ts-nocheck
import * as assert from "assert";
import * as vscode from "vscode";
import { fetchFewShotExamples } from "../../providers/translationSuggestions/shared";
import { getTranslationPairsFromSourceCellQuery } from "../../activationHelpers/contextAware/contentIndexes/indexes/search";

suite("Validated-only examples behavior", () => {
    test("getTranslationPairsFromSourceCellQuery forwards onlyValidated and maps results", async () => {
        const validatedCellId = "GEN 1:1";
        const unvalidatedCellId = "GEN 1:2";

        let capturedOnlyValidated: boolean | null = null;
        const mockIndex: any = {
            searchCompleteTranslationPairsWithValidation: async (_q: string, _k: number, _raw: boolean, onlyValidated: boolean) => {
                capturedOnlyValidated = onlyValidated;
                // Simulate DB already applied validation filter; return both to ensure mapping doesn't filter
                return [
                    { cell_id: validatedCellId, sourceContent: "s1", targetContent: "t1" },
                    { cell_id: unvalidatedCellId, sourceContent: "s2", targetContent: "t2" },
                ];
            },
            getTranslationPair: async (cellId: string) => ({ cellId, sourceContent: "s", targetContent: "t" }),
        };

        const pairs = await getTranslationPairsFromSourceCellQuery(mockIndex, "beginning", 10, true);
        assert.strictEqual(capturedOnlyValidated, true, "Should pass onlyValidated=true to SQLite search");
        const ids = pairs.map((p) => p.cellId);
        assert.ok(ids.includes(validatedCellId));
        assert.ok(ids.includes(unvalidatedCellId));
    });

    test("fetchFewShotExamples requests only validated via command and returns only validated", async () => {
        const validatedCellId = "GEN 1:1";
        let capturedOnlyValidated: boolean | null = null;

        const originalExecute = vscode.commands.executeCommand;
        // stub command to capture onlyValidated and return only validated item
        (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
            if (command === "codex-editor-extension.getTranslationPairsFromSourceCellQuery") {
                const [_query, _k, onlyValidated] = args as [string, number, boolean];
                capturedOnlyValidated = onlyValidated;
                return [
                    {
                        cellId: validatedCellId,
                        sourceCell: { cellId: validatedCellId, content: "s1" },
                        targetCell: { cellId: validatedCellId, content: "t1" },
                    },
                ];
            }
            return originalExecute.apply(vscode.commands, [command, ...args]);
        };

        const examples = await fetchFewShotExamples("In the beginning God created the heavens and the earth.", validatedCellId, 5, true);

        // restore
        (vscode.commands as any).executeCommand = originalExecute;

        assert.strictEqual(capturedOnlyValidated, true, "Few-shot should request only validated examples");
        const ids = examples.map((e) => e.cellId);
        assert.deepStrictEqual(ids, [validatedCellId], "Few-shot should contain only validated examples");
    });
});

