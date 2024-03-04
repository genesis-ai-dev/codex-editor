from txtai import Embeddings
import datetime
from typing import Union
import string
from gensim.models import Word2Vec
from gensim.utils import simple_preprocess
import os
import glob
from typing import Union, List, Generator
from sqlite3 import IntegrityError
import csv
from typing import Any


try:
    from tools.codex_tools import extract_verses, extract_verses_bible
    from tools.nlp import genetik_tokenizer

except ImportError:
    from codex_tools import extract_verses, extract_verses_bible
    from nlp import genetik_tokenizer

# Create a translation table for removing punctuation from strings.
translator = str.maketrans('', '', string.punctuation)

def remove_punctuation(text: str) -> str:
    """
    Removes punctuation from a given string.

    Args:
        text (str): The input string from which punctuation will be removed.

    Returns:
        str: The input string with all punctuation removed.
    """
    return text.translate(translator).strip()

# Initialize embeddings with a specific model path, enabling content and object storage.
embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)

def sql_safe(text: str) -> str:
    """
    Escapes special characters in a string for use in an SQL statement, making it safe for SQL queries.

    Args:
        text (str): The input string to be sanitized.

    Returns:
        str: A sanitized string safe for SQL queries.
    """
    if not text:
        return text
    return text.replace("'", "''").replace("\\", "/").replace('"', "''")

class DataBase:
    """
    A class for managing database operations with embeddings.
    """
    def __init__(self, db_path: str, has_tokenizer: bool = False) -> None:
        """
        Initializes the DataBase class with a specific database path and embeddings model.

        Args:
            db_path (str): The path to the database file.
        """
        self.db_path = db_path
        self.db_path = db_path.replace("\\", "/") # normalize this just in case

        self.embeddings = Embeddings(path="sentence-transformers/nli-mpnet-base-v2", content=True, objects=True)
        self.has_tokenizer = has_tokenizer
        self.queue: List[Any] = []  # Added type annotation as per linting suggestion
        self.open = True

        if has_tokenizer:
            self.tokenizer = genetik_tokenizer.TokenDatabase(self.db_path)
        else:
            self.tokenizer = None
        try:
            self.embeddings.load(self.db_path)
        except Exception:
            pass

    def upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = '', save_now=True) -> None:
        """
        Inserts or updates a record in the database.

        Args:
            text (str): The text of the record.
            reference (str): The reference identifier for the record.
            book (str): The book associated with the record.
            chapter (str): The chapter associated with the record.
            verse (str): The verse associated with the record.
            uri (str): The URI associated with the record.
            metadata (str, optional): Additional metadata for the record. Defaults to an empty string.
        """
        text, reference, book, verse, metadata, chapter = map(sql_safe, [text, reference, book, verse, metadata, chapter])
        self.embeddings.upsert([ (reference, {'text': text, 'book': book, 'verse': verse, 'chapter': chapter, 'createdAt': str(datetime.datetime.now()), 'uri': uri, 'metadata': metadata})])
        if save_now:
            self.save()
    
    def queue_upsert(self, text: str, reference: str, book: str, chapter: str, verse: str, uri: str, metadata: str = '', save_now=True):
        text, reference, book, verse, metadata, chapter = map(sql_safe, [text, reference, book, verse, metadata, chapter])
        
        self.queue.append((reference, {'text': text, 'book': book, 'verse': verse, 'chapter': chapter, 'createdAt': str(datetime.datetime.now()), 'uri': uri, 'metadata': metadata}))
        if len(self.queue) % 1000 == 0:
            self.embeddings.upsert(self.queue)
            self.save()
            self.queue = []

    def search(self, query: str, limit: int = 5) -> list:
        """
        Searches the database for records similar to the query.

        Args:
            query (str): The search query.
            limit (int, optional): The maximum number of results to return. Defaults to 5.

        Returns:
            list: A list of search results.
        """
        query = remove_punctuation(query)
        results = self.embeddings.search(f"select text, book, verse, chapter, createdAt, uri, metadata from txtai where similar('f{query}')", limit=limit)
        return results

    def exists(self, ids: list) -> list:
        """
        Checks which of the given ids exist in the database.

        Args:
            ids (list): A list of ids to check for existence in the database.

        Returns:
            list: A list of ids that exist in the database.
        """
        existing_ids = []
        for id in ids:
            result = self.embeddings.search(f"select book from txtai where id='{id}'")
            if result:
                existing_ids.append(id)
        return existing_ids
    
    def get_text(self, id) -> str:
        text = self.embeddings.search(f"select text from txtai where id='{id}'")
        return text
    
    def get_text_from(self, book, chapter, verse):
        print(book, chapter, verse)
        text = self.embeddings.search(f"select text from txtai where book='{book}' and chapter='{chapter}' and verse='{verse}'")
        return text
    
    def upsert_queue(self):
        self.queue = [item for item in self.queue if item] # FIXME: why is this needed
        if self.queue:
            self.embeddings.upsert(self.queue)
            self.save()
            self.queue = []
        else:
            self.queue = []

    def upsert_codex_file(self, path: str) -> None:
        """
        Inserts or updates records in the database from a .codex file.

        Args:
            path (str): The path to the .codex file.
        """
        path = "/" + path if "://" not in path and "/" != path[0]  else path
        results = extract_verses(path)
        for result in results:
            if len(result['text']) > 11: # 000 000:000  
                text, book, chapter, verse = result['text'], result['book'], result['chapter'], result['verse']
                reference = f'{book} {chapter}:{verse}'
                self.queue_upsert(text=text, book=book, chapter=chapter, reference=reference, verse=verse, uri=path)
                self.tokenizer.upsert_text(text)
        self.tokenizer.upsert_all()
        self.upsert_queue()

    def upsert_bible_file(self, path: str) -> None:
        """
        Inserts or updates records in the database from a .bible file.

        Args:
            path (str): The path to the .bible file.
        """
        from tqdm import tqdm

        path = "/" + path if "://" not in path and "/" != path[0] else path
        results = extract_verses_bible(path)
        print("going through results: ", len(results))
        for result in tqdm(results, desc="Processing results"):
            if len(result['text']) > 11: # 000 000:000  
                text, book, chapter, verse = map(result.get, ['text', 'book', 'chapter', 'verse'])
                reference = f'{book} {chapter}:{verse}'
                try:
                    self.queue_upsert(text=text, book=book, chapter=chapter, reference=reference, verse=verse, uri=path.replace("file://", ""), save_now=False)
                except IntegrityError:
                    print("Integrity error")
        self.save()
        print("reading file")
        with open(path, "r") as f:
            self.tokenizer.upsert_text(f.read())
            self.tokenizer.upsert_all()
        self.upsert_queue()

    def save(self) -> None:
        """
        Saves the current state of the embeddings to the database.
        """
        self.embeddings.save(self.db_path)
        if os.listdir(self.db_path) == ['config']:
            os.remove(os.path.join(self.db_path, 'config'))
            os.rmdir(self.db_path)

    
    def upsert_resource_file(self, path: str) -> None:
        """
        Inserts or updates records in the database from a resource file (.txt, .md, or .tsv).

        Args:
            path (str): The path to the resource file.
        """
        # Determine the file type based on its extension
        if not path.endswith(('.txt', '.md', '.tsv')):
            print(f"Unsupported file type: {path}")
            return

        # Adjust path if necessary
        path = "/" + path if "://" not in path and not path.startswith("/") else path

        # Read the file content
        if path.endswith('.tsv'):
            with open(path, "r", encoding="utf-8") as file:
                for line in file:
                    parts = line.strip().split('\t')
                    if len(parts) >= 2:
                        text = parts[1]
                        self.queue_upsert(text=text, book='', chapter='', verse='', reference='', uri=path, metadata='', save_now=False)
        else:
            with open(path, "r", encoding="utf-8") as file:
                text = file.read()
                self.queue_upsert(text=text, book='', chapter='', verse='', reference='', uri=path, metadata='', save_now=False)

        # Update tokenizer and queue
        self.upsert_queue()
        print(f"Resource file {path} upserted successfully.")
        
    def close(self):
        self.open = False
        self.embeddings.close()




class VecTrainer:
    def __init__(self, directory_or_files: Union[List[str], str], save_path: str, vector_size: int = 50) -> None:
        """
        Initializes the = model with the given parameters.

        Args:
            directory_or_files (Union[List[str], str]): Either a directory containing .bible files or a list of .bible file paths.
            save_path (str): The path where the trained model should be saved.
            vector_size (int, optional): The dimensionality of the word vectors. Defaults to 50.
        """
        self.vector_size = vector_size
        self.files = []
        self.save_path = save_path
        if isinstance(directory_or_files, str) and os.path.isdir(directory_or_files):
            self.files = glob.glob(os.path.join(directory_or_files, '*.bible'))
        elif isinstance(directory_or_files, list):
            self.files = directory_or_files
        else:
            raise ValueError("Input should be a directory or a list of .bible file names")

    def read_input(self, input_file: str) -> Generator[List[str], None, None]:
        """
        Reads and preprocesses the input file.

        Args:
            input_file (str): The path to the input file.

        Yields:
            Generator[List[str], None, None]: A generator yielding preprocessed lines from the input file.
        """
        with open(input_file, 'r', encoding='utf-8') as f:
            for line in f:
                yield simple_preprocess(line)

    def process_files(self) -> List[List[str]]:
        """
        Processes all files specified during initialization.

        Returns:
            List[List[str]]: A list of sentences, where each sentence is a list of words.
        """
        sentences = []
        for file in self.files:
            sentences.extend(list(self.read_input(file)))
        return sentences

    def train_model(self, sentences: List[List[str]]) -> Word2Vec:
        """
        Trains the Word2Vec model on the given sentences.

        Args:
            sentences (List[List[str]]): A list of sentences for training the model.

        Returns:
            Word2Vec: The trained Word2Vec model.
        """
        model = Word2Vec(sentences=sentences, vector_size=self.vector_size)
        model.build_vocab(sentences)
        model.train(sentences, total_examples=model.corpus_count, epochs=10)
        return model

    def save_model(self, model: Word2Vec, output_file: str) -> None:
        """
        Saves the trained model to the specified output file.

        Args:
            model (Word2Vec): The trained Word2Vec model.
            output_file (str): The path where the model should be saved.
        """
        model.save(output_file)

    def run(self) -> Word2Vec:
        """
        Executes the process of reading input, training the model, and saving it.

        Returns:
            Word2Vec: The trained Word2Vec model.
        """
        sentences = self.process_files()
        model = self.train_model(sentences)
        for file in self.files:
            output_model_file = os.path.splitext(file)[0] + '_word2vec.model'
            self.save_model(model, output_model_file)
            print(f"Model saved for {file}: {output_model_file}")
        return model

if __name__ == "__main__":
    db_path = "dbs/db7/embedding"
    database = DataBase(db_path)
    database.save()
    print(database.exists(["GEN 1:10", "GEN 1:2"]))
    search_results = database.search(query="")
    print("Search Results:", search_results)

