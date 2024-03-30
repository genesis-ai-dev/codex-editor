"""
This module provides classes and functions for spell checking words against a custom dictionary.
It includes functionality to determine if a word needs correction, suggest corrections, and
provide auto-completion suggestions for partially typed words.
"""
import json
import os
from typing import List, Dict, AnyStr, Union, Tuple
import uuid
import experiments.hash_check3 as hash_check
import tools.edit_distance as edit_distance
import re
import string
import sys
from io import TextIOWrapper
from enum import Enum

try:
    from servers.tools.nlp import genetic_tokenizer
except ImportError:
    from tools.nlp import genetic_tokenizer as gt
    genetic_tokenizer = gt

translator = str.maketrans('', '', string.punctuation)

class CheckMode(Enum):
    EDIT_DISTANCE = 1
    IMAGE_HASH = 2
    COMBINE_BOTH = 3

def criteria(dictionary_word: Dict, word: str, word_hash: hash_check.Hash, dictionary, mode: CheckMode) -> Union[float, Tuple[float, float]]:
    """
    Calculates the criteria for spell checking by comparing a word against a dictionary entry.

    If mode is EDIT_DISTANCE, it uses edit distance to determine the similarity between the word and the dictionary headWord.
    If mode is IMAGE_HASH, it uses image hash values to calculate the difference between the word and the dictionary entry.
    If mode is COMBINE_BOTH, it returns a tuple containing the edit distance and hash difference.

    Parameters:
    dictionary_word (Dict): A dictionary entry with keys like 'hash' and 'headWord'.
    word (str): The word to compare against the dictionary entry.
    dictionary (Dictionary): The dictionary object.
    mode (CheckMode): The mode to use for spell checking.

    Returns:
    Union[float, Tuple[float, float]]: The difference between the word and the dictionary entry as a float or a tuple of floats.
    """
    if mode == CheckMode.EDIT_DISTANCE:
        return edit_distance.distance(dictionary_word["headWord"], word)
    elif mode == CheckMode.IMAGE_HASH:
        hash1 = hash_check.Hash(dictionary_word['hash'])
        hash2 = word_hash
        try:
            return hash1 - hash2
        except Exception as e:
            # If an error occurs during hash comparison, rehash the older word and update the dictionary
            rehashed_entry = {
                **dictionary_word,
                'hash': str(hash_check.spell_hash(dictionary_word["headWord"]))
            }
            dictionary.dictionary['entries'] = [
                rehashed_entry if entry['id'] == dictionary_word['id'] else entry
                for entry in dictionary.dictionary['entries']
            ]
            dictionary.save_dictionary()
            return hash_check.Hash(rehashed_entry['hash']) - hash2
    elif mode == CheckMode.COMBINE_BOTH:
        edit_dist = edit_distance.distance(dictionary_word["headWord"], word)
        hash1 = hash_check.Hash(dictionary_word['hash'])
        hash2 = word_hash
        try:
            hash_diff = hash1 - hash2
        except Exception as e:
            # If an error occurs during hash comparison, rehash the older word and update the dictionary
            rehashed_entry = {
                **dictionary_word,
                'hash': str(hash_check.spell_hash(dictionary_word["headWord"]))
            }
            dictionary.dictionary['entries'] = [
                rehashed_entry if entry['id'] == dictionary_word['id'] else entry
                for entry in dictionary.dictionary['entries']
            ]
            dictionary.save_dictionary()
            hash_diff = hash_check.Hash(rehashed_entry['hash']) - hash2
        return (edit_dist, hash_diff)

def remove_punctuation(text: str) -> str:
    """
    Removes punctuation from the given text.
    """
    return text.translate(translator).strip().replace(".", "").replace('"', '')


class Dictionary:
    def __init__(self, project_path: str) -> None:
        """
        Initializes the Dictionary object with a project path.

        Args:
            project_path (str): The base path where the dictionary files are located.
        """
        self.path = project_path + '/project.dictionary'  # TODO: #4 Use all .dictionary files in drafts directory
        self.dictionary = self.load_dictionary()  # Load the .dictionary (json file)
        self.tokenizer = genetic_tokenizer.TokenDatabase(self.path, single_words=True)
    
    def load_dictionary(self) -> Dict:
        """
        Loads the dictionary from a JSON file.

        Returns:
            Dict: The dictionary loaded from the file, or a new dictionary if the file does not exist.
        """
        try:
            with open(self.path, 'r') as file:
                try:
                    data = json.load(file)
                except json.decoder.JSONDecodeError:
                    data = {"entries": []}
                return data
        except FileNotFoundError:
            # Create the directory if it does not exist
            os.makedirs(os.path.dirname(self.path), exist_ok=True)

            # Create the dictionary and write it to the file
            new_dict: dict[str, list] = {"entries": []}
            with open(self.path, 'w') as file:
                json.dump(new_dict, file)
            return new_dict
        words = ""

    def save_dictionary(self) -> None:
        """
        Saves the current state of the dictionary to a JSON file.
        """
        with open(self.path, 'w') as file:
            json.dump(self.dictionary, file, indent=2)

    def define(self, word: str) -> None:
        """
        Adds a new word to the dictionary if it does not already exist.

        Args:
            word (str): The word to add to the dictionary.
        """
        word = remove_punctuation(word)
        
        # Add a word if it does not already exist
        if not any(entry['headWord'] == word for entry in self.dictionary['entries']) and word != '' and word != ' ':
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
        self.tokenizer.insert_manual(word)
        text = ""
        for entry in self.dictionary["entries"]:
            text += entry['headWord']
        self.tokenizer.upsert_text(text)
        

    def remove(self, word: str) -> None:
        """
        Removes a word from the dictionary.

        Args:
            word (str): The word to remove from the dictionary.
        """
        word = remove_punctuation(word)
        # Remove a word
        self.dictionary['entries'] = [entry for entry in self.dictionary['entries'] if entry['headWord'] != word]
        self.save_dictionary()



class SpellCheck:
    def __init__(self, dictionary: Dictionary, mode: CheckMode = CheckMode.EDIT_DISTANCE) -> None:
        """
        Initialize the SpellCheck class with a dictionary and a mode for spell checking.

        Args:
            dictionary (Dictionary): The dictionary object to use for spell checking.
            mode (CheckMode, optional): The mode to use for spell checking. Defaults to CheckMode.EDIT_DISTANCE.
        """
        self.dictionary = dictionary
        self.mode = mode
    
    def is_correction_needed(self, word: str) -> bool:
        """
        Determine if a word needs correction based on its presence in the dictionary and other criteria.

        Args:
            word (str): The word to check for correction.

        Returns:
            bool: True if correction is needed, False otherwise.
        """
        
        if word.upper() == word or re.search(r"\d+:\d+", word):
            return False
        word = word.lower()
        word = remove_punctuation(word)
        return not any(
            entry['headWord'].lower() == word for entry in self.dictionary.dictionary['entries']
        )

    def check(self, word: str) -> List[str]:
        """
        Check a word for spelling and suggest corrections if needed.

        Args:
            word (str): The word to check for spelling.

        Returns:
            List[str]: A list of suggested corrections, limited to the top 5 suggestions.
        """
        word = remove_punctuation(word).lower()

        if not self.is_correction_needed(word):
            return [word]  # No correction needed, return the original word

        entries = self.dictionary.dictionary['entries']
        word_hash = hash_check.spell_hash(word)

        if self.mode == CheckMode.COMBINE_BOTH:
            # Find top n words using edit distance
            top_n = 10
            edit_distance_possibilities = [
                (entry['headWord'], edit_distance.distance(entry['headWord'], word))
                for entry in entries
            ]
            sorted_by_edit_distance = sorted(edit_distance_possibilities, key=lambda x: x[1])
            top_words = sorted_by_edit_distance[:top_n]

            # Rerank top words using hashing
            hash_possibilities = [
                (word, criteria(next(entry for entry in entries if entry['headWord'] == word), word, word_hash, self.dictionary, CheckMode.IMAGE_HASH))
                for word, _ in top_words
            ]
            sorted_by_hash = sorted(hash_possibilities, key=lambda x: x[1])
            suggestions = [word for word, _ in sorted_by_hash]
        else:
            possibilities = [
                (entry['headWord'], criteria(entry, word, word_hash, self.dictionary, self.mode))
                for entry in entries
            ]
            sorted_possibilities = sorted(possibilities, key=lambda x: x[1])
            suggestions = [word for word, _ in sorted_possibilities]

        suggestions = suggestions[:5]
        return suggestions
    
    def complete(self, word: str) -> List[str]:
        """
        Provide auto-completion suggestions for a given word fragment by returning the portions of each word that complete the given word fragment.

        Args:
            word (str): The word fragment to complete.

        Returns:
            List[str]: A list of word portions that complete the given word fragment, limited to the top 5 suggestions.
        """
        word = remove_punctuation(word).lower()

        entries = self.dictionary.dictionary['entries']
        completions = [
            entry['headWord'][len(word):] for entry in entries if entry['headWord'].lower().startswith(word)
        ]

        # Sort completions based on their length to prioritize shorter, more likely completions
        sorted_completions = sorted(completions, key=lambda x: len(x))
        return sorted_completions[:5]


if __name__ == "__main__":
    path = 'C:\\Users\\danie\\example_workspace\\project_data'
    d = Dictionary(path)
    s = SpellCheck(d, mode=CheckMode.COMBINE_BOTH)
    print(s.complete('is'))