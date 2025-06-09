import * as fs from "fs";
import * as path from "path";

class MarkovChain {
    private forwardChain: Map<string, Map<string, number>>;
    private backwardChain: Map<string, Map<string, number>>;

    constructor() {
        this.forwardChain = new Map();
        this.backwardChain = new Map();
    }

    addPair(word1: string, word2: string, direction: "forward" | "backward") {
        const chain = direction === "forward" ? this.forwardChain : this.backwardChain;
        if (!chain.has(word1)) {
            chain.set(word1, new Map());
        }
        const nextWords = chain.get(word1)!;
        nextWords.set(word2, (nextWords.get(word2) || 0) + 1);
    }

    getNextWords(word: string, direction: "forward" | "backward"): string[] {
        const chain = direction === "forward" ? this.forwardChain : this.backwardChain;
        const nextWords = chain.get(word);
        if (!nextWords) return [];
        return Array.from(nextWords.entries())
            .sort((a, b) => b[1] - a[1])
            .map((entry) => entry[0]);
    }

    getSimilarWords(word: string): string[] {
        const leftNeighbors = this.getNextWords(word, "backward");
        const rightNeighbors = this.getNextWords(word, "forward");

        const similarWords = new Map<string, number>();

        // Increase the number of neighbors considered
        for (const left of leftNeighbors.slice(0, 5)) {
            for (const right of rightNeighbors.slice(0, 5)) {
                const middleWords = this.getNextWords(left, "forward").filter((w) =>
                    this.getNextWords(w, "forward").includes(right)
                );
                middleWords.forEach((w) => {
                    similarWords.set(w, (similarWords.get(w) || 0) + 1);
                });
            }
        }

        // Add words with similar context
        this.getNextWords(word, "forward").forEach((w) => {
            similarWords.set(w, (similarWords.get(w) || 0) + 2);
        });
        this.getNextWords(word, "backward").forEach((w) => {
            similarWords.set(w, (similarWords.get(w) || 0) + 2);
        });

        // Sort by frequency and similarity score
        const result = Array.from(similarWords.entries())
            .sort((a, b) => b[1] - a[1])
            .map((entry) => entry[0])
            .filter((w) => w !== word);

        return result.slice(0, 10);
    }
}
