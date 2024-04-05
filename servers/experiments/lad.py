from typing import Callable, List
from difflib import SequenceMatcher
import numpy as np


def default_search(query: str, n_samples, codex, bible):
    codex_results = codex.search(query_text=query, top_n=n_samples, text_type="target")
    assert len(codex_results) > 0, f"No matching verses found in {codex.database_name}"
    bible_results = []
    for codex_result in codex_results:
        bible_reference = codex_result['ref']
        bible_query = bible.get_text(bible_reference, text_type="source")
        if len(bible_query) > 0:
            bible_results.append(bible_query[0])
        else:
            codex_results.pop(codex_results.index(codex_result))
            print("Missing: ", bible_reference)
    
    # return just the text
    return [result['text'] for result in codex_results], bible_results


def find_differences_v3(text, language_data):
    data = []
    for sentence in language_data:
        data.append( (len(set(text.split(" ") + sentence.split(' ')))/len(text.split(' ') + sentence.split(' '))))
    return np.array(data)/max(data)

class LAD: 
    def __init__(self, codex, bible, 
                 score_function: Callable = find_differences_v3,
                 search_function: Callable = default_search,
                 n_samples: int = 30) -> None:
        
        self.search_function = search_function
        self.score_function = score_function
        self.n_samples = n_samples
        self.bible = bible
        self.codex = codex
        

    def search_and_score(self, query: str):
        codex_results, bible_results = self.search_function(query, self.n_samples,
                                                             self.codex, self.bible)
        codex_score = self.score_function(query, codex_results)
        bible_score = self.score_function(query, bible_results)

        score = abs(sum(codex_score)-sum(bible_score))
        return score
    
    def search_and_score_queries(self, queries: List[str]):
        total_scores = []
        for query in queries:
            total_scores.append(self.search_and_score(query=query))
    
        return total_scores



if __name__ == "__main__":
    lad = LAD(None, None, find_differences_v3, default_search, 5)
    results = lad.search_and_score('The quick brown fox jamp')
    print("result:\n\n ", results, "\n\n")