import random
from collections import Counter, defaultdict
from typing import Dict, List, Set, Tuple
import math
import numpy as np

class TextGenerator:
    def __init__(self, input_data: str, chunk_size: int = 100) -> None:
        self.lines = self.load_input_data(input_data)
        self.chunk_size = chunk_size
        self.chunks = self.split_into_chunks()
        self.word_list = " ".join(self.lines).split()
        self.word_freq_ratio = self.calculate_word_freq_ratio()

    def load_input_data(self, input_data: str) -> List[str]:
        if input_data.endswith(".txt"):
            with open(input_data, "r") as file:
                return file.read().split("\n")
        else:
            return input_data.split("\n")

    def split_into_chunks(self) -> List[List[str]]:
        return [
            " ".join(self.lines[i : i + self.chunk_size]).split()
            for i in range(0, len(self.lines), self.chunk_size)
        ]

    def calculate_word_freq_ratio(self) -> Dict[str, float]:
        word_count = Counter(self.word_list)
        total_count = sum(word_count.values())
        return {word: math.log((count +1)/ total_count) for word, count in word_count.items()}

    def calculate_word_scores(self, word_list: List[str]) -> List[Tuple[str, float]]:
        word_count = Counter(word_list)
        total_words = len(word_list)
        return [
            (word, self.calculate_word_score(count, total_words))
            for word, count in word_count.most_common()
        ]

    def calculate_word_score(self, count: int, total_words: int) -> float:
        return math.log(count / total_words) * -1

    def combine_word_scores(self, word_scores_list: List[List[Tuple[str, float]]]) -> List[Tuple[str, float]]:
      word_counts = defaultdict(int)
      combined_scores = defaultdict(float)

      # Count the frequency of each word across all word scores lists
      for word_scores in word_scores_list:
          for word, score in word_scores:
              word_counts[word] += 1
              combined_scores[word] += score

      # Calculate the maximum word count
      max_count = max(word_counts.values())

      # Adjust the scores based on the word counts and normalize them
      adjusted_scores = {
          word: score * (word_counts[word] / max_count)
          for word, score in combined_scores.items()
      }

      # Normalize the adjusted scores to a sum of 1
      total_score = sum(adjusted_scores.values())
      normalized_scores = {
          word: score / total_score
          for word, score in adjusted_scores.items()
      }

      return sorted(normalized_scores.items(), key=lambda x: x[1], reverse=True)

    def adjust_word_score(self, score: float, max_score: float) -> float:
        return score / max_score

    def find_next_word_probabilities(self, word: str, n: int) -> List[Tuple[str, float]]:
        relevant_chunks = sorted(
            [chunk for chunk in self.chunks if word in chunk],
            key=lambda x: x[1],
            reverse=True,
        )[:5]

        next_words = []
        for chunk in [chunk for chunk in relevant_chunks]:
            word_positions = [pos for pos, w in enumerate(chunk) if w == word]
            for pos in word_positions:
                target_index = pos + n
                if target_index < len(chunk):
                    target_word = chunk[target_index]
                    if target_word in self.word_freq_ratio:
                        next_words.append(target_word)

        return self.calculate_word_scores(next_words)

    def calculate_sentence_probabilities(self, sentence: str) -> Dict[str, List[Tuple[str, float]]]:
        words = sentence.split()
        mean_freq = self.calculate_mean_freq(words)

        probabilities = {}
        for i, word in enumerate(words):
            probabilities[word] = self.find_next_word_probabilities(word, len(words) - i)

        return probabilities

    def calculate_mean_freq(self, words: List[str]) -> float:
        freq_sum = sum(self.word_freq_ratio.get(word, float("-inf")) for word in words)
        return freq_sum / len(words)

    def select_next_word(self, combined_scores: List[Tuple[str, float]]) -> str:
        words, scores = zip(*combined_scores)
        adjusted_scores = [self.adjust_score_for_selection(score) for score in scores]
        return random.choices(words, weights=adjusted_scores)[0]

    def adjust_score_for_selection(self, score: float) -> float:
        return math.exp(score)

    def generate_sentence(self, seed_sentence: str, length: int) -> str:
        sentence = seed_sentence.split()
        for _ in range(length):
            probabilities = self.calculate_sentence_probabilities(" ".join(sentence))
            combined_scores = self.combine_word_scores(list(probabilities.values()))
            if combined_scores:
                next_word = self.select_next_word(combined_scores)
                sentence.append(next_word)
            else:
                break
        return " ".join(sentence)

    def generate_unique_permutations(self, seed_sentence: str, generate_length: int, max_samples: int) -> List[str]:
        def generate_permutations(depth: int, current_sentence: List[str], all_sentences: Set[str]):
            if depth == 0 or len(all_sentences) >= max_samples:
                all_sentences.add(" ".join(current_sentence))
                return

            probabilities = self.calculate_sentence_probabilities(" ".join(current_sentence))
            combined_scores = self.combine_word_scores(list(probabilities.values()))
            for word, _ in combined_scores:
                if len(all_sentences) >= max_samples:
                    break
                generate_permutations(depth - 1, current_sentence + [word], all_sentences)

        all_sentences = set()
        generate_permutations(generate_length, seed_sentence.split(), all_sentences)
        return list(all_sentences)[:max_samples]

    def interactive_sentence_builder(self, initial_sentence: str, depth: int = 1) -> None:
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
                current_sentence = next_word_options[choice - 1]
            except (ValueError, IndexError):
                print("Invalid choice. Please try again.")

        print(f"Final sentence: {current_sentence}")


def tokenize(word: str) -> str:
    return word


if __name__ == "__main__":
    input_data = input("Enter the text or file path: ")
    generator = TextGenerator(input_data, chunk_size=100)
    prompt = input("Provide a prompt (each word must exist in the text): ")
    ret = generator.generate_unique_permutations(prompt, 1, 3)
    print(ret)

if __name__ == "__main__":
    while 1:
        prompt = input("Provide a prompt (each word must exist in the text): ")
        ret = generator.generate_unique_permutations(prompt, 1, 4)
        print(ret)