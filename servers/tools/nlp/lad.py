from typing import Callable, List
import numpy as np


def default_scoring_function(codex_results, bible_results):
    codex_lengths = [len(result.split(" ")) for result in codex_results]
    bible_lengths = [len(result.split(" ")) for result in bible_results]
    
    codex_diffs = [abs(codex_lengths[0] - length) for length in codex_lengths]
    bible_diffs = [abs(bible_lengths[0] - length) for length in bible_lengths]
    
    return [codex_diff - bible_diff for codex_diff, bible_diff in zip(codex_diffs, bible_diffs)]


def default_search(query: str, n_samples, codex, bible):
    codex_results = codex.search(query=query, limit=n_samples)
    assert len(codex_results) > 0, f"No matching verses found in {codex.database_name}"
    
    bible_results = []
    for codex_result in codex_results:
        bible_reference = codex_result['id'].replace(codex.database_name, bible.database_name).strip()
        bible_query = bible.get_text(bible_reference)
        if len(bible_query) > 0:
            bible_results.append(bible_query[0])
    
    # return just the text
    return [result['text'] for result in codex_results], [result['text'] for result in bible_results]


class LAD:
    def __init__(self, codex, bible, 
                 score_function: Callable = default_scoring_function,
                 search_function: Callable = default_search,
                 n_samples: int = 5) -> None:
        
        self.search_function = search_function
        self.score_function = score_function
        self.n_samples = n_samples
        self.bible = bible
        self.codex = codex
        

    def search_and_score(self, query: str):
        codex_results, bible_results = self.search_function(query, self.n_samples,
                                                             self.codex, self.bible)
        scores = self.score_function(codex_results, bible_results)
        return scores
    
    def search_and_score_queries(self, queries: List[str]):
        total_scores = []
        for query in queries:
            total_scores.append(self.search_and_score(query=query))
    
        return total_scores