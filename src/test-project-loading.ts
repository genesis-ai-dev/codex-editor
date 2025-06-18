import { findAllCodexProjects } from "./projectManager/utils/projectUtils";

/**
 * Test script to analyze project loading performance
 * Run this from VS Code terminal or add it as a command
 */
export async function testProjectLoadingPerformance() {
    console.log("=== Starting Project Loading Performance Test ===");

    try {
        // Run the test multiple times to get average performance
        const ITERATIONS = 3;
        const times: number[] = [];

        for (let i = 0; i < ITERATIONS; i++) {
            console.log(`\n--- Iteration ${i + 1}/${ITERATIONS} ---`);
            const startTime = performance.now();

            const projects = await findAllCodexProjects();

            const endTime = performance.now();
            const totalTime = endTime - startTime;
            times.push(totalTime);

            console.log(`Iteration ${i + 1} completed: ${projects.length} projects found in ${totalTime.toFixed(2)}ms`);
        }

        // Calculate statistics
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        console.log("\n=== Performance Summary ===");
        console.log(`Average time: ${avgTime.toFixed(2)}ms`);
        console.log(`Minimum time: ${minTime.toFixed(2)}ms`);
        console.log(`Maximum time: ${maxTime.toFixed(2)}ms`);
        console.log(`Performance variance: ${(maxTime - minTime).toFixed(2)}ms`);

        if (avgTime > 1000) {
            console.log("⚠️  WARNING: Project loading is taking over 1 second on average");
        } else if (avgTime > 500) {
            console.log("⚠️  NOTICE: Project loading is taking over 500ms on average");
        } else {
            console.log("✅ Project loading performance is acceptable");
        }

    } catch (error) {
        console.error("Error during performance test:", error);
    }

    console.log("=== Performance Test Complete ===");
}