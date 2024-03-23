import random
from collections import Counter, defaultdict
from typing import Dict, List, Set, Tuple

class TextGenerator:
    def __init__(self, input_data: str, chunk_size: int = 100) -> None:
        if input_data.endswith(".txt"):
            with open(input_data) as f:
                text = f.read()
        else:
            text = input_data

        self.lines = text.split("\n")
        self.chunk_size = chunk_size
        self.chunks = self._split_into_chunks()
        self.word_list = text.split()
        self.whole_dictionary = self._word_count_ratio()

    def _split_into_chunks(self) -> List[List[str]]:
        chunks = []
        for i in range(0, len(self.lines), self.chunk_size):
            chunk = " ".join(self.lines[i:i + self.chunk_size]).split()
            chunks.append(chunk)
        return chunks

    def _word_count_ratio(self) -> Dict[str, float]:
        word_count = Counter(self.word_list)
        max_count = max(word_count.values())
        return {word: count / max_count for word, count in word_count.items()}

    def _sort_by_frequency_and_unique(self, input_list: List[str]) -> List[Tuple[str, float]]:
        counter = Counter(input_list)
        total_words = len(input_list)
        sorted_items = sorted(counter.items(), key=lambda x: (-x[1], x[0]))
        return [(word, count / total_words) for word, count in sorted_items]

    def _combine_lists(self, lists: List[List[Tuple[str, float]]], sentence: str) -> List[Tuple[str, float]]:
        combined_scores: Dict = defaultdict(float)
        for word_list in lists:
            for word, score in word_list:
                combined_scores[word] += score
        for word in combined_scores:
            combined_scores[word] -= self.whole_dictionary.get(word, 0) / 3

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
        relevant_chunks = sorted([(chunk, chunk.count(word)) for chunk in self.chunks if word in chunk], key=lambda x: x[1], reverse=True)[:5]
        chunks = [chunk[0] for chunk in relevant_chunks]
        all_words = []
        for chunk in chunks:
            index = 0
            while index < len(chunk):
                try:
                    index = chunk[index:].index(word) + index + 1
                    target_index = index + n - 1
                    while target_index < len(chunk):
                        target_word = chunk[target_index]
                        if target_word in self.whole_dictionary:
                            all_words.append(target_word)
                            break
                        target_index += 1
                except ValueError:
                    break
        return self._sort_by_frequency_and_unique(all_words)

    def find_all_probs(self, sentence: str) -> Dict[str, List[Tuple[str, float]]]:
        words = sentence.split()
        freqs = [self.whole_dictionary.get(word, 0) for word in words]
        mean = sum(freqs) / len(freqs)

        probs = {}
        for word in words:
            if self.whole_dictionary.get(word, 0) <= mean or word == sentence[-1]:
                probs[word] = self._find_probabilities(word, len(words) - words.index(word))
            else:
                tokenized_word = tokenize(word)
                if tokenized_word in self.whole_dictionary:
                    probs[tokenized_word] = self._find_probabilities(tokenized_word, len(words) - words.index(word))
        return probs

    def generate_sentence(self, seed_sentence: str, length: int) -> str:
        sentence = seed_sentence
        for _ in range(length):
            probs = self.find_all_probs(sentence)
            combined_list = self._combine_lists([list(v) for v in probs.values()], sentence)
            if combined_list:
                words, scores = zip(*combined_list)
                new_word = random.choices(words, weights=[score ** 4 for score in scores], k=1)[0]
                sentence += " " + new_word
            else:
                break
        return sentence
    def generate_unique_permutations(self, seed_sentence: str, generate_length: int, max_samples: int) -> List[str]:
        def generate(depth: int, sentence: str, all_sentences: Set[str]) -> None:
            if depth == 0 or len(all_sentences) >= max_samples:
                all_sentences.add(sentence)
                return
            probs = self.find_all_probs(sentence)
            combined_list = self._combine_lists([list(v) for v in probs.values()], sentence)
            for word, _ in combined_list:
                if len(all_sentences) >= max_samples:
                    break
                generate(depth - 1, sentence + " " + word, all_sentences)

        all_sentences: Set[str] = set()
        generate(generate_length, seed_sentence, all_sentences)
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
                chosen_option = next_word_options[choice - 1]
                current_sentence = chosen_option
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