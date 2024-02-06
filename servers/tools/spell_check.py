"""
Spell checking
"""
import json
import os
from typing import List, Dict
import uuid
import expirements.hash_check as hash_check
import tools.edit_distance as edit_distance
# from codex_types.types import Dictionary as DictionaryType
# from codex_types.types import DictionaryEntry
import re
import string


translator = str.maketrans('', '', string.punctuation)

USE_IMAGE_HASH = False


def criteria(dictionary_word: Dict, word: str) -> float:
    """
    Calculates the criteria for spell checking by comparing a word against a dictionary entry.

    If USE_IMAGE_HASH is True, it uses image hash values to calculate the difference between the word and the dictionary entry.
    Otherwise, it uses edit distance to determine the similarity between the word and the dictionary headWord.

    Parameters:
    dictionary_word (Dict): A dictionary entry with keys like 'hash' and 'headWord'.
    word (str): The word to compare against the dictionary entry.

    Returns:
    float: The difference between the word and the dictionary entry as a float. A lower value indicates a closer match.
    """
    if USE_IMAGE_HASH:
        hash1 = hash_check.imagehash.hex_to_hash(dictionary_word['hash'])
        hash2 = hash_check.spell_hash(word)
        return hash1 - hash2
    else:
        return edit_distance.distance(dictionary_word["headWord"], word)
    

def remove_punctuation(text: str) -> str:
    """
    removes punctuation
    """
    return text.translate(translator).strip()


class Dictionary():
    def __init__(self, project_path) -> None:
        self.path = project_path + '/project.dictionary' # TODO: #4 Use all .dictionary files in drafts directory
        self.dictionary = self.load_dictionary()  # load the .dictionary (json file)
    
    def load_dictionary(self) -> Dict:
        """
        loads the dictionary
        """
        try:
            with open(self.path, 'r') as file:
                data = json.load(file)
                return data
        except FileNotFoundError:
            # Create the directory if it does not exist
            os.makedirs(os.path.dirname(self.path), exist_ok=True)

            # Create the dictionary and write it to the file
            new_dict = {"entries": []}
            with open(self.path, 'w') as file:
                json.dump(new_dict, file)
            return new_dict

    def save_dictionary(self) -> None:
        with open(self.path, 'w') as file:
            json.dump(self.dictionary, file, indent=2)

    def define(self, word: str) -> None:
        word = remove_punctuation(word)
        
        # Add a word if it does not already exist
        if not any(entry['headWord'] == word for entry in self.dictionary['entries']):
            new_entry = {
                'headWord': word, 
                'id': str(uuid.uuid4()),
                'hash': str(hash_check.spell_hash(word)),
                'definition': '',
                'translationEquivalents': [],
                'links': [],
                'linkedEntries': [],
                'metadata': {'extra': {}},
                'notes': [],
                'extra': {}
            }
            
            self.dictionary['entries'].append(new_entry)
            self.save_dictionary()

    def remove(self, word: str) -> None:
        word = remove_punctuation(word)
        # Remove a word
        self.dictionary['entries'] = [entry for entry in self.dictionary['entries'] if entry['headWord'] != word]
        self.save_dictionary()

    

class SpellCheck:
    def __init__(self, dictionary: Dictionary, relative_checking=False):
        self.dictionary = dictionary
        self.relative_checking = relative_checking
    
    def is_correction_needed(self, word: str) -> bool:
        if word.upper() == word:
            return False
        if re.search(r"\d+:\d+", word):
            return False
        word = word.lower()
        word = remove_punctuation(word)
        return not any(
            entry['headWord'].lower() == word for entry in self.dictionary.dictionary['entries']
        )

    def check(self, word: str) -> List[str]:
        word = remove_punctuation(word).lower()

        if not self.is_correction_needed(word):
            return [word]  # No correction needed, return the original word

        entries = self.dictionary.dictionary['entries']
        possibilities = [
            (entry['headWord'], criteria(entry, word))
            for entry in entries
        ]

        # Adjust the threshold based on word length
        # possibilities = [
        #     (word, edit_distance) for word, edit_distance in possibilities
        #     if edit_distance <= threshold_multiplier * len(word)
        # ]

        if not possibilities:
            return [sorted(entries, key=lambda x: x['headWord'])[0]['headWord']]  # Return the top result if no other suggestions

        sorted_possibilities = sorted(possibilities, key=lambda x: x[1])
        suggestions = [word for word, _ in sorted_possibilities]
        return suggestions[:5]
    
    def complete(self, word: str) -> List[str]:
        word = remove_punctuation(word)
        entries = self.dictionary.dictionary['entries']
        completions = [
            entry['headWord'][len(word):] for entry in entries
        ]

        sorted_completions = sorted(completions, key=lambda x: edit_distance.distance(x, word)) # keeping edit distance here because it is slightly faster than creating that many images on the fly
        return sorted_completions[:5]


if __name__ == "__main__":

    path = 'C:\\Users\\danie\\example_workspace\\project_data'
    d = Dictionary(path)
    s = SpellCheck(d, True)
    print(s.complete('comp'))


