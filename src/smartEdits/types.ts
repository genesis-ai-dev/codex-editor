export interface SavedPrompt {
    cellId: string;
    prompt: string;
    lastUpdated: number;
    updateCount: number;
}
export interface TargetCell {
    cellId: string;
    targetContent: string;
    id?: string;
    score?: number;
    sourceContent?: string;
}
