import os
import re
import json
from difflib import SequenceMatcher
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def similarity(first, second):
    """
    Calculate the similarity score between two strings using the SequenceMatcher algorithm.

    Args:
        first (str): The first string to compare.
        second (str): The second string to compare.

    Returns:
        int: The similarity score as a percentage (0-100).
    """
    score = SequenceMatcher(None, first, second).ratio() * 100
    return int(score)

class JsonDatabase:
    """
    A class to manage a JSON-based database for storing and retrieving text data,
    including bible verses, codex chunks, and resources, with support for TF-IDF based search.
    """

    def __init__(self):
        """
        Initializes the JsonDatabase with empty structures for storing texts, references, URIs,
        and TF-IDF matrices and vectorizers for source, target, and resource texts.
        """
        self.dictionary = {}
        self.tfidf_vectorizer_source = TfidfVectorizer()
        self.tfidf_vectorizer_target = TfidfVectorizer()
        self.tfidf_vectorizer_resources = TfidfVectorizer()
        self.tfidf_matrix_source = None
        self.tfidf_matrix_target = None
        self.tfidf_matrix_resources = None
        self.source_texts = []
        self.target_texts = []
        self.resource_texts = []
        self.source_references = []
        self.target_references = []
        self.source_uris = []
        self.target_uris = []
        self.resource_uris = []
        self.complete_draft = ""
    
    def create_database(self, bible_dir, codex_dir, resources_dir, save_all_path):
        """
        Populates the database with texts from bible files, codex chunks, and resources,
        and generates TF-IDF matrices for source, target, and resource texts.

        Args:
            bible_dir (str): Directory containing bible files.
            codex_dir (str): Directory containing codex files.
            resources_dir (str): Directory containing resource files.
            save_all_path (str): Path to save the complete draft of texts.
        """
        try:
            source_files = extract_from_bible_file(path=find_all(bible_dir, ".bible")[0])
        except IndexError:
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
            self.complete_draft += " " + text

        with open(save_all_path+"/complete_draft.context", "w+", encoding='utf-8') as f:
            f.write(self.complete_draft)
        
        if self.source_texts:
            try:
                self.tfidf_matrix_source = self.tfidf_vectorizer_source.fit_transform(self.source_texts)
            except ValueError:
                self.tfidf_matrix_source = None
        else:
            self.tfidf_matrix_source = None
        if self.target_texts:
            
            self.tfidf_matrix_target = self.tfidf_vectorizer_target.fit_transform(self.target_texts)
         

        self.load_resources(resources_dir)
    
    def search(self, query_text, text_type="source", top_n=5):
        """
        Searches for texts that are most similar to the query text within the specified text type,
        using TF-IDF vectorization and cosine similarity.

        Args:
            query_text (str): The text to search for.
            text_type (str): The type of text to search within ("source" or "target").
            top_n (int): The number of top results to return.

        Returns:
            list: A list of dictionaries containing the 'ref', 'text', and 'uri' of the top matches.
        """
        if text_type == "source":
            if self.tfidf_matrix_source is None:
                return [{'ref': ref, 'text': '', 'uri': uri} for ref, uri in zip(self.source_references, self.source_uris)][:top_n]
            query_vector = self.tfidf_vectorizer_source.transform([query_text])
            similarities = cosine_similarity(query_vector, self.tfidf_matrix_source)
            top_indices = similarities.argsort()[0][-top_n:][::-1]
            ret =  [{'ref': self.source_references[i], 'text': self.source_texts[i], 'uri': self.source_uris[i]} for i in top_indices]
            return ret
        elif text_type == "target":
            if self.tfidf_matrix_target is None:

                return [{'ref': ref, 'text': '', 'uri': uri} for ref, uri in zip(self.target_references, self.target_uris)][:top_n]
            query_vector = self.tfidf_vectorizer_target.transform([query_text])
            similarities = cosine_similarity(query_vector, self.tfidf_matrix_target)
            top_indices = similarities.argsort()[0][-top_n:][::-1]

            ret =  [{'ref': self.target_references[i], 'text': self.target_texts[i], 'uri': self.target_uris[i]} for i in top_indices]
            return ret
        else:
            raise ValueError("Invalid text_type. Choose either 'source' or 'target'.")
        
    def get_lad(self, query: str, reference: str, n_samples=5):
        """
        Calculates the similarity between the target search results for a query and the source text
        for a given reference, based on common references in the search results.

        Args:
            query (str): The query text to search within target texts.
            reference (str): The reference to retrieve the source text for comparison.
            n_samples (int): The number of samples to consider for calculating similarity.

        Returns:
            int: The similarity score between the concatenated references of target and source results.
        """
        target_results = self.search(query_text=query, text_type="target", top_n=100)
        source_text = self.get_text(ref=reference, text_type="source")
        source_results = self.search(query_text=source_text, text_type="source", top_n=100)

        # Get the common references between target and source results
        target_refs = [i['ref'] for i in target_results]
        source_refs = [i['ref'] for i in source_results]
        common_refs = list(set(target_refs) & set(source_refs))

        # Filter the results to include only the common references
        target_results = [i for i in target_results if i['ref'] in common_refs][:n_samples]
        source_results = [i for i in source_results if i['ref'] in common_refs][:n_samples]

        ref_string_target = ''.join([i['ref'] for i in target_results])
        ref_string_source = ''.join([i['ref'] for i in source_results])

        return similarity(ref_string_target, ref_string_source)

    def word_rarity(self, text, text_type="source"):
        """
        Analyzes the rarity of each word in the given text based on its TF-IDF score,
        indicating how unique or rare the word is within the specified text type.

        Args:
            text (str): The text to analyze.
            text_type (str): The type of text ("source" or "target") to consider for analysis.

        Returns:
            dict: A dictionary mapping each word to its rarity score.
        """
        # Choose the correct TF-IDF vectorizer and matrix based on the text type
        if text_type == "source":
            tfidf_vectorizer = self.tfidf_vectorizer_source
        elif text_type == "target":
            tfidf_vectorizer = self.tfidf_vectorizer_target
        else:
            raise ValueError("Invalid text_type. Choose either 'source' or 'target'.")

        try:
            # Transform the input text to a TF-IDF vector
            query_vector = tfidf_vectorizer.transform([text])
            
            # Get feature names to map the feature index to the actual word
            feature_names = tfidf_vectorizer.get_feature_names_out()
            
            # Get the scores for each word in the input text
            scores = query_vector.toarray().flatten()
            
            # Create a dictionary of words and their corresponding scores
            word_rarity_dict = {feature_names[i]: scores[i] for i in range(len(scores)) if scores[i] > 0}
        except:
            word_rarity_dict = {}
        
        return word_rarity_dict

    def load_resources(self, resources_dir):
        """
        Loads and processes resource files from the specified directory, updating the TF-IDF matrix
        for resources based on the content of these files.

        Args:
            resources_dir (str): The directory from which to load resource files.
        """
        resource_files = self.find_resource_files(resources_dir)
        self.resource_texts = []
        self.resource_uris = []

        for file_path in resource_files:
            with open(file_path, "r", encoding="utf-8") as file:
                content = file.read()
                self.resource_texts.append(content)
                self.resource_uris.append(file_path)

        if self.resource_texts:
            self.tfidf_matrix_resources = self.tfidf_vectorizer_resources.fit_transform(self.resource_texts)
        else:
            self.tfidf_matrix_resources = None

    def find_resource_files(self, path):
        """
        Recursively searches for and lists all resource files within the specified directory
        and its subdirectories, based on a set of file extensions.

        Args:
            path (str): The root directory to search within.

        Returns:
            list: A list of paths to the found resource files.
        """
        resource_extensions = ['.txt', '.rtf', '.tsv']
        resource_files = []

        for root, _, files in os.walk(path):
            for file in files:
                if any(file.endswith(ext) for ext in resource_extensions):
                    resource_files.append(os.path.join(root, file))

        return resource_files

    def search_resources(self, query_text, top_n=5):
        """
        Searches for and ranks resource files based on their relevance to the query text,
        using TF-IDF vectorization and cosine similarity.

        Args:
            query_text (str): The text to search for.
            top_n (int): The number of top results to return.

        Returns:
            list: A list of dictionaries containing the 'uri' and 'text' of the top matches.
        """
        if self.tfidf_matrix_resources is None:
            return [{'uri': uri, 'text': ''} for uri in self.resource_uris][:top_n]
        query_vector = self.tfidf_vectorizer_resources.transform([query_text])
        similarities = cosine_similarity(query_vector, self.tfidf_matrix_resources)
        top_indices = similarities.argsort()[0][-top_n:][::-1]
        return [{'uri': self.resource_uris[i], 'text': self.resource_texts[i]} for i in top_indices]
    
    def get_text(self, ref: str, text_type="source"):
        """
        Retrieves the text associated with a given reference and text type from the database.

        Args:
            ref (str): The reference identifier for the text.
            text_type (str): The type of text to retrieve ("source" or "target").

        Returns:
            str: The text associated with the given reference and text type, or an empty string if not found.
        """
        if ref in self.dictionary and text_type in self.dictionary[ref]:
            return self.dictionary[ref][text_type]
        return ""
    
def find_all(path: str, types: str = ".codex"):
    """
    Finds all files of a specified type within a directory and its subdirectories.

    Args:
        path (str): The root directory to search within.
        types (str): The file extension to search for.

    Returns:
        list: A list of paths to the found files.
    """
    codex_files = []
    for root, _, files in os.walk(path):
        for file in files:
            if file.endswith(types):
                codex_files.append(os.path.join(root, file))
    return codex_files

def get_data(data, path):
    """
    Extracts and formats verse data from a structured data object.

    Args:
        data (dict): The structured data containing verses and their metadata.
        path (str): The path to the data source, used for generating URIs.

    Returns:
        list: A list of dictionaries, each representing a verse with 'ref', 'text', and 'uri'.
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
    Extracts data from a file at the given path and formats it into verse data.

    Args:
        path (str): The path to the file from which to extract data.

    Returns:
        list: A list of verse data extracted and formatted from the file.
    """
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return get_data(data, path)

def extract_codex_chunks(path: str):
    """
    Extracts codex chunks from files within a directory, specified by the path.

    Args:
        path (str): The directory path containing codex files to extract from.

    Returns:
        list: A list of codex chunk data extracted from the files.
    """
    data = []
    files = find_all(path, ".codex")
    for file in files:
        data.extend(extract_from_file(file))
    return data

def extract_from_bible_file(path):
    """
    Extracts verses from a bible file at the given path.

    Args:
        path (str): The path to the bible file from which to extract verses.

    Returns:
        list: A list of verse data extracted from the bible file.
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
