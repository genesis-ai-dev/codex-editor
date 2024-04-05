from typing import Callable, List
from difflib import SequenceMatcher
import numpy as np
from servers.experiments import hash_check3
def similarity_ratio(text1: str, text2: str) -> float:
    #return 1 - SequenceMatcher(None, text1, text2).ratio()
    return abs(hash_check3.spell_hash(text1) - hash_check3.spell_hash(text2))


def default_scoring_function(codex_results, bible_results):
    codex_lengths = [len(result.split(" ")) for result in codex_results]
    bible_lengths = [len(result.split(" ")) for result in bible_results]
    
    codex_diffs = [abs(codex_lengths[0] - length) for length in codex_lengths]
    bible_diffs = [abs(bible_lengths[0] - length) for length in bible_lengths]
    
    return [codex_diff - bible_diff for codex_diff, bible_diff in zip(codex_diffs, bible_diffs)]

def make_unique_sorted_chars(text: str):
    # Convert the text to a numpy array of characters, sort them, and remove duplicates
    unique_sorted_chars = np.unique(np.array(list(text.lower())))
    # Join the sorted characters back into a string
    return ''.join(unique_sorted_chars)

def character_scoring(codex_results, bible_results):
    codex_chars = [make_unique_sorted_chars(result) for result in codex_results]
    bible_chars = [make_unique_sorted_chars(result) for result in bible_results]

    codex_char_diffs = [similarity_ratio(codex_chars[0], result) for result in codex_chars]
    bible_char_diffs = [similarity_ratio(bible_chars[0], result) for result in bible_chars]

    return [abs(codex_diff - bible_diff) for codex_diff, bible_diff in zip(codex_char_diffs, bible_char_diffs)]


def default_search(query: str, n_samples, codex, bible):
    codex_results = codex.search(query, limit=n_samples)
    assert len(codex_results) > 0, f"No matching verses found in {codex.database_name}"
    bible_results = []
    for codex_result in codex_results:
        bible_reference = codex_result['id'].replace(codex.database_name, bible.database_name).strip()
        bible_query = bible.get_text(bible_reference)
        if len(bible_query) > 0:
            bible_results.append(bible_query[0])
        else:
            codex_results.pop(codex_results.index(codex_result))
    
    # return just the text
    return [result['text'] for result in codex_results], [result['text'] for result in bible_results]


def test_search(query: str, n_samples, codex, bible):
    english_sentences = [
        "The quick yellow fox jumped over the lazy dog", # Truth, the quick brown fox jumps over the lazy dog.
        "I love to eat delicious food and explore new cuisines.",
        "The sun rises in the east and sets in the west.",
        "Life is a journey full of ups and downs.",
        "Laughter is the best medicine for a happy life."
    ]
    
    french_sentences = [
        "Le renard brun rapide saute par-dessus le chien paresseux.",
        "J'adore manger de la nourriture délicieuse et découvrir de nouvelles cuisines.",
        "Le soleil se lève à l'est et se couche à l'ouest.",
        "La vie est un voyage plein de hauts et de bas.",
        "Le rire est le meilleur remède pour une vie heureuse."
    ]
    
    return english_sentences, french_sentences


class LAD:
    def __init__(self, codex, bible, 
                 score_function: Callable = character_scoring,
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
        score = sum(scores)
        return score
    
    def search_and_score_queries(self, queries: List[str]):
        total_scores = []
        for query in queries:
            total_scores.append(self.search_and_score(query=query))
    
        return total_scores


if __name__ == "__main__":
    lad = LAD(None, None, character_scoring, test_search, 5)
    results = lad.search_and_score('The quick brown fox jamp')
    print("result:\n\n ", results, "\n\n")