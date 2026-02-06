/**
 * Record user's variant selection to cloud analytics
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
        console.log(`Recording variant selection for test ${testId} cell ${cellId}: variant ${selectedIndex}`);

        // Post selection to cloud analytics if we have variant names
        if (Array.isArray(names) && typeof selectedIndex === "number" && names[selectedIndex] && testName) {
            const { recordAbResult } = await import("./abTestingAnalytics");

            // Send result to cloud analytics
            await recordAbResult({
                category: testName,
                options: names,
                winner: selectedIndex,
            });

            console.log(`A/B test result sent to cloud: ${testName} - winner: ${names[selectedIndex]}`);
        }
    } catch (error) {
        console.warn("[A/B] Failed to record variant selection:", error);
    }
}

/**
 * Record attention check result to cloud analytics
 * Tracks whether translators are catching decoy translations (wrong verse content)
 */
export async function recordAttentionCheckResult(args: {
    testId: string;
    cellId: string;
    passed: boolean;
    selectionTimeMs: number;
    correctIndex?: number;
    decoyCellId?: string;
}): Promise<void> {
    try {
        console.log(`Recording attention check: cell ${args.cellId}, passed=${args.passed}, decoy=${args.decoyCellId}`);

        const { recordAbResult } = await import("./abTestingAnalytics");

        // Record as an A/B test result with "passed" or "failed" as the options
        await recordAbResult({
            category: "Attention Check",
            options: ["passed", "failed"],
            winner: args.passed ? 0 : 1,
        });

        console.log(`Attention check result sent to cloud: ${args.passed ? "passed" : "failed"}`);
    } catch (error) {
        console.warn("[Attention Check] Failed to record result:", error);
    }
}
