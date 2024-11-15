export interface SavedPrompt {
    cellId: string;
    prompt: string;
    generatedText: string;
    lastUpdated: number;
    updateCount: number;
    isPinned: boolean;
}
export interface TargetCell {
    cellId: string;
    targetContent: string;
    id?: string;
    score?: number;
    sourceContent?: string;
}
