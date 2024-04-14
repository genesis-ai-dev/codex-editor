from typing import Callable, List
from difflib import SequenceMatcher
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

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

def ref_search(query: str, n_samples, codex, bible):
    codex_results = codex.search(query_text=query, top_n=n_samples, text_type="target")
    assert len(codex_results) > 0, f"No matching verses found in {codex.database_name}"
    codex_results = [result['ref'] for result in codex_results]
    bible_results = bible.search(query_text=bible.get_text(codex_results[0]), top_n = 300, text_type="source")
    bible_results = [result['ref'] for result in bible_results if result['ref'] in codex.target_references]
    source = "".join(bible_results[:n_samples])
    target = "".join(codex_results[:n_samples])

    # return just the text
    return source, target

def score_ref(source, target):
    score = SequenceMatcher(None, source, target).ratio() * 100
    return score

def find_differences_v3(text, language_data):
    data = []
    for sentence in language_data:
        similarity_score = (SequenceMatcher(None, text, sentence).ratio() ** 2) * 100
        data.append(similarity_score / len(sentence) if len(sentence) > 0 else 0)
    if not data:
        return 0
    max_data_value = max(data)
    if max_data_value == 0:
        return 0
    return np.array(data)

def find_differences_v4(text, language_data):
    score = [SequenceMatcher(None, text, " ".join(language_data)).ratio()]
    
    return score

class LAD: 
    def __init__(self, codex, bible, 
                 score_function: Callable = score_ref,
                 search_function: Callable = ref_search,
                 n_samples: int = 30) -> None:
        
        self.search_function = search_function
        self.score_function = score_function
        self.n_samples = n_samples
        self.bible = bible
        self.codex = codex
        

    def search_and_score(self, query: str):
        codex_results, bible_results = self.search_function(query, self.n_samples,
                                                             self.codex, self.bible)
        # codex_score = self.score_function(query, codex_results)
        # bible_score = self.score_function(query, bible_results)

        # similarity = np.mean(codex_score - bible_score) ** 2
        similarity = self.score_function(codex_results, bible_results)
        return similarity
    
    def search_and_score_queries(self, queries: List[str]):
        total_scores = []
        for query in queries:
            total_scores.append(self.search_and_score(query=query))
    
        return total_scores



if __name__ == "__main__":
    lad = LAD(None, None, find_differences_v3, default_search, 5)
    results = lad.search_and_score('The quick brown fox jamp')
    print("result:\n\n ", results, "\n\n")