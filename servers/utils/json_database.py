import os
import re
import json
import logging
from difflib import SequenceMatcher
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from .improved_statistical_glosser import ImprovedStatisticalGlosser

# Set this flag to True to enable verbose logging, False to disable
VERBOSE_LOGGING = False

# Set up logging
if VERBOSE_LOGGING:
    log_path = os.path.join(".", "json_database.log")
    logging.basicConfig(filename=log_path, level=logging.DEBUG, 
                        format='%(asctime)s - %(levelname)s - %(message)s')
else:
    # Set up a null handler to avoid "No handler found" warnings
    logging.getLogger().addHandler(logging.NullHandler())

def log(level, message):
    if VERBOSE_LOGGING:
        if level == 'DEBUG':
            logging.debug(message)
        elif level == 'INFO':
            logging.info(message)
        elif level == 'WARNING':
            logging.warning(message)
        elif level == 'ERROR':
            logging.error(message)
        elif level == 'CRITICAL':
            logging.critical(message)

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
        self.glosser = None
        self.project_dictionary = None
    
    def create_database(self, bible_dir, codex_dir, resources_dir, project_dictionary_path, save_all_path):
        """
        Populates the database with texts from bible files, codex chunks, and resources,
        and generates TF-IDF matrices for source, target, and resource texts.

        Args:
            bible_dir (str): Directory containing bible files.
            codex_dir (str): Directory containing codex files.
            resources_dir (str): Directory containing resource files.
            dictionary_path (str): Path to the project.dictionary file. - Note, this is a .dictionary file!
            save_all_path (str): Path to save the complete draft of texts.

        Returns:
            dict: A dictionary containing status information and any error messages.
        """
        if VERBOSE_LOGGING:
            # Update the log path to include the save_all_path from the frontend
            log_path = os.path.join(save_all_path, "json_database.log")
            logging.basicConfig(filename=log_path, level=logging.DEBUG, 
                                format='%(asctime)s - %(levelname)s - %(message)s')
        
        status = {"success": True, "errors": []}

        try:
            source_files = extract_from_bible_file(path=find_all(bible_dir, ".bible")[0])
        except IndexError:
            source_files = []
            status["errors"].append("No .bible files found in the specified directory.")
        except Exception as e:
            status["errors"].append(f"Error extracting from bible file: {str(e)}")

        try:
            target_files = extract_codex_chunks(path=codex_dir)
        except Exception as e:
            status["errors"].append(f"Error extracting codex chunks: {str(e)}")
            target_files = []

        try:
            self.project_dictionary = extract_dictionary(path=project_dictionary_path)
        except FileNotFoundError:
            self.project_dictionary = None
            status["errors"].append("Project dictionary file not found.")
        except Exception as e:
            status["errors"].append(f"Error extracting project dictionary: {str(e)}")
            self.project_dictionary = None

        for verse in target_files:
            ref = verse["ref"]
            text = verse["text"]
            
            uri = verse['uri']
            if ref in self.dictionary:
                self.dictionary[ref].update({"target": text, "target_uri": uri})
            else:
                if len(text) < 4:
                    continue
                self.dictionary[ref] = {"target": text, "target_uri": uri}
            self.target_texts.append(text)
            self.target_references.append(ref)
            self.target_uris.append(uri)
            self.complete_draft += " " + text
    
        for verse in source_files:
            ref = verse["ref"]
            text = verse["text"]
            
            uri = verse['uri']
            if ref not in self.dictionary:
                self.dictionary[ref] = {}
            self.dictionary[ref].update({"source": text, "source_uri": uri})
            self.source_texts.append(text)
            self.source_references.append(ref)
            self.source_uris.append(uri)

        try:
            with open(os.path.join(save_all_path, "complete_draft.context"), "w+", encoding='utf-8') as f:
                f.write(self.complete_draft)
        except Exception as e:
            status["errors"].append(f"Error saving complete draft: {str(e)}")

        if self.source_texts:
            try:
                self.tfidf_matrix_source = self.tfidf_vectorizer_source.fit_transform(self.source_texts)
            except ValueError:
                self.tfidf_matrix_source = None
                status["errors"].append("Error creating TF-IDF matrix for source texts.")
        else:
            self.tfidf_matrix_source = None
            status["errors"].append("No source texts available for TF-IDF matrix creation.")

        if self.target_texts:
            try:
                self.tfidf_matrix_target = self.tfidf_vectorizer_target.fit_transform(self.target_texts)
            except Exception as e:
                status["errors"].append(f"Error creating TF-IDF matrix for target texts: {str(e)}")
        else:
            status["errors"].append("No target texts available for TF-IDF matrix creation.")

        try:
            self.load_resources(resources_dir)
        except Exception as e:
            status["errors"].append(f"Error loading resources: {str(e)}")

        log('INFO', "Initializing glosser...")
        try:
            self.initialize_glosser()
            log('INFO', "Glosser initialization completed")
        except Exception as e:
            status["errors"].append(f"Error initializing glosser: {str(e)}")
            log('ERROR', f"Glosser initialization failed: {str(e)}")

        if status["errors"]:
            status["success"] = False
        
        log('INFO', f"Database creation completed. Status: {status}")
        return status

    def initialize_glosser(self):
        """
        Initialize and train the ImprovedStatisticalGlosser using the source and target texts.

        Returns:
            dict: A dictionary containing status information and any error messages.
        """
        status = {"success": True, "errors": []}

        self.glosser = ImprovedStatisticalGlosser()
        
        log('INFO', f"Initializing glosser with {len(self.source_texts)} source texts and {len(self.target_texts)} target texts")

        num_pairs = min(len(self.source_texts), len(self.target_texts))
        
        if num_pairs == 0:
            status["errors"].append("No text pairs available for training the glosser")
            log('WARNING', "No text pairs available for training the glosser")
            return status

        log('INFO', f"Training glosser with {num_pairs} text pairs")
        try:
            self.glosser.train(self.source_texts[:num_pairs], self.target_texts[:num_pairs])
        except Exception as e:
            status["errors"].append(f"Error training glosser: {str(e)}")
            log('ERROR', f"Error training glosser: {str(e)}")
            return status

        log('INFO', "Glosser training completed")
        log('INFO', f"Source vocabulary size: {len(self.glosser.source_counts)}")
        log('INFO', f"Target vocabulary size: {len(self.glosser.target_counts)}")
        log('INFO', f"Co-occurrences: {sum(len(v) for v in self.glosser.co_occurrences.values())}")

        if self.project_dictionary and "entries" in self.project_dictionary:
            known_glosses = {
                entry["headWord"]: entry["translationEquivalents"]
                for entry in self.project_dictionary["entries"]
                if entry["translationEquivalents"]
            }
            try:
                self.glosser.add_known_glosses(known_glosses)
                log('INFO', f"Added {len(known_glosses)} known glosses from project dictionary")
            except Exception as e:
                status["errors"].append(f"Error adding known glosses: {str(e)}")
                log('ERROR', f"Error adding known glosses: {str(e)}")
        else:
            status["errors"].append("No project dictionary available or no entries found")
            log('WARNING', "No project dictionary available or no entries found")

        return status

    def get_glosses(self, source_text, target_text):
        """
        Get glosses for a pair of source and target texts.

        Args:
            source_text (str): The source language text.
            target_text (str): The target language text.

        Returns:
            dict: A dictionary containing the glosses or error information.
        """
        log('INFO', f"Getting glosses for source text: '{source_text}' and target text: '{target_text}'")
        if self.glosser is None:
            log('ERROR', "Glosser has not been initialized. Call initialize_glosser() first.")
            return {"error": "Glosser has not been initialized. Call initialize_glosser() first."}
        try:
            glosses = self.glosser.gloss(source_text, target_text)
            log('INFO', f"Successfully retrieved glosses: {glosses}")
            return {"glosses": glosses}
        except Exception as e:
            log('ERROR', f"Error getting glosses: {str(e)}")
            return {"error": f"Error getting glosses: {str(e)}"}

    def get_glosser_info(self):
        """
        Get information about the current state of the glosser.

        Returns:
            dict: A dictionary containing information about the glosser or error information.
        """
        log('INFO', "Getting glosser information")
        if self.glosser is None:
            try:
                log('INFO', "Glosser not initialized. Attempting to initialize...")
                self.initialize_glosser()
            except Exception as e:
                log('ERROR', f"Error initializing glosser: {str(e)}")
                return {"error": f"Error initializing glosser: {str(e)}"}
            
        info = {
            "status": "Initialized",
            "num_source_texts": len(self.source_texts),
            "num_target_texts": len(self.target_texts),
            "num_known_glosses": len(self.glosser.known_glosses)
        }
        log('INFO', f"Glosser information retrieved: {info}")
        return info

    def get_glosser_counts(self):
        """
        Get counts of various elements in the glosser.

        Returns:
            dict: A dictionary containing counts of different elements in the glosser or error information.
        """
        log('INFO', "Getting glosser counts")
        if self.glosser is None:
            log('ERROR', "Glosser not initialized")
            return {"error": "Glosser not initialized"}
        
        try:
            counts = {
                "source_vocab_size": len(self.glosser.source_counts),
                "target_vocab_size": len(self.glosser.target_counts),
                "co_occurrences": sum(len(v) for v in self.glosser.co_occurrences.values()),
                "known_glosses": len(self.glosser.known_glosses)
            }
            log('INFO', f"Glosser counts retrieved: {counts}")
            return counts
        except Exception as e:
            log('ERROR', f"Error getting glosser counts: {str(e)}")
            return {"error": f"Error getting glosser counts: {str(e)}"}

    def predict_sentence_glosses(self, sentence, is_source=True, top_n=3):
        """
        Predict glosses for each word in a sentence.

        Args:
            sentence (str): The input sentence.
            is_source (bool): If True, treat as source language; if False, treat as target language.
            top_n (int): Number of top glosses to return for each word.

        Returns:
            dict: A dictionary containing the predicted glosses or error information.
        """
        log('INFO', f"Predicting sentence glosses for: '{sentence}', is_source={is_source}, top_n={top_n}")
        logging.info(f"Predicting sentence glosses for: '{sentence}', is_source={is_source}, top_n={top_n}")
        if self.glosser is None:
            logging.error("Glosser has not been initialized. Call initialize_glosser() first.")
            return {"error": "Glosser has not been initialized. Call initialize_glosser() first."}
        
        try:
            glosses = self.glosser.predict_sentence_glosses(sentence, is_source, top_n)
            logging.info(f"Successfully predicted sentence glosses: {glosses}")
            return {"glosses": glosses}
        except Exception as e:
            logging.error(f"Error predicting sentence glosses: {str(e)}")
            return {"error": f"Error predicting sentence glosses: {str(e)}"}

    def generate_wooden_translation(self, sentence, is_source=True):
        """
        Generate a wooden back-translation for the input sentence.

        Args:
            sentence (str): The input sentence to translate.
            is_source (bool): If True, translate from source to target language;
                              if False, translate from target to source language.

        Returns:
            dict: A dictionary containing the wooden translation or error information.
        """
        log('INFO', f"Generating wooden translation for: '{sentence}', is_source={is_source}")
        if self.glosser is None:
            log('ERROR', "Glosser has not been initialized. Call initialize_glosser() first.")
            return {"error": "Glosser has not been initialized. Call initialize_glosser() first."}
        try:
            translation = self.glosser.generate_wooden_translation(sentence, is_source)
            log('INFO', f"Successfully generated wooden translation: {translation}")
            return {"translation": translation}
        except Exception as e:
            logging.error(f"Error generating wooden translation: {str(e)}")
            return {"error": f"Error generating wooden translation: {str(e)}"}
    
    def predict_word_glosses(self, word, is_source=True, top_n=3):
        log('INFO', f"Predicting word glosses for: '{word}', is_source={is_source}, top_n={top_n}")
        if self.glosser is None:
            log('ERROR', "Glosser has not been initialized. Call initialize_glosser() first.")
            return {"error": "Glosser has not been initialized. Call initialize_glosser() first."}
        try:
            glosses = self.glosser.predict_word_glosses(word, is_source, top_n)
            log('INFO', f"Successfully predicted word glosses: {glosses}")
            return {"glosses": glosses}
        except Exception as e:
            log('ERROR', f"Error predicting word glosses: {str(e)}")
            return {"error": f"Error predicting word glosses: {str(e)}"}
    
    def search(self, query_text, text_type="source", top_n=5):
        """
        Searches for texts that are most similar to the query text within the specified text type,
        using TF-IDF vectorization and cosine similarity.

        Args:
            query_text (str): The text to search for.
            text_type (str): The type of text to search within ("source" or "target").
            top_n (int): The number of top results to return.

        Returns:
            dict: A dictionary containing the search results or error information.
        """
        try:
            if text_type == "source":
                if self.tfidf_matrix_source is None:
                    return {"results": [{'ref': ref, 'text': '', 'uri': uri} for ref, uri in zip(self.source_references, self.source_uris) if ref in self.dictionary][:top_n]}
                query_vector = self.tfidf_vectorizer_source.transform([query_text])
                similarities = cosine_similarity(query_vector, self.tfidf_matrix_source)
                top_indices = similarities.argsort()[0][-top_n:][::-1]
                ret = [{'ref': self.source_references[i], 'text': self.source_texts[i], 'uri': self.source_uris[i]} for i in top_indices if self.source_references[i] in self.dictionary]
                return {"results": ret}
            elif text_type == "target":
                if self.tfidf_matrix_target is None:
                    return {"results": [{'ref': ref, 'text': '', 'uri': uri} for ref, uri in zip(self.target_references, self.target_uris)][:top_n]}
                query_vector = self.tfidf_vectorizer_target.transform([query_text])
                similarities = cosine_similarity(query_vector, self.tfidf_matrix_target)
                top_indices = similarities.argsort()[0][-top_n:][::-1]
                ret =  [{'ref': self.target_references[i], 'text': self.target_texts[i], 'uri': self.target_uris[i]} for i in top_indices]
                return {"results": ret}
            else:
                raise ValueError("Invalid text_type. Choose either 'source' or 'target'.")
        except Exception as e:
            log('ERROR', f"Error searching for {text_type} texts: {str(e)}")
            return {"error": f"Error searching for {text_type} texts: {str(e)}"}

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
        try:
            target_results = self.search(query_text=query, text_type="target", top_n=100)
            if not isinstance(target_results, dict) or 'results' not in target_results:
                log('ERROR', f"Unexpected target_results format: {target_results}")
                return 0

            source_text = self.get_text(ref=reference, text_type="source")
            source_results = self.search(query_text=source_text, text_type="source", top_n=100)
            if not isinstance(source_results, dict) or 'results' not in source_results:
                log('ERROR', f"Unexpected source_results format: {source_results}")
                return 0

            # Get the common references between target and source results
            target_refs = [i['ref'] for i in target_results['results'] if isinstance(i, dict) and 'ref' in i]
            source_refs = [i['ref'] for i in source_results['results'] if isinstance(i, dict) and 'ref' in i]
            common_refs = list(set(target_refs) & set(source_refs))

            # Filter the results to include only the common references
            target_results = [i for i in target_results['results'] if isinstance(i, dict) and i.get('ref') in common_refs][:n_samples]
            source_results = [i for i in source_results['results'] if isinstance(i, dict) and i.get('ref') in common_refs][:n_samples]

            ref_string_target = ''.join([i['ref'] for i in target_results if isinstance(i, dict) and 'ref' in i])
            ref_string_source = ''.join([i['ref'] for i in source_results if isinstance(i, dict) and 'ref' in i])

            return similarity(ref_string_target, ref_string_source)
        except Exception as e:
            log('ERROR', f"Error in get_lad: {str(e)}")
            return 0

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
        if text_type == "target":
            try:
                # Search for the reference in self.target_references
                index = self.target_references.index(ref)
                return self.target_texts[index]
            except ValueError:
                return ''
            
        # Return empty string if reference not found
        if ref in self.dictionary and text_type in self.dictionary[ref]:
            return self.dictionary[ref][text_type]
        return ''
    
    def get_similar_drafts(self, ref, top_n=5):
        try:
            source_text = self.get_text(ref=ref, text_type='target')
            rankings = self.search(query_text=source_text, text_type='target', top_n=top_n+1)
            refs = [verse['ref'] for verse in rankings[1:]]
            for verse in rankings:
                refs.append(verse['ref'])
            target_verses = []
            for ref in refs:
                target_text = self.get_text(ref=ref, text_type='target')
                source_text = self.get_text(ref=ref, text_type='source')
                target_verses.append({"ref": ref, "source": source_text, "target": target_text})
        except IndexError:
            return ""
        return target_verses
    
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
                    if len(text) < 4:
                        continue
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
            text = text.strip()
            if len(text) < 4:
                continue
            verse = {
                'ref': ref,
                'text': text,
                'uri': str(path)
            }
            verses.append(verse)
    return verses

def extract_dictionary(path):
    with open(path, "r", encoding="utf-8") as file:
        data = json.load(file)
    return data

if __name__ == "__main__":
    entries = extract_dictionary(path="/Users/ryderwishart/genesis/test-project-june-25/.project/project.dictionary")["entries"]
    
    known_glosses = {entry["headWord"]: entry["translationEquivalents"] for entry in entries if entry["translationEquivalents"]}
    
    print(len(known_glosses), 'glosses known')
    
    glosser = ImprovedStatisticalGlosser()
    # Example English and French sentences
    source_sentences = ["The cat is on the table", "I love to eat pizza"]
    target_sentences = ["Le chat est sur la table", "J'aime manger de la pizza"]
    glosser.add_known_glosses(known_glosses)
    glosser.train(source_sentences, target_sentences)
    
    print(glosser.gloss(source_sentences[0], target_sentences[0]))
    print(glosser.gloss(source_sentences[1], target_sentences[1]))
