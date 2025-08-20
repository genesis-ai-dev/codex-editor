/**
 * Context-Branching Search Algorithm
 *
 * Simple branching search that repeatedly selects the best-matching verse
 * (by FTS score with a coverage boost), removes the longest covered
 * contiguous substring from the query branch, and continues until enough
 * results are found or branches are exhausted.
 */

import { TranslationPair } from "../../../../../types";
import { BaseSearchAlgorithm, SearchOptions } from "./base";

export class ContextBranchingSearchAlgorithm extends BaseSearchAlgorithm {

	getName(): string {
		return "sbs"; // Smart Branched Search
	}

	getDescription(): string {
		return "Smart Branched Search (SBS): branching search with coverage-boosted scoring over FTS candidates.";
	}

	async search(query: string, options: Partial<SearchOptions> = {}): Promise<TranslationPair[]> {
		const searchOptions = this.validateOptions(options);
		const originalQuery = this.cleanQuery(query);
		if (!originalQuery) return [];

		const limit = Math.max(1, searchOptions.limit || 5);
		const coverageWeight = 0.5;
		const candidatesPerBranch = Math.max(limit * 30, 150);
		const maxRestarts = 2;
		const maxBranches = 12;

		const results: TranslationPair[] = [];
		let queryBranches: string[] = [originalQuery];
		const usedCellIds = new Set<string>();
		let restartCount = 0;

		while (results.length < limit && restartCount <= maxRestarts) {
			if (queryBranches.length === 0) {
				restartCount += 1;
				if (restartCount > maxRestarts) break;
				queryBranches = [originalQuery];
				continue;
			}

			let bestScore = -Infinity;
			let bestPair: TranslationPair | null = null;
			let bestBranchIndex = -1;
			let bestBranchQuery = "";
			let bestSourceText = "";

			for (let branchIdx = 0; branchIdx < queryBranches.length; branchIdx++) {
				const branchQuery = queryBranches[branchIdx];
				if (!branchQuery.trim()) continue;

				// Fetch FTS candidates for this branch
				const sqliteResults = await this.indexManager.searchCompleteTranslationPairsWithValidation(
					branchQuery,
					candidatesPerBranch,
					/* returnRawContent */ false,
					searchOptions.onlyValidated
				);

				const branchQueryTokens = this.tokenizeText(branchQuery);
				const branchQueryTokenSet = new Set(branchQueryTokens);

				for (const r of sqliteResults) {
					const cellId: string = r.cell_id || r.cellId;
					if (!cellId || usedCellIds.has(cellId)) continue;

					const sourceContent: string = r.source_content || r.sourceContent || "";
					const targetContent: string = r.target_content || r.targetContent || "";
					if (!sourceContent?.trim() || !targetContent?.trim()) continue;

					const coverage = this.computeCoverage(branchQueryTokenSet, sourceContent);
					const baseScore = typeof r.score === "number" ? r.score : 0;
					const score = baseScore * (1 + coverageWeight * coverage);

					if (score > bestScore) {
						bestScore = score;
						bestBranchIndex = branchIdx;
						bestBranchQuery = branchQuery;
						bestSourceText = sourceContent;
						bestPair = {
							cellId,
							sourceCell: { cellId, content: sourceContent, uri: r.uri || "", line: r.line || 0 },
							targetCell: { cellId, content: targetContent, uri: r.uri || "", line: r.line || 0 },
						};
					}
				}
			}

			if (!bestPair) break;

			results.push(bestPair);
			usedCellIds.add(bestPair.cellId);

			// Update branches: remove the longest covered substring from the chosen branch
			const covered = this.findLongestCoveredSubstring(bestBranchQuery, bestSourceText);
			if (bestBranchIndex >= 0) {
				queryBranches.splice(bestBranchIndex, 1);
			}
			if (covered) {
				const newBranches = this.removeSubstringAndSplit(bestBranchQuery, covered);
				for (const nb of newBranches) {
					if (nb && nb !== bestBranchQuery) queryBranches.push(nb);
					if (queryBranches.length >= maxBranches) break;
				}
			}
		}

		return results.slice(0, limit);
	}

	private computeCoverage(queryTokenSet: Set<string>, verseText: string): number {
		const verseTokens = new Set(this.tokenizeText(verseText));
		if (queryTokenSet.size === 0) return 0;
		let covered = 0;
		for (const t of queryTokenSet) if (verseTokens.has(t)) covered += 1;
		return covered / queryTokenSet.size;
	}

	private findLongestCoveredSubstring(queryText: string, verseText: string): string {
		const queryWords = this.tokenizeText(queryText);
		const verseWords = new Set(this.tokenizeText(verseText));
		let longest = "";
		for (let i = 0; i < queryWords.length; i++) {
			for (let j = i + 1; j <= queryWords.length; j++) {
				const slice = queryWords.slice(i, j);
				if (slice.every(w => verseWords.has(w))) {
					const substring = slice.join(" ");
					if (substring.length > longest.length) longest = substring;
				}
			}
		}
		return longest;
	}

	private removeSubstringAndSplit(queryText: string, coveredSubstring: string): string[] {
		if (!coveredSubstring) return [];
		const q = this.tokenizeText(queryText).join(" ");
		const c = this.tokenizeText(coveredSubstring).join(" ");
		const remaining = (" " + q + " ").replace(` ${c} `, " | ").trim();
		return remaining
			.split("|")
			.map(s => s.trim())
			.filter(s => s.length > 0);
	}

	private tokenizeText(text: string): string[] {
		return (text || "")
			.toLowerCase()
			.replace(/<[^>]*?>/g, " ")
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter(Boolean);
	}
}


