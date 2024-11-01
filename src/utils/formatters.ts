export function formatFileSize(bytes: number | undefined | null): string {
    if (bytes === undefined || bytes === null) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Math.abs(bytes); // Handle negative numbers gracefully
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}
