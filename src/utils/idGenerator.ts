export function generateUniqueId(baseName: string): string {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
    return `${baseName}-${timestamp}`;
}