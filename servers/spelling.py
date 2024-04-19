"""
Spelling
"""
import json
import os
import re
import string
import sys
import uuid
from enum import Enum
from typing import Dict, List, Tuple, Union
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pygls.server import LanguageServer
from skimage.feature import hog
from skimage.filters import threshold_sauvola
from sklearn.decomposition import PCA
from sklearn.preprocessing import MinMaxScaler
from lsprotocol.types import (CodeAction, CodeActionKind, CodeActionParams,
                              Command, CompletionItem, CompletionParams,
                              Diagnostic, DiagnosticSeverity, DocumentDiagnosticParams,
                              Position, Range, TextEdit, WorkspaceEdit)
from utils import genetic_tokenizer

class Hash:
    """
    Image hash
    """
    def __init__(self, h: str):
        self.h = [float(i) for i in h.split("::")]

    def __sub__(self, other):
        return sum(abs(float(a) - float(b)) for a, b in zip(self.h, other.h))

    def __str__(self):
        return "::".join(str(a) for a in self.h)

def divide_text_into_chunks(text, n):
    """
    divide into chunks
    """
    chunk_size = max(1, len(text) // n)
    chunks = [text[i:i + chunk_size] for i in range(0, len(text), chunk_size)]
    chunks.extend([','] * (n - len(chunks)))
    return chunks

def spell_hash(text: str, font_path: str = "servers/files/unifont-15.1.04.otf", font_size: int = 100) -> Hash:
    """
    Convert each letter in text to an image, extract visual features, and return it as a Hash object.

    Args:
        text (str): The Unicode text to convert into an image.
        font_path (str): Optional. Path to a .ttf font file. Uses default font if None.
        font_size (int): Font size.

    Returns:
        Hash: A Hash object representing the visual features of the text.
    """
    text = divide_text_into_chunks(text, 3)

    if font_path:
        font = ImageFont.truetype(font_path, font_size)
    else:
        font = ImageFont.load_default()

    pixel_counts = []
    hog_features = []

    for letter in text:
        img = Image.new('RGB', (font_size, font_size), color='white')
        d = ImageDraw.Draw(img)
        d.text((0, 0), letter, fill='black', font=font)

        letter_width = d.textlength(letter, font=font)

        grayscale_img = img.convert('L')
        threshold = threshold_sauvola(np.array(grayscale_img), window_size=15, k=0.2)
        binary_img = np.array(grayscale_img > threshold, dtype=np.uint8) * 255

        black_pixels = np.sum(binary_img == 0)
        white_pixels = np.sum(binary_img == 255)

        normalized_count = (black_pixels - white_pixels) / letter_width
        pixel_counts.append(float(normalized_count))

        hog_features.append(hog(binary_img, orientations=4, pixels_per_cell=(10, 10), cells_per_block=(2, 2), block_norm='L2'))

    hog_features_flattened = np.array([feature.ravel() for feature in hog_features])
    n_components = min(len(hog_features_flattened), hog_features_flattened.shape[1])
    pca = PCA(n_components=n_components)
    hog_features_reduced = pca.fit_transform(hog_features_flattened)

    scaler = MinMaxScaler()
    pixel_counts_scaled = scaler.fit_transform(np.array(pixel_counts).reshape(-1, 1)).flatten()
    hog_features_scaled = scaler.fit_transform(hog_features_reduced)

    features = np.concatenate((pixel_counts_scaled, hog_features_scaled.ravel()))

    return Hash('::'.join(str(a) for a in features))

def distance(str1, str2):
    """
    edit distance between two strings
    """
    len_str1 = len(str1) + 1
    len_str2 = len(str2) + 1

    # Initialize a matrix to store the edit distances
    matrix = [[0 for _ in range(len_str2)] for _ in range(len_str1)]

    # Initialize the matrix with initial values
    for i in range(len_str1):
        matrix[i][0] = i
    for j in range(len_str2):
        matrix[0][j] = j

    # Populate the matrix using dynamic programming
    for i in range(1, len_str1):
        for j in range(1, len_str2):
            cost = 0 if str1[i - 1] == str2[j - 1] else 1
            matrix[i][j] = min(
                matrix[i - 1][j] + 1,      # Deletion
                matrix[i][j - 1] + 1,      # Insertion
                matrix[i - 1][j - 1] + cost  # Substitution
            )

    # The bottom-right cell contains the final edit distance
    return matrix[-1][-1]

def block_print():
    """
    Redirects the sys.stdout to /dev/null to block print statements.
    """
    sys.stdout = open(os.devnull, 'w', encoding="utf-8")

def unblock_print():
    """
    Restores the sys.stdout to its default value to enable print statements.
    """
    sys.stdout = sys.__stdout__




translator = str.maketrans('', '', string.punctuation)

class CheckMode(Enum):
    """
    Which checkmode
    """
    EDIT_DISTANCE = 1
    IMAGE_HASH = 2
    COMBINE_BOTH = 3

def criteria(dictionary_word: Dict, word: str, word_hash: Hash,
              dictionary, mode: CheckMode) -> Union[float, Tuple[float, float]]:
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
        return distance(dictionary_word["headWord"], word)
    elif mode == CheckMode.IMAGE_HASH:
        hash1 = Hash(dictionary_word['hash'])
        hash2 = word_hash
        try:
            return hash1 - hash2
        except Exception:
            # If an error occurs during hash comparison, rehash the older word and update the dictionary
            rehashed_entry = {
                **dictionary_word,
                'hash': str(spell_hash(dictionary_word["headWord"]))
            }
            dictionary.dictionary['entries'] = [
                rehashed_entry if entry['id'] == dictionary_word['id'] else entry
                for entry in dictionary.dictionary['entries']
            ]
            dictionary.save_dictionary()
            return Hash(rehashed_entry['hash']) - hash2
    elif mode == CheckMode.COMBINE_BOTH:
        edit_dist = distance(dictionary_word["headWord"], word)
        hash1 = Hash(dictionary_word['hash'])
        hash2 = word_hash
        try:
            hash_diff = hash1 - hash2
        except Exception:
            # If an error occurs during hash comparison, rehash the older word and update the dictionary
            rehashed_entry = {
                **dictionary_word,
                'hash': str(spell_hash(dictionary_word["headWord"]))
            }
            dictionary.dictionary['entries'] = [
                rehashed_entry if entry['id'] == dictionary_word['id'] else entry
                for entry in dictionary.dictionary['entries']
            ]
            dictionary.save_dictionary()
            hash_diff = Hash(rehashed_entry['hash']) - hash2
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
        self.tokenizer = genetic_tokenizer.TokenDatabase(self.path, single_words=True, default_tokens=[entry for entry in self.dictionary['entries']])
        self.tokenizer.tokenizer.evolve([" ".join([entry['headWord'] for entry in self.dictionary["entries"]])])
    def load_dictionary(self) -> Dict:
        """
        Loads the dictionary from a JSON file.

        Returns:
            Dict: The dictionary loaded from the file, or a new dictionary if the file does not exist.
        """
        try:
            with open(self.path, 'r', encoding="utf-8") as file:
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
            with open(self.path, 'w', encoding="utf-8") as file:
                json.dump(new_dict, file)
            return new_dict

    def save_dictionary(self) -> None:
        """
        Saves the current state of the dictionary to a JSON file.
        """
        
        with open(self.path, 'w', encoding="utf-8") as file:
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
                'hash': str(spell_hash(word)),
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
        self.tokenizer.insert_manual([word])
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
        word_hash = spell_hash(word)

        if self.mode == CheckMode.COMBINE_BOTH:
            # Find top n words using edit distance
            top_n = 10
            edit_distance_possibilities = [
                (entry['headWord'], distance(entry['headWord'], word))
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
def vfilter(text, reference):
    # Define a regular expression pattern to find verse references
    pattern = r'\b([A-Z]+)\s+(\d+):(\d+)\b'

    # Define a function to replace each match with underscores
    def replace_with_underscores(match):
        book, chapter, verse = match.groups()
        book_underscores = "_" * len(book)
        chapter_underscores = "_" * len(chapter)
        verse_underscores = "_" * len(verse)
        return f"{book_underscores} {chapter_underscores}:{verse_underscores}"

    # Use re.sub to replace each match with underscores
    filtered_text = re.sub(pattern, replace_with_underscores, text)

    return filtered_text
def get_verse_references_from_file(path):
    """
    get verse refrences
    """
    path = 'servers/files/versedata.txt'
    with open(path, 'r', encoding='utf-8') as f:
        return f.readlines()

def extract_chapter_verse_counts(file_path):
    """
    extract chapter v counts
    """
    all_chapter_verse_counts = []
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
        matches = re.findall(r'"chapterVerseCountPairings":\s*{([^}]*)}', content)
        for match in matches:
            chapter_verse_pairs = match.strip()
            pairs = re.findall(r'"(\d+)":\s*(\d+)', chapter_verse_pairs)
            chapter_verse_counts = {int(chapter): int(verse) for chapter, verse in pairs}
            all_chapter_verse_counts.append(chapter_verse_counts)
    return all_chapter_verse_counts


def extract_book_names(file_path):
    """This regular expression looks for patterns that match }, followed by whitespace (optional),
    then a sequence of uppercase letters and/or numbers (the book name), followed by ": {". 
    The book name is captured in a group by the parentheses."""
    pattern = re.compile(r'},\s*"([A-Z0-9]+)":\s*{')

    book_names = []
    with open(file_path, 'r', encoding='utf-8') as file:
        content = file.read()
        matches = re.findall(pattern, content)
        for match in matches:
            # Each match is a book name that is appended to the book_names list
            book_names.append(match)

    return book_names



refrences = get_verse_references_from_file('src/utils/verseRefUtils/verseData.ts')

class SPELLING_MESSAGE(Enum):
    """
    Spelling error messages 
    (seriosly pylint should not require every class to have a docstring 🤦)
    """
    TYPO = "❓🔤: '{word}'"
    ADD_WORD = "'{word}' → 📖"
    ADD_ALL_WORDS = "Add all {count} 📖" # Not implemented yet
    REPLACE_WORD = "'{word}' → '{correction}'"

class ServableSpelling:
    """
    Spell check that can be served over a language server
    """
    def __init__(self, lspw):
        """
        Initialize the ServableSpelling class with server functions and a flag for relative checking.

        Args:
            lspw (LSPWrapper): The server functions object that provides access to server-related utilities.
            relative_checking (bool, optional): Flag to determine if relative checking is enabled. Defaults to False.
        """
        self.dictionary: Dictionary = None
        self.spell_check: SpellCheck = None
        self.lspw = lspw
        self.lspw.functions.initialize_functions.append(self.initialize)

    def spell_completion(self, lspw, params: CompletionParams, _range: Range) -> List:
        """
        Provide completion items for spelling corrections in a document.

        Args:
            server (LanguageServer): The instance of the language server.
            params (CompletionParams): The parameters for the completion request.
            range (Range): The range within the document where the completion is requested.
            lspw (LSPWrapper): The server functions object.

        Returns:
            List: A list of CompletionItem objects representing spelling suggestions.
        """
        try:
            document_uri = params.text_document.uri
            document = lspw.server.workspace.get_document(document_uri)
            line = document.lines[params.position.line]
            word = line.strip().split(" ")[-1]
            if self.spell_check is not None:
                completions = self.spell_check.complete(word=word)
                return [CompletionItem(
                    label=word+completion,
                    text_edit=TextEdit(range=_range, new_text=completion),
                    ) for completion in completions]
            else:
                return []
        except IndexError:
            return []

    def spell_diagnostic(self, lspw, params: DocumentDiagnosticParams) -> List[Diagnostic]:
        """
        Generate diagnostics for spelling errors in a document.

        Args:
            ls (LanguageServer): The instance of the language server.
            params (DocumentDiagnosticParams): The parameters for the diagnostic request.
            lspw (LSPWrapper): The server functions object.

        Returns:
            List[Diagnostic]: A list of Diagnostic objects representing spelling errors.
        """
        diagnostics: List[Diagnostic] = []
        document_uri = params.text_document.uri
        #if ".codex" in document_uri or ".scripture" in document_uri:
        document = lspw.server.workspace.get_document(document_uri)
        lines = document.lines
        for line_num, line in enumerate(lines):
            if len(line) % 5 == 0:
                line = vfilter(line, refrences)
            words = line.split(" ")
            edit_window = 0

            for word in words:
                if self.spell_check and self.spell_check.is_correction_needed(word):
                    start_char = edit_window
                    end_char = start_char + len(word)
                    
                    _range = Range(start=Position(line=line_num, character=start_char),
                                end=Position(line=line_num, character=end_char))
                    
                    tokenized_word = self.spell_check.dictionary.tokenizer.tokenize(word)
                    detokenized_word = self.spell_check.dictionary.tokenizer.tokenizer.detokenize(tokenized_word, join="-")
                    formatted_message = SPELLING_MESSAGE.TYPO.value.format(word=detokenized_word)

                    diagnostics.append(Diagnostic(range=_range, message=formatted_message, severity=DiagnosticSeverity.Information, source='Spell-Check'))
                # Add one if the next character is whitespace
                if edit_window + len(word) < len(line) and line[edit_window + len(word)] == ' ':
                    edit_window += len(word) + 1
                else:
                    edit_window += len(word)
        return diagnostics
    
    def spell_action(self, lspw, params: CodeActionParams, _range: Range) -> List[CodeAction]:
        """
        Generate code actions for spelling corrections in a document.

        Args:
            ls (LanguageServer): The instance of the language server.
            params (CodeActionParams): The parameters for the code action request.
            range (Range): The range within the document where the code action is requested.
            lspw (LSPWrapper): The server functions object.

        Returns:
            List[CodeAction]: A list of CodeAction objects representing spelling correction actions.
        """

        document_uri = params.text_document.uri
        document = lspw.server.workspace.get_document(document_uri)
        diagnostics = params.context.diagnostics
        
        actions = []
        typo_diagnostics = []
        start_line = None
        for diagnostic in diagnostics:
            if SPELLING_MESSAGE.TYPO.value.split(":", maxsplit=1)[0] in diagnostic.message:
                typo_diagnostics.append(diagnostic)
                start_line = diagnostic.range.start.line
                start_character = diagnostic.range.start.character
                end_character = diagnostic.range.end.character
                word = document.lines[start_line][start_character:end_character]
                try:
                    corrections = self.spell_check.check(word)
                except IndexError:
                    corrections = []
                for correction in corrections:
                    edit = TextEdit(range=diagnostic.range, new_text=correction)
     

                    action = CodeAction(
                        title=SPELLING_MESSAGE.REPLACE_WORD.value.format(word=word, correction=correction),
                        kind=CodeActionKind.QuickFix,
                        diagnostics=[diagnostic],
                        edit=WorkspaceEdit(changes={document_uri: [edit]}))
                    
                    actions.append(action)

                add_word_action = CodeAction(
                    title=SPELLING_MESSAGE.ADD_WORD.value.format(word=word),
                    kind=CodeActionKind.QuickFix,
                    diagnostics=[diagnostic],
                    command=Command('Add to Dictionary', command='pygls.server.add_dictionary', arguments=[[word]]),
                )
                actions.append(add_word_action)
                add_word_action = CodeAction(
                            title="Add all words",
                            kind=CodeActionKind.QuickFix,
                            diagnostics=[diagnostic],
                            command=Command('Add to Dictionary', command='pygls.server.add_dictionary', arguments=[document.lines[start_line].split(" ")])
                        )
                actions.append(add_word_action)
            
        return actions
    
    def add_dictionary(self, args):
        """
        Add words to the dictionary.

        Args:
            args (List[str]): A list of words to be added to the dictionary.
        """
        args = args[0]
        for word in args:
            self.dictionary.define(word)
        self.lspw.server.show_message("Dictionary updated.")

    def initialize(self, params, lspw):
        """
        Initialize the spell checking functionality by setting up the dictionary and spell checker.

        Args:
            params: The initialization parameters.
            server (LanguageServer): The instance of the language server.
            lspw (LSPWrapper): The server functions object.
        """
        self.dictionary = Dictionary(self.lspw.paths.raw_path + "/drafts/")
        self.spell_check = SpellCheck(dictionary=self.dictionary)
        return params, None, lspw # get rid of pylint stuff
