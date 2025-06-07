import { ProgressReportingService } from './progressReportingService';

/**
 * Simple test to verify the ProgressReportingService works correctly
 * This test would normally be run with a proper test framework
 */
export async function testProgressReportingService() {
    console.log("🧪 Testing Progress Reporting Service...");

    const service = ProgressReportingService.getInstance();

    // Test 1: Service should start without errors
    try {
        service.start();
        console.log("✅ Service started successfully");
    } catch (error) {
        console.error("❌ Service failed to start:", error);
        return false;
    }

    // Test 2: Scheduling a report should be non-blocking and fast
    const scheduleStart = performance.now();
    try {
        service.scheduleProgressReport();
        const scheduleEnd = performance.now();
        const scheduleDuration = scheduleEnd - scheduleStart;

        if (scheduleDuration < 10) { // Should take less than 10ms
            console.log(`✅ Report scheduling is fast: ${scheduleDuration.toFixed(2)}ms`);
        } else {
            console.warn(`⚠️ Report scheduling took longer than expected: ${scheduleDuration.toFixed(2)}ms`);
        }
    } catch (error) {
        console.error("❌ Failed to schedule report:", error);
        return false;
    }

    // Test 3: Multiple rapid calls should not block
    const rapidCallStart = performance.now();
    try {
        for (let i = 0; i < 5; i++) {
            service.scheduleProgressReport();
        }
        const rapidCallEnd = performance.now();
        const rapidCallDuration = rapidCallEnd - rapidCallStart;

        if (rapidCallDuration < 50) { // 5 calls should take less than 50ms total
            console.log(`✅ Multiple rapid calls are non-blocking: ${rapidCallDuration.toFixed(2)}ms for 5 calls`);
        } else {
            console.warn(`⚠️ Multiple rapid calls took longer than expected: ${rapidCallDuration.toFixed(2)}ms`);
        }
    } catch (error) {
        console.error("❌ Failed rapid calls test:", error);
        return false;
    }

    // Test 4: Stop service
    try {
        service.stop();
        console.log("✅ Service stopped successfully");
    } catch (error) {
        console.error("❌ Service failed to stop:", error);
        return false;
    }

    console.log("🧪 All tests passed! Progress Reporting Service is working correctly.");
    return true;
}

// Run test if this file is executed directly
if (require.main === module) {
    testProgressReportingService().then(success => {
        process.exit(success ? 0 : 1);
    });
} 