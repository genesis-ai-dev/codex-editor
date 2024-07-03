"""
Bidirectional Inverse Attention
"""

from collections import Counter, defaultdict
import concurrent.futures
import re
from sklearn.feature_extraction.text import TfidfVectorizer
import numpy as np


class MarkovChain:
    """
    A class to represent a Markov Chain model for text.
    
    Attributes:
        corpus (str): The text corpus.
        words (list): List of words in the corpus.
        mapping (dict): A dictionary mapping each word to the list of words that can follow it.
        reverse_mapping (dict): A dictionary mapping each word to the list of words that can precede it.
    """
    def __init__(self, corpus: str):
        """
        Initializes the MarkovChain with a text corpus.
        
        Args:
            corpus (str): The text corpus to model.
        """
        self.corpus = corpus
        self.words = corpus.split()
        self.mapping = {}
        self.reverse_mapping = {}
        for index, word in enumerate(self.words):
            if index == len(self.words)-1:
                break
            if word not in self.mapping:
                self.mapping[word] = [self.words[index + 1]]
            else:
                self.mapping[word].append(self.words[index + 1])
            if index > 0:
                if word not in self.reverse_mapping:
                    self.reverse_mapping[word] = [self.words[index - 1]]
                else:
                    self.reverse_mapping[word].append(self.words[index - 1])

    def can_be_next(self, last, next_):
        """
        Determines if a word can logically follow another word based on the corpus.
        
        Args:
            last (str): The preceding word.
            next_ (str): The word to check if it can follow.
            
        Returns:
            bool: True if next_ can follow last, False otherwise.
        """
        if last not in self.mapping:
            return True  # cause why not
        else:
            return next_ in self.mapping[last]

    def can_preclude(self, word, next_):
        """
        Determines if a word can logically precede another word based on the corpus.
        
        Args:
            word (str): The word to check if it can precede.
            next_ (str): The following word.
            
        Returns:
            bool: True if word can precede next_, False otherwise.
        """
        if next_ not in self.reverse_mapping:
            return True
        else:
            return word in self.reverse_mapping[next_]


class BidirectionalInverseAttention:
    """
    A class for implementing Bidirectional Inverse Attention on text data.
    
    Attributes:
        corpus (str): The entire text corpus.
        chain (MarkovChain): The Markov Chain model of the corpus.
        sentences (list): List of sentences in the corpus.
        vectorizer (TfidfVectorizer): TF-IDF vectorizer for the sentences.
        tfidf_matrix: TF-IDF matrix of the sentences.
        vocab (dict): Vocabulary and indices from the TF-IDF vectorizer.
        idf (array): Inverse Document Frequency values.
    """
    def __init__(self, path):
        """
        Initializes the BidirectionalInverseAttention with a path to a text file.
        
        Args:
            path (str): Path to the text file to analyze.
        """
        with open(path, 'r', encoding='utf-8') as f:
            corpus = f.read().lower()
            sentences = re.split(r'(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?)\s', corpus)
            sentences = [re.sub(r'[^\w\s]', '', sentence) for sentence in sentences]
        self.corpus = corpus
        self.chain = MarkovChain(corpus)
        self.sentences = sentences

        # Create TfidfVectorizer and fit it to the sentences
        self.vectorizer = TfidfVectorizer()
        self.tfidf_matrix = self.vectorizer.fit_transform(self.sentences)
        self.vocab = self.vectorizer.vocabulary_

        # Cache the IDF values
        self.idf = self.vectorizer.idf_

    def search(self, query, bound=''):
        """
        Searches the corpus for sentences relevant to a query within a specified boundary.
        
        Args:
            query (str): The query string.
            bound (str, optional): A boundary condition for the search. Defaults to ''.
            
        Returns:
            list: A list of sentences relevant to the query.
        """
        # Transform the query into a TF-IDF vector
        query_vector = self.vectorizer.transform([re.sub(r'\[MASK\]', '', query)])

        # Compute the similarity scores between the query vector and the sentence vectors
        similarity_scores = self.tfidf_matrix.dot(query_vector.T).toarray().flatten()

        # Get the indices of the sentences with non-zero similarity scores
        relevant_indices = similarity_scores.nonzero()[0]
        start = 0
        end = len(relevant_indices) - 1
        if bound:
            rel = [i for i in self.sentences if bound in i]
            start = self.sentences.index(rel[0])
            end = self.sentences.index(rel[-1])

        # Return the relevant sentences
        return [self.sentences[i] for i in relevant_indices if start < i < end]

    def combine_counts(self, counts_list):
        """
        Combines word counts from multiple Counter objects, filtering by vocabulary.
        
        Args:
            counts_list (list): A list of Counter objects.
            
        Returns:
            list: A list of (word, count) tuples sorted by count in descending order.
        """
        counts = Counter()
        for count in counts_list:
            for word, _ in count.items():
                if word not in self.vocab:
                    continue
                counts[word] += 1

        return counts.most_common()

    def predict(self, query, top_n: int = 15, bound=''):
        """
        Predicts words based on a query, considering the top N rare words and a boundary.
        
        Args:
            query (str): The query string with '[MASK]' placeholders for prediction.
            top_n (int, optional): Number of top rare words to consider. Defaults to 15.
            bound (str, optional): A boundary condition for the prediction. Defaults to ''.
            
        Returns:
            list: A list of (word, count) tuples for the predicted words.
        """
        _text = query.split()
        target = [_text.index(i) for i in _text if '[MASK]' in i][0]

        # Get the top N rare words from the text based on their IDF values
        rare_words = [w for w in _text if w in self.vocab]
        rare_words = sorted(rare_words, key=lambda x: self.idf[self.vocab[x]], reverse=True)[:top_n]

        with concurrent.futures.ThreadPoolExecutor() as executor:
            futures = []
            for word in _text:
                distance = _text.index(word) - target
                if word in rare_words or abs(distance) < 1:
                    futures.append(executor.submit(self.predict_from, word, distance, bound=bound))

            probabilities = [future.result() for future in concurrent.futures.as_completed(futures)]

        return self.combine_counts(probabilities)

    def predict_from(self, word, distance, bound=''):
        """
        Helper function for predict, to predict from a single word and distance.
        
        Args:
            word (str): The word to predict from.
            distance (int): The distance from the target word.
            bound (str, optional): A boundary condition for the prediction. Defaults to ''.
            
        Returns:
            Counter: A Counter object with word counts.
        """
        results = self.search(query=word, bound=bound)
        word_counts = Counter()
        for result in results:
            _text = result.split()
            if word not in _text:
                continue
            word_index = _text.index(word)
            cast_index = word_index - distance

            if 0 <= cast_index < len(_text):
                prediction = _text[cast_index]
                word_counts[prediction] += 1
        return word_counts

    def predict_next(self, _text, num_words=5):
        """
        Predicts the next N words for a given text.
        
        Args:
            _text (str): The initial text.
            num_words (int, optional): The number of words to predict. Defaults to 5.
            
        Returns:
            str: The text with the predicted words appended.
        """
        _text = _text + ' [MASK] '
        for _ in range(num_words):
            next_word = self.predict(_text)[0][0]
            _text = _text.replace('[MASK] ', next_word)
            _text = _text + " [MASK] "
        return _text

    def get_possible_next(self, _text, options=4):
        """
        Gets possible next words for a given text, limited by options.
        
        Args:
            _text (str): The initial text.
            options (int, optional): The number of options to return. Defaults to 4.
            
        Returns:
            list: A list of possible next words.
        """
        last = _text.split()[-1]
        if _text.endswith(" "):
            _text = _text + '[MASK] '
        else:
            _text = _text + ' [MASK] '
        next_words = [option[0] for option in self.predict(_text)][:options*4]

        return [option for option in next_words if self.chain.can_be_next(last, option)]

    def synonimize(self, word, top_n: int = 77):
        """
        Finds synonyms for a given word based on the corpus and boundary conditions.
        
        Args:
            word (str): The word to find synonyms for.
            top_n (int, optional): The number of synonyms to return. Defaults to 77.
            
        Returns:
            list: A list of synonyms for the given word.
        """
        samples = self.search(word, bound=word)
        step = len(samples) // top_n
        if step == 0:
            step = 1
        samples = [samples[i] for i in range(0, len(samples), step)]

        with concurrent.futures.ThreadPoolExecutor() as executor:
            futures = []
            for sample in samples:
                sample_text = sample.replace(word, '[MASK]')
                futures.append(executor.submit(self.predict, sample_text, bound=word, top_n=7))

            probabilities = [future.result() for future in concurrent.futures.as_completed(futures)]

        combined_probabilities = self.combine_votes(probabilities)
        return [p for p in combined_probabilities if p[0] != word]

    def combine_votes(self, probabilities_list):
        """
        Combines probabilities from multiple sources, weighted by TF-IDF values.
        
        Args:
            probabilities_list (list): A list of probabilities to combine.
            
        Returns:
            list: A list of (word, combined probability) tuples.
        """
        combined_probabilities = defaultdict(float)

        for probabilities in probabilities_list:
            for word, _ in probabilities:
                tfidf = self.idf[self.vocab[word]]
                combined_probabilities[word] += tfidf ** 2

        words = list(combined_probabilities.keys())
        scores = list(combined_probabilities.values())

        # Convert words and scores to numpy arrays
        words_array = np.array(words)
        scores_array = np.array(scores)

        # Normalize the scores
        normalized_scores = scores_array / np.sum(scores_array)

        # Sort the words based on normalized scores in descending order
        sorted_indices = np.argsort(normalized_scores)[::-1]
        sorted_words = words_array[sorted_indices]
        sorted_scores = normalized_scores[sorted_indices]

        return list(zip(sorted_words, sorted_scores))


if __name__ == "__main__":
    BDTF = BidirectionalInverseAttention("/Users/daniellosey/project1/.project/sourceTextBibles/eng-eng-rv.bible")

    while 1:
        text = input(":")
        print(BDTF.get_possible_next(text, 4))
