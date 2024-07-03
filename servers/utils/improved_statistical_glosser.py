from typing import List, Dict, Tuple, Set, Any
from collections import defaultdict, Counter
import math
import re
import requests
import os

class ImprovedStatisticalGlosser:
    def __init__(self):
        self.co_occurrences = defaultdict(lambda: defaultdict(int))
        self.source_counts = defaultdict(int)
        self.target_counts = defaultdict(int)
        self.source_doc_freq = defaultdict(int)
        self.target_doc_freq = defaultdict(int)
        self.total_docs = 0
        self.stop_words: Set[str] = set()
        self.known_glosses: Dict[str, List[str]] = {}
    
    def get_count_for_word(self, word: str, is_source: bool = False) -> int:
        if is_source:
            return self.source_counts[word]
        else:
            return self.target_counts[word]

    def train(self, source_sentences: List[str], target_sentences: List[str]):
        # Calculate stop words before training
        self.calculate_stop_words(source_sentences + target_sentences)

        self.total_docs = len(source_sentences)
        for source, target in zip(source_sentences, target_sentences):
            source_tokens = self.tokenize(source)
            target_tokens = self.tokenize(target)
            
            source_set = set(source_tokens)
            target_set = set(target_tokens)
            
            for s_token in source_tokens:
                for t_token in target_tokens:
                    self.co_occurrences[s_token][t_token] += 1
                self.source_counts[s_token] += 1
            
            for t_token in target_tokens:
                self.target_counts[t_token] += 1
            
            for s_token in source_set:
                self.source_doc_freq[s_token] += 1
            for t_token in target_set:
                self.target_doc_freq[t_token] += 1

    def calculate_stop_words(self, sentences: List[str], max_stop_words: int = 75):
        word_counts = Counter(word for sentence in sentences for word in self.tokenize_raw(sentence))
        total_words = sum(word_counts.values())
        total_sentences = len(sentences)
        
        # Consider words appearing in more than 10% of sentences as stop words
        stop_words = {word for word, count in word_counts.items() if count / total_sentences > 0.1}
        
        # Ensure we don't exceed max_stop_words
        sorted_stop_words = sorted(stop_words, key=word_counts.get, reverse=True)
        self.stop_words = set(sorted_stop_words[:max_stop_words])
        print(f"Calculated stop words: {self.stop_words}")  # Debugging line

    def add_known_glosses(self, known_glosses: Dict[str, List[str]]):
        self.known_glosses = known_glosses

    def gloss(self, source_sentence, target_sentence):
        source_tokens = self.tokenize(source_sentence)
        target_tokens = self.tokenize(target_sentence)
        
        mappings = []
        
        for i, s_token in enumerate(source_tokens):
            token_mappings = []
            
            # Check if there are known glosses for this token
            if s_token in self.known_glosses:
                known_targets = self.known_glosses[s_token]
                for t_token in known_targets:
                    if t_token in target_tokens:
                        score = 1.0  # Assign a high score to known glosses
                        token_mappings.append((t_token, score))
            
            # If no known glosses were found, proceed with statistical glossing
            if not token_mappings:
                for j, t_token in enumerate(target_tokens):
                    score = self.calculate_score(s_token, t_token, i, j, len(source_tokens), len(target_tokens))
                    if score > 0:
                        token_mappings.append((t_token, score))
            
            token_mappings.sort(key=lambda x: x[1], reverse=True)
            mappings.append((s_token, token_mappings))
        
        return mappings

    def calculate_score(self, source_token, target_token, source_pos, target_pos, source_len, target_len):
        co_occur = self.co_occurrences[source_token][target_token]
        if co_occur == 0:
            return 0
        
        source_count = self.source_counts[source_token]
        target_count = self.target_counts[target_token]
        
        source_idf = math.log(self.total_docs / (self.source_doc_freq[source_token] + 1))
        target_idf = math.log(self.total_docs / (self.target_doc_freq[target_token] + 1))
        
        tfidf_score = (co_occur / source_count) * source_idf * (co_occur / target_count) * target_idf
        
        position_score = 1 - abs((source_pos / source_len) - (target_pos / target_len))
        
        return tfidf_score * position_score

    def tokenize(self, sentence: str) -> List[str]:
        tokens = re.findall(r'\w+', sentence.lower())
        filtered_tokens = [token for token in tokens if token not in self.stop_words]
        return filtered_tokens

    @staticmethod
    def tokenize_raw(sentence: str) -> List[str]:
        return re.findall(r'\w+', sentence.lower())

    def get_target_vocabulary(self) -> List[str]:
        """Return a list of all unique words in the target corpus."""
        return list(self.target_counts.keys())

    def predict_gloss_for_word(self, target_word: str, top_n: int = 3) -> List[Tuple[str, float]]:
        """Predict glosses for a single target word."""
        glosses = []
        for source_word in self.source_counts.keys():
            score = self.calculate_score(source_word, target_word, 0, 0, 1, 1)
            if score > 0:
                glosses.append((source_word, score))
        
        return sorted(glosses, key=lambda x: x[1], reverse=True)[:top_n]

    def predict_glosses_for_vocabulary(self, batch_size: int = 100) -> Dict[str, List[Tuple[str, float]]]:
        """Predict glosses for all words in the target vocabulary."""
        target_vocab = self.get_target_vocabulary()
        all_glosses = {}

        for i in range(0, len(target_vocab), batch_size):
            batch = target_vocab[i:i+batch_size]
            for word in batch:
                all_glosses[word] = self.predict_gloss_for_word(word)
            
            # Progress update
            print(f"Processed {min(i+batch_size, len(target_vocab))}/{len(target_vocab)} words")

        return all_glosses

    def predict_word_glosses(self, word: str, is_source: bool = True, top_n: int = 3) -> List[Tuple[str, float]]:
        """Predict glosses for a single word."""
        if is_source:
            return self.predict_gloss_for_source_word(word, top_n)
        else:
            return self.predict_gloss_for_target_word(word, top_n)

    def predict_gloss_for_source_word(self, source_word: str, top_n: int = 1) -> List[Tuple[str, float]]:
        if source_word in self.stop_words:
            return []
        
        # Check known glosses first
        if source_word in self.known_glosses:
            return [(gloss, 1.0) for gloss in self.known_glosses[source_word]][:top_n]
        
        glosses = []
        for target_word in self.target_counts.keys():
            if target_word not in self.stop_words:
                score = self.calculate_score(source_word, target_word, 0, 0, 1, 1)
                if score > 0:
                    glosses.append((target_word, score))
        return sorted(glosses, key=lambda x: x[1], reverse=True)[:top_n]

    def predict_gloss_for_target_word(self, target_word: str, top_n: int = 1) -> List[Tuple[str, float]]:
        if target_word in self.stop_words:
            return []
        
        # Check known glosses first
        for source_word, target_words in self.known_glosses.items():
            if target_word in target_words:
                return [(source_word, 1.0)][:top_n]
        
        glosses = []
        for source_word in self.source_counts.keys():
            if source_word not in self.stop_words:
                score = self.calculate_score(source_word, target_word, 0, 0, 1, 1)
                if score > 0:
                    glosses.append((source_word, score))
        return sorted(glosses, key=lambda x: x[1], reverse=True)[:top_n]

    def generate_wooden_translation(self, sentence: str, is_source: bool = True) -> str:
        """
        Generate a wooden back-translation for the input sentence.
        
        Args:
        sentence (str): The input sentence to translate.
        is_source (bool): If True, translate from source to target language.
                          If False, translate from target to source language.
        
        Returns:
        str: The wooden back-translation of the input sentence.
        """
        tokens = self.tokenize(sentence)
        glosses = self.predict_sentence_glosses(' '.join(tokens), is_source)
        translated_words = [gloss_list[0] if gloss_list else '[UNK]' for gloss_list in glosses]
        return ' '.join(translated_words)

    def predict_sentence_glosses(self, sentence: str, is_source: bool = True, top_n: int = 1) -> List[List[str]]:
        """
        Predict the most likely glosses for each word in the input sentence.
        
        Args:
        sentence (str): The input sentence to gloss.
        is_source (bool): If True, treat the input as a source language sentence.
                          If False, treat it as a target language sentence.
        top_n (int): Number of top glosses to return for each word.
        
        Returns:
        List[List[str]]: A list of lists, where each inner list contains the top_n
                         glosses for the corresponding word in the input sentence.
        """
        tokens = self.tokenize(sentence)
        sentence_glosses = []

        for token in tokens:
            if is_source:
                glosses = self.predict_gloss_for_source_word(token, top_n)
            else:
                glosses = self.predict_gloss_for_target_word(token, top_n)
            sentence_glosses.append([gloss for gloss, _ in glosses])

        return sentence_glosses

def download_corpus(url: str, filename: str) -> List[str]:
    if not os.path.exists(filename):
        print(f"Downloading {filename}...")
        response = requests.get(url)
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(response.text)
    
    with open(filename, 'r', encoding='utf-8') as f:
        return f.read().split('\n')

# Function to create and train the glosser
def create_and_train_glosser(source_sentences: List[str], target_sentences: List[str]) -> ImprovedStatisticalGlosser:
    glosser = ImprovedStatisticalGlosser()
    glosser.train(source_sentences, target_sentences)
    return glosser

# Function to add known glosses to the glosser
def add_known_glosses(glosser: ImprovedStatisticalGlosser, known_glosses: Dict[str, List[str]]):
    glosser.add_known_glosses(known_glosses)

# Function to get glosses for a sentence pair
def get_glosses(glosser: ImprovedStatisticalGlosser, source_sentence: str, target_sentence: str) -> List[Tuple[str, List[Tuple[str, float]]]]:
    return glosser.gloss(source_sentence, target_sentence)

# Function to predict glosses for a sentence
def predict_sentence_glosses(glosser: ImprovedStatisticalGlosser, sentence: str, is_source: bool = True, top_n: int = 1) -> List[List[str]]:
    return glosser.predict_sentence_glosses(sentence, is_source, top_n)

# Function to generate wooden translation
def generate_wooden_translation(glosser: ImprovedStatisticalGlosser, sentence: str, is_source: bool = True) -> str:
    return glosser.generate_wooden_translation(sentence, is_source)

if __name__ == "__main__":
    source_sentences = ["The quick brown fox", "jumps over the lazy dog"]
    target_sentences = ["The quick brown fox", "jumps over the lazy dog"]
    glosser = create_and_train_glosser(source_sentences, target_sentences)
    print(glosser.gloss("The quick brown fox", "The quick brown fox"))