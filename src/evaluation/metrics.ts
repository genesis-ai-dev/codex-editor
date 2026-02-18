export function stripHtml(input: string): string {
    return input
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]*>/g, '')
        .trim();
}

function ngrams(text: string, n: number): string[] {
    const grams: string[] = [];
    if (text.length === 0) return grams;
    for (let i = 0; i <= Math.max(0, text.length - n); i++) {
        grams.push(text.slice(i, i + n));
    }
    return grams.length === 0 ? [text] : grams;
}

export function calculateCHRF(candidate: string, reference: string, maxOrder: number = 6, beta: number = 2): number {
    const cand = stripHtml(candidate);
    const ref = stripHtml(reference);
    if (!cand || !ref) return 0;

    let sumPrecision = 0;
    let sumRecall = 0;
    let orders = 0;

    for (let n = 1; n <= maxOrder; n++) {
        const cgrams = ngrams(cand, n);
        const rgrams = ngrams(ref, n);

        const rCounts = new Map<string, number>();
        for (const g of rgrams) rCounts.set(g, (rCounts.get(g) || 0) + 1);

        let overlap = 0;
        const cCounts = new Map<string, number>();
        for (const g of cgrams) cCounts.set(g, (cCounts.get(g) || 0) + 1);
        for (const [g, cnt] of cCounts) {
            overlap += Math.min(cnt, rCounts.get(g) || 0);
        }

        const precision = overlap / cgrams.length;
        const recall = overlap / rgrams.length;
        sumPrecision += precision;
        sumRecall += recall;
        orders++;
    }

    const avgP = sumPrecision / orders;
    const avgR = sumRecall / orders;
    if (avgP === 0 && avgR === 0) return 0;
    const beta2 = beta * beta;
    const fScore = (1 + beta2) * (avgP * avgR) / (beta2 * avgP + avgR);
    return fScore;
}

export type BatchCHRFResult = {
    cellId: string;
    chrf: number;
    generated: string;
    reference: string;
};


