export interface ABTestQueueItem {
    variants: string[];
    cellId: string;
    testId: string;
    testName?: string;
    names?: string[];
    abProbability?: number;
    /** Model identifiers for server-initiated model comparison tests. */
    models?: string[];
}
