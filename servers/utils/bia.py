"""
Bidirectional Inverse Attention
"""

from collections import Counter, defaultdict
import concurrent.futures
import re
from sklearn.feature_extraction.text import TfidfVectorizer
import numpy as np
from scipy.sparse import csr_matrix

class BidirectionalInverseAttention:
    def __init__(self, path):
        with open(path, 'r', encoding='utf-8') as f:
            corpus = f.read().lower()
            print(corpus[0:100])
            sentences = re.split(r'(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?)\s', corpus)
            sentences = [re.sub(r'[^\w\s]', '', sentence) for sentence in sentences]

        self.corpus = corpus
        self.sentences = sentences

        # Create TfidfVectorizer and fit it to the sentences
        self.vectorizer = TfidfVectorizer()
        self.tfidf_matrix = self.vectorizer.fit_transform(self.sentences)
        self.vocab = self.vectorizer.vocabulary_

        # Cache the IDF values
        self.idf = self.vectorizer.idf_

        # Convert TF-IDF matrix to sparse matrix representation
        self.tfidf_matrix = csr_matrix(self.tfidf_matrix)

    def search(self, query, bound=''):
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
        counts = Counter()
        for count in counts_list:
            for word, _ in count.items():
                if word not in self.vocab:
                    continue
                counts[word] += 1

        return counts.most_common()
    def predict(self, query, top_n: int = 15, bound=''):
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
        _text = _text + ' [MASK] '
        for _ in range(num_words):
            next_word = self.predict(_text)[0][0]
            _text = _text.replace('[MASK] ', next_word)
            _text = _text + " [MASK] "
        return _text
    def get_possible_next(self, _text, options=4):
        if _text.endswith(" "):
            _text = _text + '[MASK] '
        else:
            _text = _text + ' [MASK] '
        next_words = [option[0] for option in self.predict(_text)][:options]

        return next_words

    def synonimize(self, word, top_n: int = 77):
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
        print(BDTF.synonimize(text, 77)[:10])
