"""
This module provides functionality to generate text based on the statistical analysis of a given text file.
It allows for generating sentences that follow the statistical patterns of word frequencies and combinations found in the input text.

*** It requires no training ***
"""

import random
from collections import Counter, defaultdict
from typing import Dict, List, Set, Tuple


class TextGenerator:
    """
    A class for generating text based on the statistical analysis of a given text file.

    Attributes:
        file_path (str): The path to the text file used for generating text.
        chunk_size (int): The size of text chunks used for analysis.
        lines (List[str]): The lines of text from the file.
        chunks (List[List[str]]): The text split into chunks for analysis.
        text (List[str]): The entire text split into words.
        whole_dictionary (Dict[str, float]): The word frequency ratio across the entire text.

    Parameters:
        file_path (str): The path to the text file used for generating text.
        chunk_size (int, optional): The size of text chunks used for analysis. Defaults to 100.
    """

    def __init__(self, file_path: str, chunk_size: int = 100) -> None:
        """
        Initializes the TextGenerator with the provided file path and chunk size.

        Args:
            file_path (str): The path to the text file used for generating text.
            chunk_size (int, optional): The size of text chunks used for analysis. Defaults to 100.
        """
        with open(file_path) as f:
            self.lines = f.readlines()
        self.chunk_size = chunk_size
        self.chunks = self._split_into_chunks()
        self.text = " ".join(self.lines).split()  # Keep the whole text for global operations
        self.whole_dictionary = self._word_count_ratio()

    def _split_into_chunks(self) -> List[List[str]]:
        """
        Splits the text into chunks for analysis.

        Returns:
            List[List[str]]: A list of text chunks.
        """
        chunks = []
        for i in range(0, len(self.lines), self.chunk_size):
            chunk = " ".join(self.lines[i:i + self.chunk_size]).split()
            chunks.append(chunk)
        return chunks

    def _word_count_ratio(self) -> Dict[str, float]:
        """
        Calculates the word frequency ratio across the entire text.

        Returns:
            Dict[str, float]: A dictionary mapping words to their frequency ratio.
        """
        word_count = Counter(self.text)
        max_count = max(word_count.values())
        return {word: count / max_count for word, count in word_count.items()}

    def _sort_by_frequency_and_unique(self, input_list: List[str]) -> List[Tuple[str, float]]:
        """
        Sorts words by frequency and uniqueness.

        Args:
            input_list (List[str]): The list of words to be sorted.

        Returns:
            List[Tuple[str, float]]: A list of tuples containing words and their scores.
        """
        counter = Counter(input_list)
        total_words = len(input_list)
        sorted_items = sorted(counter.items(), key=lambda x: (-x[1], x[0]))
        return [(word, count / total_words) for word, count in sorted_items]

    def _combine_lists(self, lists: List[List[Tuple[str, float]]], sentence: str) -> List[Tuple[str, float]]:
        """
        Combines multiple lists of words and their scores, adjusting scores based on global frequency.

        Args:
            lists (List[List[Tuple[str, float]]]): A list of word-score pairs.
            sentence (str): The current sentence.

        Returns:
            List[Tuple[str, float]]: A combined list of words and scores.
        """
        combined_scores = defaultdict(float)
        for word_list in lists:
            for word, score in word_list:
                combined_scores[word] += score
        for word in combined_scores:
            combined_scores[word] -= self.whole_dictionary[word] / 3

        minimum_score_value = min(combined_scores.values(), default=0)
        for word in combined_scores:
            combined_scores[word] += abs(minimum_score_value)

        combined_list = sorted(combined_scores.items(), key=lambda x: x[1], reverse=True)
        return combined_list

    def _find_probabilities(self, word: str, n: int) -> List[Tuple[str, float]]:
        """
        Finds the probability of the next word based on its position relative to the given word.

        Args:
            word (str): The current word.
            n (int): The position relative to the current word.

        Returns:
            List[Tuple[str, float]]: A list of tuples containing words and their probabilities.
        """
        relevant_chunks = [chunk for chunk in self.chunks if word in chunk]
        all_words = []
        for chunk in relevant_chunks:
            index = 0
            while index < len(chunk):
                try:
                    index = chunk[index:].index(word) + index + 1
                    if index + n < len(chunk):
                        all_words.append(chunk[index + n - 1])
                except ValueError:
                    break
        return self._sort_by_frequency_and_unique(all_words)

    def find_all_probs(self, sentence: str) -> Dict[str, List[Tuple[str, float]]]:
        """
        Finds all probabilities for the next words based on the current sentence.

        Args:
            sentence (str): The current sentence.

        Returns:
            Dict[str, List[Tuple[str, float]]]: A dictionary mapping words to lists of word-probability tuples.
        """
        words = sentence.split()
        freqs = [self.whole_dictionary[word] for word in words]
        mean = sum(freqs) / len(freqs)

        return {word: self._find_probabilities(word, len(words) - words.index(word)) for word in words if
                self.whole_dictionary[word] <= mean or word == sentence[-1]}

    def generate_sentence(self, seed_sentence: str, length: int) -> str:
        """
        Generates a sentence of a given length starting with the seed sentence.

        Args:
            seed_sentence (str): The initial sentence.
            length (int): The desired length of the generated sentence.

        Returns:
            str: The generated sentence.
        """
        sentence = seed_sentence
        for _ in range(length):
            probs = self.find_all_probs(sentence)
            combined_list = self._combine_lists(probs.values(), sentence)
            if combined_list:  # Check if there are any words to choose from
                words, scores = zip(*combined_list)
                new_word = random.choices(words, weights=[score ** 4 for score in scores], k=1)[0]
                sentence += " " + new_word
            else:
                break  # Break if no suitable word is found
        return sentence

    def generate_unique_permutations(self, seed_sentence: str, generate_length: int, max_samples: int) -> List[str]:
        """
        Generates unique permutations of sentences based on the seed sentence.

        Args:
            seed_sentence (str): The seed sentence.
            generate_length (int): The desired length of the generated sentences.
            max_samples (int): The maximum number of unique permutations to generate.

        Returns:
            List[str]: A list of unique generated sentences.
        """
        def generate(depth: int, sentence: str, all_sentences: Set[str]) -> None:
            if depth == 0 or len(all_sentences) >= max_samples:
                all_sentences.add(sentence)
                return
            probs = self.find_all_probs(sentence)
            combined_list = self._combine_lists(probs.values(), sentence)
            for word, _ in combined_list:
                if len(all_sentences) >= max_samples:
                    break
                generate(depth - 1, sentence + " " + word, all_sentences)

        all_sentences = set()
        generate(generate_length, seed_sentence, all_sentences)
        return list(all_sentences)[:max_samples]

    def interactive_sentence_builder(self, initial_sentence: str, depth: int = 1) -> None:
        """
        Builds a sentence interactively with the user, offering options for the next word.

        Args:
            initial_sentence (str): The initial sentence.
            depth (int, optional): The depth of the interactive builder. Defaults to 1.
        """
        current_sentence = initial_sentence
        while True:
            print(f"Current sentence: {current_sentence}")
            next_word_options = self.generate_unique_permutations(current_sentence, depth, 3)
            for idx, option in enumerate(next_word_options, start=1):
                print(f"{idx}. {option}")

            try:
                choice = int(input("Choose an option to append (or 0 to exit): "))
                if choice == 0:
                    break
                chosen_option = next_word_options[choice - 1]
                current_sentence = chosen_option
            except (ValueError, IndexError):
                print("Invalid choice. Please try again.")

        print(f"Final sentence: {current_sentence}")



if __name__ == "__main__":
    name = input("What file should be read? ")
    generator = TextGenerator(name, chunk_size=5)
    prompt = input("Provide a prompt (each word must exist in the file): ")
    generator.interactive_sentence_builder(prompt, depth=1)
