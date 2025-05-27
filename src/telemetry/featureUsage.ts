const usageData: Record<string, { count: number, totalTime: number }> = {};

export function trackFeatureUsage(feature: string, implementation: string, timeMs: number) {
    const key = `${feature}:${implementation}`;
    if (!usageData[key]) {
        usageData[key] = { count: 0, totalTime: 0 };
    }
    
    usageData[key].count += 1;
    usageData[key].totalTime += timeMs;
}

export function getUsageReport(): Record<string, { count: number, avgTimeMs: number }> {
    const report: Record<string, { count: number, avgTimeMs: number }> = {};
    
    Object.entries(usageData).forEach(([key, data]) => {
        report[key] = {
            count: data.count,
            avgTimeMs: data.totalTime / data.count
        };
    });
    
    return report;
}

export function clearUsageData(): void {
    Object.keys(usageData).forEach(key => {
        delete usageData[key];
    });
}

export function logUsageReport(): void {
    const report = getUsageReport();
    console.log('Feature Usage Report:');
    console.table(report);
} 