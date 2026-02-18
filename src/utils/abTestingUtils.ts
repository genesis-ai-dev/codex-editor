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
