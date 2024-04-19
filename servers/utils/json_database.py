"""
json tfidf database
"""
import os
import re
import json
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

class JsonDatabase:
    """
    JSON database for the bible files
    """
    def __init__(self):
        self.dictionary = {}
        self.tfidf_vectorizer_source = TfidfVectorizer()
        self.tfidf_vectorizer_target = TfidfVectorizer()
        self.tfidf_matrix_source = None
        self.tfidf_matrix_target = None
        self.source_texts = []
        self.target_texts = []
        self.source_references = []
        self.target_references = []
        self.source_uris = []
        self.target_uris = []
        self.complete_text = ""
    
    def create_database(self, bible_dir, codex_dir, save_all_path):
        """
        Generates database dictionary
        """
        try:
            source_files = extract_from_bible_file(path=find_all(bible_dir, ".bible")[0])
        except FileNotFoundError:
            source_files = []
        target_files = extract_codex_chunks(path=codex_dir)

        for verse in source_files:
            ref = verse["ref"]
            text = verse["text"]
            uri = verse['uri']
            self.dictionary[ref] = {"source": text, "source_uri": uri}
            self.source_texts.append(text)
            self.source_references.append(ref)
            self.source_uris.append(uri)
            self.complete_text += " " + text
        
        for verse in target_files:
            ref = verse["ref"]
            text = verse["text"]
            uri = verse['uri']
            if ref in self.dictionary:
                self.dictionary[ref].update({"target": text, "target_uri": uri})
            else:
                self.dictionary[ref] = {"target": text, "target_uri": uri}
            self.target_texts.append(text)
            self.target_references.append(ref)
            self.target_uris.append(uri)
            self.complete_text += " " + text

        with open(save_all_path+"/complete_draft.txt", "w+", encoding='utf-8') as f:
            f.write(self.complete_text)
        self.tfidf_matrix_source = self.tfidf_vectorizer_source.fit_transform(self.source_texts)
        self.tfidf_matrix_target = self.tfidf_vectorizer_target.fit_transform(self.target_texts)
    
    def search(self, query_text, text_type="source", top_n=5):
        """
        Searches for references based on the query text using TF-IDF
        """
        if text_type == "source":
            query_vector = self.tfidf_vectorizer_source.transform([query_text])
            similarities = cosine_similarity(query_vector, self.tfidf_matrix_source)
            top_indices = similarities.argsort()[0][-top_n:][::-1]
            return [{'ref': self.source_references[i], 'text': self.source_texts[i], 'uri': self.source_uris[i]} for i in top_indices]
        elif text_type == "target":
            query_vector = self.tfidf_vectorizer_target.transform([query_text])
            similarities = cosine_similarity(query_vector, self.tfidf_matrix_target)
            top_indices = similarities.argsort()[0][-top_n:][::-1]
            return [{'ref': self.target_references[i], 'text': self.target_texts[i], 'uri': self.target_uris[i]} for i in top_indices]
        else:
            raise ValueError("Invalid text_type. Choose either 'source' or 'target'.")
        
    def word_rarity(self, text, text_type="source"):
        """
        Returns a dictionary of each word in the given string and its rarity using the TF-IDF.

        Args:
            text (str): The text to analyze for word rarity.
            text_type (str, optional): The type of text to analyze ("source" or "target"). Defaults to "source".

        Returns:
            dict: A dictionary with words as keys and their rarity scores as values.
        """
        # Choose the correct TF-IDF vectorizer and matrix based on the text type
        if text_type == "source":
            tfidf_vectorizer = self.tfidf_vectorizer_source
        elif text_type == "target":
            tfidf_vectorizer = self.tfidf_vectorizer_target
        else:
            raise ValueError("Invalid text_type. Choose either 'source' or 'target'.")

        # Transform the input text to a TF-IDF vector
        query_vector = tfidf_vectorizer.transform([text])
        
        # Get feature names to map the feature index to the actual word
        feature_names = tfidf_vectorizer.get_feature_names_out()
        
        # Get the scores for each word in the input text
        scores = query_vector.toarray().flatten()
        
        # Create a dictionary of words and their corresponding scores
        word_rarity_dict = {feature_names[i]: scores[i] for i in range(len(scores)) if scores[i] > 0}
        
        return word_rarity_dict

    
    def get_text(self, ref: str, text_type="source"):
        return self.dictionary[ref][text_type]
    



def find_all(path: str, types: str = ".codex"):
    """
    Finds all files of a specific type in all subdirectories.
    """
    codex_files = []
    for root, _, files in os.walk(path):
        for file in files:
            if file.endswith(types):
                codex_files.append(os.path.join(root, file))
    return codex_files

def get_data(data, path):
    """
    gets data
    """
    verses = []
    # Iterate over the cells
    for cell in data['cells']:
        if cell['kind'] == 2:  # Scripture cell
            scripture_text = cell['value']
            # Find all the references in the scripture text
            references = re.findall(r'\w+\s+\d+:\d+', scripture_text)
            # Process each reference
            for i in range(len(references) - 1):
                ref = references[i]
                next_ref = references[i + 1]
                # Find the text between the current reference and the next reference
                pattern = re.escape(ref) + r'(.*?)' + re.escape(next_ref)
                match = re.search(pattern, scripture_text, re.DOTALL)
                if match:
                    text = match.group(1).strip()
                    # Create a dictionary for the verse
                    verse = {
                        'ref': ref,
                        'text': text,
                        'uri': path
                    }
                    # Add the verse to the list
                    verses.append(verse)
            # Handle the last reference
            last_ref = references[-1]
            pattern = re.escape(last_ref) + r'(.*)'
            match = re.search(pattern, scripture_text, re.DOTALL)
            if match:
                text = match.group(1).strip()
                # Create a dictionary for the last verse
                verse = {
                    'ref': last_ref,
                    'text': text,
                    'uri': path,
                }
                # Add the last verse to the list
                verses.append(verse)
    return verses

def extract_from_file(path):
    """
    extract from file
    """
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return get_data(data, path)

def extract_codex_chunks(path: str):
    """
    excract codex chunks
    """
    data = []
    files = find_all(path, ".codex")
    for file in files:
        data.extend(extract_from_file(file))
    return data

def extract_from_bible_file(path):
    """
    extract from bible file
    """
    verses = []

    with open(path, "r", encoding="utf-8") as file:
        content = file.read()

        # Find all the references and their corresponding text
        matches = re.findall(r'(\w+\s+\d+:\d+)\s+(.*?)(?=\s+\w+\s+\d+:\d+|$)', content, re.DOTALL)

        for match in matches:
            ref, text = match
            verse = {
                'ref': ref,
                'text': text.strip(),
                'uri': str(path)
            }
            verses.append(verse)

    return verses

